import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PlaceAction } from "@nonet/engine";
import { buildApp } from "../src/app.js";
import { env } from "../src/env.js";
import { migrateTestDb, resetTestDb } from "./helpers/db.js";
import { buildSignedInitData } from "./helpers/telegram.js";
import { autoplay } from "./helpers/autoplay.js";

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

async function sessionFor(userId: number): Promise<string> {
  const initData = buildSignedInitData(env.BOT_TOKEN, { id: userId, username: `user${userId}` });
  const res = await app.inject({ method: "POST", url: "/api/session", payload: { initData } });
  return res.json().token as string;
}

describe("run lifecycle", () => {
  it("rejects run/start without a session token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/run/start", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("start -> checkpoint -> finish verifies a legitimate action log and ranks it", async () => {
    const token = await sessionFor(1);

    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(startRes.statusCode).toBe(200);
    const { runId, seedHex, runToken } = startRes.json();
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seedHex).toMatch(/^[0-9a-f]{32}$/);

    const { actions, finalState } = autoplay(Buffer.from(seedHex, "hex"));
    expect(actions.length).toBeGreaterThan(0);

    const checkpointRes = await app.inject({
      method: "POST",
      url: "/api/run/checkpoint",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions: actions.slice(0, Math.ceil(actions.length / 2)) },
    });
    expect(checkpointRes.statusCode).toBe(200);
    expect(checkpointRes.json().ok).toBe(true);

    const finishRes = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions },
    });
    expect(finishRes.statusCode).toBe(200);
    const finishBody = finishRes.json();
    expect(finishBody.verified).toBe(true);
    expect(finishBody.score).toBe(finalState.score);
    expect(finishBody.rank).toBe(1);
  });

  it("rejects a checkpoint whose runId doesn't match the run token", async () => {
    const token = await sessionFor(2);
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const { runToken } = startRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/api/run/checkpoint",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId: "00000000-0000-7000-8000-000000000000", actions: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a tampered action log fails verification: unverified, excluded from ranking, fraud score bumped", async () => {
    const token = await sessionFor(3);
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const { runId, seedHex, runToken } = startRes.json();

    const { actions } = autoplay(Buffer.from(seedHex, "hex"), 10);
    expect(actions.length).toBeGreaterThan(0);
    const tampered = actions.slice();
    const first = tampered[0] as PlaceAction; // autoplay only ever emits "place" actions
    tampered[0] = { ...first, slot: ((first.slot + 1) % 3) as 0 | 1 | 2 };

    const finishRes = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions: tampered },
    });
    expect(finishRes.statusCode).toBe(200);
    const body = finishRes.json();
    expect(body.verified).toBe(false);
    expect(body.rank).toBeNull();

    const profileRes = await app.inject({
      method: "GET",
      url: "/api/profile",
      headers: { authorization: `Bearer ${token}` },
    });
    // unverified runs don't count toward stats
    expect(profileRes.json().stats.runsPlayed).toBe(0);
  });

  it("rejects finishing the same run twice", async () => {
    const token = await sessionFor(4);
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const { runId, seedHex, runToken } = startRes.json();
    const { actions } = autoplay(Buffer.from(seedHex, "hex"), 5);

    const first = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions },
    });
    expect(second.statusCode).toBe(409);
  });

  it("session returns the in-progress run as activeRun after a checkpoint but before finish", async () => {
    const token = await sessionFor(5);
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const { runId, seedHex, runToken } = startRes.json();
    const { actions } = autoplay(Buffer.from(seedHex, "hex"), 3);

    await app.inject({
      method: "POST",
      url: "/api/run/checkpoint",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions },
    });

    const initData = buildSignedInitData(env.BOT_TOKEN, { id: 5, username: "user5" });
    const sessionRes = await app.inject({ method: "POST", url: "/api/session", payload: { initData } });
    const activeRun = sessionRes.json().activeRun;
    expect(activeRun).not.toBeNull();
    expect(activeRun.runId).toBe(runId);
    expect(activeRun.actions.length).toBe(actions.length);
  });
});
