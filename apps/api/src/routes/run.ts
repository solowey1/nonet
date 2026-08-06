import { randomBytes } from "node:crypto";
import {
  runCheckpointRequestSchema,
  runFinishRequestSchema,
  runFinishResponseSchema,
  runStartResponseSchema,
} from "@nonet/shared";
import { replay } from "@nonet/engine";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { inventoryLedger, runs, users } from "../db/schema.js";
import { env } from "../env.js";
import { evaluateRunAchievements } from "../services/achievements.js";
import { validateConsumeTokens } from "../services/inventory.js";
import { bytesToHex, hexToBytes } from "../utils/hex.js";
import { randomUuidV7 } from "../utils/uuid.js";

export async function runRoutes(app: FastifyInstance) {
  app.post("/api/run/start", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.userId as bigint;
    const runId = randomUuidV7();
    const seedHex = bytesToHex(randomBytes(16));

    await db.insert(runs).values({ id: runId, userId, seed: seedHex });

    const runToken = await reply.jwtSign({ sub: userId.toString(), runId }, { expiresIn: env.RUN_TOKEN_TTL_SECONDS });

    return reply.send(runStartResponseSchema.parse({ runId, seedHex, runToken }));
  });

  app.post("/api/run/checkpoint", { preHandler: app.authenticateRun }, async (request, reply) => {
    const parsed = runCheckpointRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    if (parsed.data.runId !== request.runId) {
      return reply.code(403).send({ error: "run_token_mismatch" });
    }

    const userId = request.userId as bigint;
    const result = await db
      .update(runs)
      .set({ actions: parsed.data.actions })
      .where(and(eq(runs.id, parsed.data.runId), eq(runs.userId, userId), isNull(runs.endedAt)));

    if (result.count === 0) {
      return reply.code(404).send({ error: "run_not_found_or_finished" });
    }
    return reply.send({ ok: true });
  });

  const finishRouteOptions = {
    preHandler: app.authenticateRun,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  };

  app.post("/api/run/finish", finishRouteOptions, async (request, reply) => {
    const parsed = runFinishRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    if (parsed.data.runId !== request.runId) {
      return reply.code(403).send({ error: "run_token_mismatch" });
    }

    const userId = request.userId as bigint;
    const [run] = await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, parsed.data.runId), eq(runs.userId, userId)))
      .limit(1);

    if (!run) return reply.code(404).send({ error: "run_not_found" });
    if (run.endedAt) return reply.code(409).send({ error: "run_already_finished" });

    const { actions } = parsed.data;
    const result = replay(hexToBytes(run.seed), actions);
    const usedPowerups = actions.some((a) => a.type === "powerup");
    const revived = actions.some((a) => a.type === "revive");

    // The engine's replay has no concept of inventory, so a log that
    // fabricates or double-spends power-up actions would otherwise pass
    // replay verification untouched — this is a separate, equally load-bearing
    // check (§9).
    const consumeTokensOk = result.valid ? await validateConsumeTokens(db, userId, run.id, actions) : true;
    const verified = result.valid && consumeTokensOk;

    if (verified) {
      await db
        .update(runs)
        .set({
          endedAt: new Date(),
          score: result.score,
          unitsCleared: result.finalState.unitsCleared,
          maxCombo: result.finalState.maxComboLevel,
          piecesPlaced: result.finalState.piecesPlaced,
          perfectClears: result.finalState.perfectClears,
          usedPowerups,
          powerupsUsed: result.finalState.powerupsUsed,
          revived,
          verified: true,
          actions,
        })
        .where(eq(runs.id, run.id));
    } else {
      // §9: never surface a scary error — just store unverified, exclude from
      // leaderboards, award no drops, and nudge the fraud counter.
      app.log.warn(
        {
          runId: run.id,
          userId: userId.toString(),
          replayReason: result.valid ? undefined : result.reason,
          replayError: result.valid ? undefined : result.error,
          consumeTokensOk,
        },
        "run failed verification",
      );
      await db
        .update(runs)
        .set({
          endedAt: new Date(),
          score: result.valid ? result.score : result.scoreSoFar,
          usedPowerups,
          revived,
          verified: false,
          actions,
        })
        .where(eq(runs.id, run.id));
      await db
        .update(users)
        .set({ fraudScore: sql`${users.fraudScore} + 1` })
        .where(eq(users.id, userId));
    }

    let rank: number | null = null;
    let unlockedAchievements: string[] = [];
    if (verified) {
      const finalScore = result.valid ? result.score : 0;
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(runs)
        .where(and(eq(runs.verified, true), gt(runs.score, finalScore)));
      rank = (countRow?.count ?? 0) + 1;

      // §9: same trust boundary as the rank/leaderboard bump above — only a
      // replay-verified run can earn achievement rewards.
      const unlocked = await evaluateRunAchievements(db, userId, {
        score: result.score,
        maxCombo: result.finalState.maxComboLevel,
        unitsCleared: result.finalState.unitsCleared,
        perfectClears: result.finalState.perfectClears,
        usedPowerups,
      });
      unlockedAchievements = unlocked.map((u) => u.id);
    }

    // Every milestone drop actually earned this run — informational only,
    // items were already granted at milestone time (§8).
    const dropRows = await db
      .select({ item: inventoryLedger.item })
      .from(inventoryLedger)
      .where(and(eq(inventoryLedger.runId, run.id), eq(inventoryLedger.reason, "drop")));
    const drops = dropRows.map((r) => r.item).filter((item) => item !== "nothing");

    return reply.send(
      runFinishResponseSchema.parse({
        score: result.valid ? result.score : result.scoreSoFar,
        verified,
        drops,
        rank,
        unlockedAchievements,
      }),
    );
  });
}
