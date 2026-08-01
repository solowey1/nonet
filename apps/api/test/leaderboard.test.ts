import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { runs, users } from "../src/db/schema.js";
import { migrateTestDb, resetTestDb } from "./helpers/db.js";

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

async function seedUser(id: number, username: string) {
  await db.insert(users).values({ id: BigInt(id), username });
}

async function seedRun(opts: {
  userId: number;
  score: number;
  verified?: boolean;
  usedPowerups?: boolean;
  revived?: boolean;
}) {
  await db.insert(runs).values({
    userId: BigInt(opts.userId),
    seed: "00000000000000000000000000000000",
    endedAt: new Date(),
    score: opts.score,
    verified: opts.verified ?? true,
    usedPowerups: opts.usedPowerups ?? false,
    revived: opts.revived ?? false,
  });
}

describe("GET /api/leaderboard", () => {
  it("ranks verified runs by score, best-per-user, descending", async () => {
    await seedUser(1, "alice");
    await seedUser(2, "bob");
    await seedRun({ userId: 1, score: 100 });
    await seedRun({ userId: 1, score: 500 }); // alice's best is 500, not 100
    await seedRun({ userId: 2, score: 300 });

    const res = await app.inject({ method: "GET", url: "/api/leaderboard?scope=all_time" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({ rank: 1, username: "alice", score: 500 });
    expect(body.entries[1]).toMatchObject({ rank: 2, username: "bob", score: 300 });
  });

  it("excludes unverified runs", async () => {
    await seedUser(1, "alice");
    await seedRun({ userId: 1, score: 9999, verified: false });

    const res = await app.inject({ method: "GET", url: "/api/leaderboard?scope=all_time" });
    expect(res.json().entries).toHaveLength(0);
  });

  it("pure=true excludes runs that used power-ups or were revived", async () => {
    await seedUser(1, "alice");
    await seedUser(2, "bob");
    await seedRun({ userId: 1, score: 1000, usedPowerups: true });
    await seedRun({ userId: 2, score: 200 });

    const res = await app.inject({ method: "GET", url: "/api/leaderboard?scope=all_time&pure=true" });
    const entries = res.json().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ username: "bob", score: 200 });
  });

  it("rejects an invalid scope value", async () => {
    const res = await app.inject({ method: "GET", url: "/api/leaderboard?scope=nonsense" });
    expect(res.statusCode).toBe(400);
  });
});
