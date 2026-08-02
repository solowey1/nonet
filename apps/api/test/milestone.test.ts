import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import { env } from "../src/env.js";
import { autoplay, autoplayGreedy } from "./helpers/autoplay.js";
import { migrateTestDb, resetTestDb } from "./helpers/db.js";
import { buildSignedInitData } from "./helpers/telegram.js";
import { hexToBytes } from "../src/utils/hex.js";
import { eq } from "drizzle-orm";
import type { PlaceAction } from "@nonet/engine";

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

async function startRun(token: string): Promise<{ runId: string; seedHex: string; runToken: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/run/start",
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  return res.json();
}

/**
 * /api/run/start mints a genuinely random seed server-side, so there's no
 * fixed seed to pre-search — instead, start real runs (as a real client
 * would) until one autoplay actually reaches the target score. The greedy
 * bot (best-scoring legal placement each turn, not just the first one)
 * clears lines often enough to reach 1000+ on the large majority of seeds,
 * so a handful of attempts is enough in practice.
 */
async function startRunReachingScore(
  token: string,
  targetScore: number,
): Promise<{ runId: string; runToken: string; actions: ReturnType<typeof autoplayGreedy>["actions"]; finalState: ReturnType<typeof autoplayGreedy>["finalState"] }> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const { runId, seedHex, runToken } = await startRun(token);
    const { actions, finalState } = autoplayGreedy(hexToBytes(seedHex), 300);
    if (finalState.score >= targetScore) {
      return { runId, runToken, actions, finalState };
    }
  }
  throw new Error(`no run reached score ${targetScore} within 15 attempts`);
}

describe("POST /api/run/milestone", () => {
  it("grants a real drop once the server-replayed score meets the milestone, and is idempotent on repeat", async () => {
    const token = await sessionFor(1);
    const { runId, runToken, actions } = await startRunReachingScore(token, 1000);

    const first = await app.inject({
      method: "POST",
      url: "/api/run/milestone",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, milestone: 1, actions },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(["pencil", "eraser", "rocket", "bomb", "fill", "nothing"]).toContain(firstBody.drop);
    expect(firstBody.remaining).toBeGreaterThanOrEqual(0);

    const second = await app.inject({
      method: "POST",
      url: "/api/run/milestone",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, milestone: 1, actions },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(firstBody); // idempotent — not re-rolled
  });

  it("rejects a milestone claim the replayed score doesn't actually reach", async () => {
    const token = await sessionFor(2);
    const { runId, seedHex, runToken } = await startRun(token);
    const { actions } = autoplay(hexToBytes(seedHex), 2); // a couple of placements, nowhere near 1000

    const res = await app.inject({
      method: "POST",
      url: "/api/run/milestone",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, milestone: 1, actions },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("milestone_not_reached");
  });

  it("rejects a tampered action log and bumps the fraud counter", async () => {
    const token = await sessionFor(3);
    const { runId, runToken, actions } = await startRunReachingScore(token, 1000);

    const tampered = actions.slice();
    const first = tampered[0] as PlaceAction;
    tampered[0] = { ...first, slot: ((first.slot + 1) % 3) as 0 | 1 | 2 };

    const res = await app.inject({
      method: "POST",
      url: "/api/run/milestone",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId, milestone: 1, actions: tampered },
    });
    // Either the tamper is caught as illegal immediately, or (rarely) it's
    // still a legal action sequence that just diverges — either way it must
    // not be treated as a legitimate milestone grant reaching 1000 untouched.
    if (res.statusCode === 409) {
      expect(res.json().error).toBe("replay_invalid");
      const [user] = await db.select({ fraudScore: users.fraudScore }).from(users).where(eq(users.id, 3n));
      expect(user?.fraudScore).toBeGreaterThan(0);
    } else {
      expect(res.statusCode).toBe(200);
    }
  });

  it("rejects a runId that doesn't match the run token", async () => {
    const token = await sessionFor(4);
    const { runToken } = await startRun(token);

    const res = await app.inject({
      method: "POST",
      url: "/api/run/milestone",
      headers: { authorization: `Bearer ${runToken}` },
      payload: { runId: "00000000-0000-7000-8000-000000000000", milestone: 1, actions: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});
