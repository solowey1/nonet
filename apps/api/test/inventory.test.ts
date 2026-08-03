import { BOARD_SIZE, isFilled, reduce, type GameState } from "@nonet/engine";
import type { Action } from "@nonet/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { inventoryBalance } from "../src/db/schema.js";
import { env } from "../src/env.js";
import { validateConsumeTokens } from "../src/services/inventory.js";
import { autoplay } from "./helpers/autoplay.js";
import { migrateTestDb, resetTestDb } from "./helpers/db.js";
import { buildSignedInitData } from "./helpers/telegram.js";

const app = buildApp();

beforeAll(async () => {
  await migrateTestDb();
  await app.ready();
});

beforeEach(async () => {
  await resetTestDb();
});

afterAll(async () => {
  await app.close();
});

async function session(userId: number): Promise<{ token: string; inventory: Record<string, number> }> {
  const initData = buildSignedInitData(env.BOT_TOKEN, { id: userId, username: `user${userId}` });
  const res = await app.inject({ method: "POST", url: "/api/session", payload: { initData } });
  const body = res.json();
  return { token: body.token, inventory: body.inventory };
}

async function startRun(token: string): Promise<{ runId: string; seedHex: string; runToken: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/run/start",
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  return res.json();
}

function findFilledCell(state: GameState): { row: number; col: number } | null {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (isFilled(state.board, row, col)) return { row, col };
    }
  }
  return null;
}

function sumInventory(inventory: Record<string, number>): number {
  return Object.values(inventory).reduce((sum, qty) => sum + qty, 0);
}

describe("welcome gift", () => {
  it("grants a starter kit on first session (plus that day's daily gift), and doesn't re-grant either on a later same-day session", async () => {
    const first = await session(100);
    // Welcome kit (3+3+2+1+1=10) plus exactly one daily-gift item (streak=1, no 7-day bonus yet).
    expect(first.inventory.pencil).toBeGreaterThanOrEqual(3);
    expect(first.inventory.eraser).toBeGreaterThanOrEqual(3);
    expect(first.inventory.rocket).toBeGreaterThanOrEqual(2);
    expect(first.inventory.bomb).toBeGreaterThanOrEqual(1);
    expect(first.inventory.fill).toBeGreaterThanOrEqual(1);
    expect(sumInventory(first.inventory)).toBe(11);

    // Log in again the same day — should NOT grant a second welcome kit or daily gift.
    const second = await session(100);
    expect(second.inventory).toEqual(first.inventory);
  });
});

describe("POST /api/inventory/consume", () => {
  it("decrements inventory and returns a usable consumeToken", async () => {
    const { token, inventory } = await session(1);
    const { runId, runToken } = await startRun(token);
    const startingPencils = inventory.pencil ?? 0; // welcome kit (3) + maybe a daily-gift pencil

    const res = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, item: "pencil" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.remaining).toBe(startingPencils - 1);
    expect(typeof body.consumeToken).toBe("string");
  });

  it("rejects once an item's balance is exhausted", async () => {
    const { token, inventory } = await session(2);
    const { runId, runToken } = await startRun(token);
    const startingBombs = inventory.bomb ?? 0; // welcome kit (1) + maybe a daily-gift bomb
    expect(startingBombs).toBeGreaterThan(0);

    for (let i = 0; i < startingBombs; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/inventory/consume",
        headers: { authorization: `Bearer ${runToken}` },
        payload: { runId, item: "bomb" },
      });
      expect(res.statusCode).toBe(200);
    }

    const overdrawn = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, item: "bomb" },
    });
    expect(overdrawn.statusCode).toBe(409);
  });

  it("rejects consuming against a run that isn't this token's run", async () => {
    const { token } = await session(3);
    const { runToken } = await startRun(token);

    const res = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId: "00000000-0000-7000-8000-000000000000", item: "pencil" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("stocked revive (§19 round 5 — bulk shop tiers spent for free)", () => {
  it("consumes a stocked revive like any other inventory item, and the resulting token validates as a legitimate revive", async () => {
    const { token } = await session(8);
    const { runId, runToken } = await startRun(token);
    const userId = 8n;
    await db.insert(inventoryBalance).values({ userId, item: "revive", qty: 3 });

    const res = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, item: "revive" },
    });
    expect(res.statusCode).toBe(200);
    const { consumeToken, remaining } = res.json();
    expect(remaining).toBe(2);

    const reviveAction: Action = { t: 123, type: "revive", consumeToken };
    const ok = await validateConsumeTokens(db, userId, runId, [reviveAction]);
    expect(ok).toBe(true);
  });

  it("rejects a stocked-revive token claimed against a different run", async () => {
    const { token } = await session(9);
    const { runId, runToken } = await startRun(token);
    const userId = 9n;
    await db.insert(inventoryBalance).values({ userId, item: "revive", qty: 1 });

    const res = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, item: "revive" },
    });
    const { consumeToken } = res.json();

    const reviveAction: Action = { t: 123, type: "revive", consumeToken };
    const ok = await validateConsumeTokens(db, userId, "00000000-0000-7000-8000-000000000000", [reviveAction]);
    expect(ok).toBe(false);
  });
});

describe("run/finish with power-up actions", () => {
  it("verifies a run whose log includes a legitimately-consumed power-up", async () => {
    const { token } = await session(4);
    const { runId, seedHex, runToken } = await startRun(token);

    const { actions, finalState } = autoplay(Buffer.from(seedHex, "hex"), 8);
    const target = findFilledCell(finalState);
    expect(target, "expected at least one filled cell after a few placements").not.toBeNull();

    const consumeRes = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, item: "pencil" },
    });
    const { consumeToken } = consumeRes.json();

    const pencilAction: Action = {
      t: actions.length ? (actions[actions.length - 1] as Action).t + 200 : 200,
      type: "powerup",
      kind: "pencil",
      r: target!.row,
      c: target!.col,
      consumeToken,
    };
    const fullLog = [...actions, pencilAction];
    const expectedState = reduce(finalState, pencilAction);

    const finishRes = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions: fullLog },
    });
    expect(finishRes.statusCode).toBe(200);
    const body = finishRes.json();
    expect(body.verified).toBe(true);
    expect(body.score).toBe(expectedState.score);
  });

  it("rejects a log that reuses the same consumeToken for two power-up actions", async () => {
    const { token } = await session(5);
    const { runId, seedHex, runToken } = await startRun(token);

    const { actions, finalState } = autoplay(Buffer.from(seedHex, "hex"), 8);
    const target = findFilledCell(finalState);
    expect(target).not.toBeNull();

    const consumeRes = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, item: "pencil" },
    });
    const { consumeToken } = consumeRes.json();

    // Same token claimed by two separate pencil actions.
    const action1: Action = { t: 100000, type: "powerup", kind: "pencil", r: target!.row, c: target!.col, consumeToken };
    const state1 = reduce(finalState, action1);
    const target2 = findFilledCell(state1);
    const action2: Action = {
      t: 100200,
      type: "powerup",
      kind: "pencil",
      r: target2 ? target2.row : target!.row,
      c: target2 ? target2.col : target!.col,
      consumeToken, // reused!
    };

    const finishRes = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions: [...actions, action1, action2] },
    });
    expect(finishRes.statusCode).toBe(200);
    expect(finishRes.json().verified).toBe(false);
  });

  it("rejects a log with a fabricated consumeToken that was never issued", async () => {
    const { token } = await session(6);
    const { runId, seedHex, runToken } = await startRun(token);

    const { actions, finalState } = autoplay(Buffer.from(seedHex, "hex"), 8);
    const target = findFilledCell(finalState);
    expect(target).not.toBeNull();

    const fabricated: Action = {
      t: 100000,
      type: "powerup",
      kind: "pencil",
      r: target!.row,
      c: target!.col,
      consumeToken: "999999999",
    };

    const finishRes = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions: [...actions, fabricated] },
    });
    expect(finishRes.statusCode).toBe(200);
    expect(finishRes.json().verified).toBe(false);
  });

  it("rejects a consumeToken issued for a different item than the action claims", async () => {
    const { token } = await session(7);
    const { runId, seedHex, runToken } = await startRun(token);

    const { actions, finalState } = autoplay(Buffer.from(seedHex, "hex"), 8);
    const target = findFilledCell(finalState);
    expect(target).not.toBeNull();

    // Consume an eraser, but log a pencil action using that token.
    const consumeRes = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, item: "eraser" },
    });
    const { consumeToken } = consumeRes.json();

    const mismatched: Action = {
      t: 100000,
      type: "powerup",
      kind: "pencil",
      r: target!.row,
      c: target!.col,
      consumeToken,
    };

    const finishRes = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions: [...actions, mismatched] },
    });
    expect(finishRes.statusCode).toBe(200);
    expect(finishRes.json().verified).toBe(false);
  });
});
