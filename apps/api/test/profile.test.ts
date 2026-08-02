import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { env } from "../src/env.js";
import { autoplay } from "./helpers/autoplay.js";
import { migrateTestDb, resetTestDb } from "./helpers/db.js";
import { buildSignedInitData } from "./helpers/telegram.js";
import { hexToBytes } from "../src/utils/hex.js";

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

async function sessionFor(userId: number): Promise<{ token: string; streak: number }> {
  const initData = buildSignedInitData(env.BOT_TOKEN, { id: userId, username: `user${userId}` });
  const res = await app.inject({ method: "POST", url: "/api/session", payload: { initData } });
  const body = res.json();
  return { token: body.token as string, streak: body.dailyGift.streak as number };
}

describe("GET /api/profile", () => {
  it("rejects without a session token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/profile" });
    expect(res.statusCode).toBe(401);
  });

  it("reports zeroed stats, no best run, and today's real streak for a brand-new user", async () => {
    const { token, streak } = await sessionFor(1);

    const res = await app.inject({ method: "GET", url: "/api/profile", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stats).toEqual({ runsPlayed: 0, piecesPlaced: 0, perfectClears: 0 });
    expect(body.bestRun).toBeNull();
    // A first-ever session grants day 1 of the streak — this is exactly the
    // same value /api/session itself just reported, not a hardcoded 0.
    expect(streak).toBe(1);
    expect(body.streak).toBe(1);
    expect(body.tonAddress).toBeNull();
  });

  it("picks up a verified run's score as the best run and in aggregate stats", async () => {
    const { token } = await sessionFor(2);
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const { runId, seedHex, runToken } = startRes.json();
    const { actions, finalState } = autoplay(hexToBytes(seedHex), 20);

    const finishRes = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions },
    });
    expect(finishRes.json().verified).toBe(true);

    const profileRes = await app.inject({ method: "GET", url: "/api/profile", headers: { authorization: `Bearer ${token}` } });
    const body = profileRes.json();
    expect(body.stats.runsPlayed).toBe(1);
    expect(body.stats.piecesPlaced).toBe(actions.length);
    expect(body.bestRun).toEqual({ score: finalState.score, achievedAt: expect.any(String) });
  });
});

describe("POST /api/profile/wallet", () => {
  // A real user-friendly TON address is 48 base64url characters.
  const SAMPLE_ADDRESS = "UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  it("rejects without a session token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/profile/wallet", payload: { tonAddress: SAMPLE_ADDRESS } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a string that isn't a recognizable TON address", async () => {
    const { token } = await sessionFor(3);
    const res = await app.inject({
      method: "POST",
      url: "/api/profile/wallet",
      headers: { authorization: `Bearer ${token}` },
      payload: { tonAddress: "not-a-wallet-address" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("links a wallet address and persists it across a later /api/profile fetch", async () => {
    const { token } = await sessionFor(4);

    const linkRes = await app.inject({
      method: "POST",
      url: "/api/profile/wallet",
      headers: { authorization: `Bearer ${token}` },
      payload: { tonAddress: SAMPLE_ADDRESS },
    });
    expect(linkRes.statusCode).toBe(200);
    expect(linkRes.json().tonAddress).toBe(SAMPLE_ADDRESS);

    const profileRes = await app.inject({ method: "GET", url: "/api/profile", headers: { authorization: `Bearer ${token}` } });
    expect(profileRes.json().tonAddress).toBe(SAMPLE_ADDRESS);
  });

  it("unlinks a wallet by sending tonAddress: null", async () => {
    const { token } = await sessionFor(5);
    await app.inject({
      method: "POST",
      url: "/api/profile/wallet",
      headers: { authorization: `Bearer ${token}` },
      payload: { tonAddress: SAMPLE_ADDRESS },
    });

    const unlinkRes = await app.inject({
      method: "POST",
      url: "/api/profile/wallet",
      headers: { authorization: `Bearer ${token}` },
      payload: { tonAddress: null },
    });
    expect(unlinkRes.statusCode).toBe(200);
    expect(unlinkRes.json().tonAddress).toBeNull();

    const profileRes = await app.inject({ method: "GET", url: "/api/profile", headers: { authorization: `Bearer ${token}` } });
    expect(profileRes.json().tonAddress).toBeNull();
  });
});
