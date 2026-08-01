import { leaderboardQuerySchema, leaderboardResponseSchema } from "@nonet/shared";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";

const SCOPE_INTERVAL: Record<string, string | null> = {
  daily: "1 day",
  weekly: "7 days",
  all_time: null,
};

/**
 * Best verified score per user (§8: Open = everything verified; Pure = zero
 * power-ups and zero revives), deduped with DISTINCT ON since a leaderboard
 * shows a player's best run, not every run — drizzle's query builder doesn't
 * have a clean DISTINCT ON, so this one route drops to a raw parameterised
 * query instead of pretending the builder fits.
 */
export async function leaderboardRoutes(app: FastifyInstance) {
  app.get("/api/leaderboard", { preHandler: app.optionalAuthenticate }, async (request, reply) => {
    const parsed = leaderboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const { scope, pure, around } = parsed.data;
    void around; // "around me" paging is a nice-to-have deferred past Phase 3 — see DECISIONS.md

    const interval = SCOPE_INTERVAL[scope];
    const pureFilter = pure ? sql`and r.used_powerups = false and r.revived = false` : sql``;
    const scopeFilter = interval ? sql`and r.ended_at >= now() - ${interval}::interval` : sql``;

    const rows = await db.execute<{
      user_id: string;
      username: string | null;
      photo_url: string | null;
      score: number;
      achieved_at: Date;
      rn: number;
    }>(sql`
      select * from (
        select
          r.user_id,
          u.username,
          u.photo_url,
          r.score,
          r.ended_at as achieved_at,
          row_number() over (partition by r.user_id order by r.score desc) as rn
        from runs r
        join users u on u.id = r.user_id
        where r.verified = true ${scopeFilter} ${pureFilter}
      ) best
      where rn = 1
      order by score desc
      limit 50
    `);

    const entries = rows.map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      username: row.username,
      photoUrl: row.photo_url,
      score: row.score,
      achievedAt: new Date(row.achieved_at).toISOString(),
    }));

    let me: (typeof entries)[number] | null = null;
    if (request.userId !== undefined) {
      const idx = entries.findIndex((e) => e.userId === (request.userId as bigint).toString());
      if (idx >= 0) me = entries[idx] as (typeof entries)[number];
    }

    return reply.send(leaderboardResponseSchema.parse({ entries, me }));
  });
}
