import { profileResponseSchema, walletLinkRequestSchema, walletLinkResponseSchema } from "@nonet/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { dailyStats, runs, users } from "../db/schema.js";

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

    // Today's dailyStats row (created by grantDailyGiftIfNeeded on /api/session)
    // already carries the current consecutive-days streak (§8).
    const today = new Date().toISOString().slice(0, 10);
    const [todayStats] = await db
      .select({ streak: dailyStats.streak })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), eq(dailyStats.day, today)));
    const streak = todayStats?.streak ?? 0;

    const [user] = await db.select({ tonAddress: users.tonAddress }).from(users).where(eq(users.id, userId));

    return reply.send(
      profileResponseSchema.parse({
        stats: {
          runsPlayed: stats?.runsPlayed ?? 0,
          piecesPlaced: stats?.piecesPlaced ?? 0,
          perfectClears: stats?.perfectClears ?? 0,
        },
        bestRun: bestRun && bestRun.endedAt ? { score: bestRun.score, achievedAt: bestRun.endedAt.toISOString() } : null,
        streak,
        tonAddress: user?.tonAddress ?? null,
      }),
    );
  });

  // §14 stub: links (or clears, if tonAddress is null) a TON Connect wallet
  // address for future Gram reward payouts. Deliberately does NOT verify the
  // wallet's `ton_proof` signature — no funds or rewards flow through this
  // address yet, so trusting whatever TonConnect UI reports client-side is a
  // reasonable stub boundary rather than a production security posture (see
  // DECISIONS.md). Real payouts would need that verification added first.
  app.post("/api/profile/wallet", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = walletLinkRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const userId = request.userId as bigint;

    await db.update(users).set({ tonAddress: parsed.data.tonAddress }).where(eq(users.id, userId));

    return reply.send(walletLinkResponseSchema.parse({ tonAddress: parsed.data.tonAddress }));
  });
}
