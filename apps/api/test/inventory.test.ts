import { BOARD_SIZE, isFilled, reduce, type GameState } from "@nonet/engine";
import type { Action } from "@nonet/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { env } from "../src/env.js";
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

describe("welcome gift", () => {
  it("grants a starter kit on first session, and doesn't re-grant on later sessions", async () => {
    const first = await session(100);
    expect(first.inventory).toEqual({ pencil: 3, eraser: 3, rocket: 2, bomb: 1, fill: 1 });

    // Log in again as the same user — should NOT grant a second kit.
    const second = await session(100);
    expect(second.inventory).toEqual({ pencil: 3, eraser: 3, rocket: 2, bomb: 1, fill: 1 });
  });
});

describe("POST /api/inventory/consume", () => {
  it("decrements inventory and returns a usable consumeToken", async () => {
    const { token } = await session(1);
    const { runId, runToken } = await startRun(token);

    const res = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, item: "pencil" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.remaining).toBe(2); // started with 3
    expect(typeof body.consumeToken).toBe("string");
  });

  it("rejects once an item's balance is exhausted", async () => {
    const { token } = await session(2);
    const { runId, runToken } = await startRun(token);

    // bomb starts at qty 1
    const first = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, item: "bomb" },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/inventory/consume",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, item: "bomb" },
    });
    expect(second.statusCode).toBe(409);
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
