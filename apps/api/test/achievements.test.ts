import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { dailyStats, inventoryBalance, runs } from "../src/db/schema.js";
import { env } from "../src/env.js";
import { evaluateLifetimeAchievements } from "../src/services/achievements.js";
import { hexToBytes } from "../src/utils/hex.js";
import { addDaysUTC, todayUTCDateString } from "../src/utils/dates.js";
import { autoplayGreedy } from "./helpers/autoplay.js";
import { migrateTestDb, resetTestDb } from "./helpers/db.js";
import { buildSignedInitData } from "./helpers/telegram.js";

/** Inserts a verified `runs` row directly — a stand-in for "a run that already happened," so lifetime-best conditions (like first_5000's run_score) see it without replaying a full legitimate game. */
async function insertVerifiedRun(userId: bigint, score: number): Promise<void> {
  await db.insert(runs).values({ userId, seed: "00", score, verified: true, endedAt: new Date() });
}

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

async function sessionFor(userId: number): Promise<{ token: string; userId: bigint }> {
  const initData = buildSignedInitData(env.BOT_TOKEN, { id: userId, username: `user${userId}` });
  const res = await app.inject({ method: "POST", url: "/api/session", payload: { initData } });
  return { token: res.json().token as string, userId: BigInt(userId) };
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

/** Real random server seeds mean no fixed seed to pre-search — retry real runs until one reaches the target, same pattern as milestone.test.ts. */
async function finishRunReachingScore(token: string, targetScore: number): Promise<{ statusCode: number; body: any }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { runId, seedHex, runToken } = await startRun(token);
    const { actions, finalState } = autoplayGreedy(hexToBytes(seedHex), 400);
    if (finalState.score < targetScore) continue;
    const res = await app.inject({
      method: "POST",
      url: "/api/run/finish",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, actions },
    });
    return { statusCode: res.statusCode, body: res.json() };
  }
  throw new Error(`no run reached score ${targetScore} within 20 attempts`);
}

describe("GET /api/achievements", () => {
  it("lists the full catalogue, locked, for a fresh user", async () => {
    const { token } = await sessionFor(100);
    const res = await app.inject({ method: "GET", url: "/api/achievements", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const { achievements } = res.json();
    expect(achievements.length).toBeGreaterThanOrEqual(14);
    const first5000 = achievements.find((a: { id: string }) => a.id === "first_5000");
    expect(first5000).toMatchObject({ unlocked: false, timesCompleted: 0, repeatable: false });
    expect(first5000.progress).toEqual({ current: 0, target: 5000 });
  });
});

// A legitimate replayed run reliably reaching 5000 would need a much smarter
// bot than the greedy single-lookahead one these tests otherwise use (see
// milestone.test.ts) — difficulty escalation means it rarely clears that
// high in practice. The reward-branching logic itself doesn't care how a
// qualifying score was reached, so these insert a verified run row directly
// and call `evaluateLifetimeAchievements` — the same lifetime-aggregate path
// /api/session now uses for retroactive catch-up, and exactly what makes a
// run that already happened (before the achievement existed, or before this
// evaluation logic changed) unlock on the very next check rather than never.
// `weekly_50000` below covers the full HTTP round trip into this same code.
describe("achievements: first_5000 (mandatory, theme-unlock-or-fallback)", () => {
  it("unlocks Monochrome for free the first time a run crosses 5000", async () => {
    const { token, userId } = await sessionFor(101);
    await insertVerifiedRun(userId, 5000);
    const unlocked = await evaluateLifetimeAchievements(db, userId);
    expect(unlocked.map((u) => u.id)).toContain("first_5000");

    const rows = await db.select().from(inventoryBalance);
    const monochrome = rows.find((r) => r.userId === userId && r.item === "theme_monochrome");
    expect(monochrome?.qty).toBeGreaterThanOrEqual(1);

    const achRes = await app.inject({ method: "GET", url: "/api/achievements", headers: { authorization: `Bearer ${token}` } });
    const entry = achRes.json().achievements.find((a: { id: string }) => a.id === "first_5000");
    expect(entry).toMatchObject({ unlocked: true, timesCompleted: 1 });
  });

  it("grants 3 bombs instead when Monochrome is already owned", async () => {
    const { userId } = await sessionFor(102);
    // Pre-own the theme (e.g. bought outright) before ever crossing 5000.
    await db.insert(inventoryBalance).values({ userId, item: "theme_monochrome", qty: 1 });
    await insertVerifiedRun(userId, 5000);

    const unlocked = await evaluateLifetimeAchievements(db, userId);
    expect(unlocked.map((u) => u.id)).toContain("first_5000");

    const rows = await db.select().from(inventoryBalance);
    expect(rows.find((r) => r.userId === userId && r.item === "theme_monochrome")?.qty).toBe(1); // unchanged, not double-granted
    expect(rows.find((r) => r.userId === userId && r.item === "bomb")?.qty).toBeGreaterThanOrEqual(3);
  });

  it("never re-grants once earned, even on a later re-check", async () => {
    const { userId } = await sessionFor(103);
    await insertVerifiedRun(userId, 5000);
    const first = await evaluateLifetimeAchievements(db, userId);
    expect(first.map((u) => u.id)).toContain("first_5000");

    const second = await evaluateLifetimeAchievements(db, userId);
    expect(second.map((u) => u.id)).not.toContain("first_5000");
  });

  it("retroactively unlocks a run that scored 5000+ before this evaluation ever ran (a fresh session catches it up)", async () => {
    const { token, userId } = await sessionFor(105);
    // Simulate "already achieved before achievements existed" — the run row
    // is there, but nothing has ever evaluated achievements for this user.
    await insertVerifiedRun(userId, 7000);

    const achBefore = await app.inject({ method: "GET", url: "/api/achievements", headers: { authorization: `Bearer ${token}` } });
    expect(achBefore.json().achievements.find((a: { id: string }) => a.id === "first_5000").unlocked).toBe(false);

    // Any fresh /api/session call now runs the lifetime catch-up.
    const initData = buildSignedInitData(env.BOT_TOKEN, { id: 105, username: "user105" });
    await app.inject({ method: "POST", url: "/api/session", payload: { initData } });

    const achAfter = await app.inject({ method: "GET", url: "/api/achievements", headers: { authorization: `Bearer ${token}` } });
    expect(achAfter.json().achievements.find((a: { id: string }) => a.id === "first_5000")).toMatchObject({
      unlocked: true,
      timesCompleted: 1,
    });
  });
});

// §19 round 9: "Collector" moved from "own every theme" to "own 5 themes", and
// the user explicitly asked to confirm it still counts a theme that arrived as
// an achievement *reward* rather than a purchase. It does, because both paths
// write the same `inventory_balance` row — these tests pin that down.
describe("achievements: collector (owns 5 themes, however obtained)", () => {
  it("counts a theme granted by another achievement, not just purchased ones", async () => {
    const { token, userId } = await sessionFor(106);
    // Four bought outright, deliberately *not* Monochrome...
    for (const id of ["sunset", "ocean", "neon", "retrowave"]) {
      await db.insert(inventoryBalance).values({ userId, item: `theme_${id}`, qty: 1 });
    }
    // ...and the fifth arrives only as first_5000's reward.
    await insertVerifiedRun(userId, 5000);

    const unlocked = await evaluateLifetimeAchievements(db, userId);
    expect(unlocked.map((u) => u.id)).toEqual(expect.arrayContaining(["first_5000", "collector"]));

    const rows = await db.select().from(inventoryBalance);
    expect(rows.find((r) => r.userId === userId && r.item === "theme_monochrome")?.qty).toBeGreaterThanOrEqual(1);

    const entry = (await app.inject({ method: "GET", url: "/api/achievements", headers: { authorization: `Bearer ${token}` } }))
      .json()
      .achievements.find((a: { id: string }) => a.id === "collector");
    expect(entry).toMatchObject({ unlocked: true, progress: { current: 5, target: 5 } });
  });

  it("stays locked at four themes", async () => {
    const { token, userId } = await sessionFor(107);
    for (const id of ["sunset", "ocean", "neon", "monochrome"]) {
      await db.insert(inventoryBalance).values({ userId, item: `theme_${id}`, qty: 1 });
    }
    const unlocked = await evaluateLifetimeAchievements(db, userId);
    expect(unlocked.map((u) => u.id)).not.toContain("collector");

    const entry = (await app.inject({ method: "GET", url: "/api/achievements", headers: { authorization: `Bearer ${token}` } }))
      .json()
      .achievements.find((a: { id: string }) => a.id === "collector");
    expect(entry).toMatchObject({ unlocked: false, progress: { current: 4, target: 5 } });
  });
});

describe("achievements: secret catalogue (§19 round 9)", () => {
  it("marks the ten secret achievements as secret and everything else as not", async () => {
    const { token } = await sessionFor(108);
    const { achievements } = (await app.inject({ method: "GET", url: "/api/achievements", headers: { authorization: `Bearer ${token}` } })).json();
    const secrets = achievements.filter((a: { secret: boolean }) => a.secret);
    expect(secrets).toHaveLength(10);
    expect(achievements.find((a: { id: string }) => a.id === "first_5000").secret).toBe(false);
  });

  it("unlocks secret_millionaire off the lifetime score sum, not a single run", async () => {
    const { userId } = await sessionFor(109);
    for (let i = 0; i < 5; i++) await insertVerifiedRun(userId, 200_000);

    const unlocked = await evaluateLifetimeAchievements(db, userId);
    expect(unlocked.map((u) => u.id)).toContain("secret_millionaire");
    // Best *single* run is 200k, so the 50k single-run secret rides along, but
    // the millionaire one could only have come from the sum.
    expect(unlocked.map((u) => u.id)).toContain("secret_high_roller");
  });

  it("unlocks secret_no_safety_net only from a run that never revived", async () => {
    const { userId } = await sessionFor(110);
    await db.insert(runs).values({ userId, seed: "00", score: 30_000, revived: true, verified: true, endedAt: new Date() });
    expect((await evaluateLifetimeAchievements(db, userId)).map((u) => u.id)).not.toContain("secret_no_safety_net");

    await db.insert(runs).values({ userId, seed: "00", score: 30_000, revived: false, verified: true, endedAt: new Date() });
    expect((await evaluateLifetimeAchievements(db, userId)).map((u) => u.id)).toContain("secret_no_safety_net");
  });
});

describe("achievements: weekly_50000 (repeatable, rolling 7-day window)", () => {
  it("unlocks once the trailing 7 days' cumulative score crosses 50000", async () => {
    const { token, userId } = await sessionFor(104);
    const today = todayUTCDateString();
    // Seed 6 prior days with high cumulative scores, leaving today's
    // contribution (from the run below) to push the rolling sum over 50000.
    for (let i = 1; i <= 6; i++) {
      await db.insert(dailyStats).values({ userId, day: addDaysUTC(today, -i), runs: 1, bestScore: 9000, totalScore: 9000, perfectClears: 0, streak: 0 });
    }

    const { statusCode, body } = await finishRunReachingScore(token, 1);
    expect(statusCode).toBe(200);
    expect(body.unlockedAchievements).toContain("weekly_50000");

    const rows = await db.select().from(inventoryBalance);
    const mine = rows.filter((r) => r.userId === userId);
    expect(mine.find((r) => r.item === "bomb")?.qty).toBeGreaterThanOrEqual(3);
    expect(mine.find((r) => r.item === "fill")?.qty).toBeGreaterThanOrEqual(1);
  });
});
