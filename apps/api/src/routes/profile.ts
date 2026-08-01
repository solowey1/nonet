import { profileResponseSchema } from "@nonet/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { runs } from "../db/schema.js";

export async function profileRoutes(app: FastifyInstance) {
  app.get("/api/profile", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.userId as bigint;

    const [stats] = await db
      .select({
        runsPlayed: sql<number>`count(*)::int`,
        piecesPlaced: sql<number>`coalesce(sum(${runs.piecesPlaced}), 0)::int`,
        perfectClears: sql<number>`coalesce(sum(${runs.perfectClears}), 0)::int`,
      })
      .from(runs)
      .where(and(eq(runs.userId, userId), eq(runs.verified, true)));

    const [bestRun] = await db
      .select({ score: runs.score, endedAt: runs.endedAt })
      .from(runs)
      .where(and(eq(runs.userId, userId), eq(runs.verified, true)))
      .orderBy(desc(runs.score))
      .limit(1);

    // Streaks/daily gifts aren't wired up yet — that's economy work (§19 step 5).
    const streak = 0;

    return reply.send(
      profileResponseSchema.parse({
        stats: {
          runsPlayed: stats?.runsPlayed ?? 0,
          piecesPlaced: stats?.piecesPlaced ?? 0,
          perfectClears: stats?.perfectClears ?? 0,
        },
        bestRun: bestRun && bestRun.endedAt ? { score: bestRun.score, achievedAt: bestRun.endedAt.toISOString() } : null,
        streak,
      }),
    );
  });
}
