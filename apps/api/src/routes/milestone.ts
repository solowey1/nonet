import { runMilestoneRequestSchema, runMilestoneResponseSchema } from "@nonet/shared";
import { replay } from "@nonet/engine";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { inventoryBalance, inventoryLedger, runs, users } from "../db/schema.js";
import { rollDrop } from "../services/drops.js";
import { hexToBytes } from "../utils/hex.js";

async function existingGrant(runId: string, ref: string) {
  const [row] = await db
    .select({ item: inventoryLedger.item, userId: inventoryLedger.userId })
    .from(inventoryLedger)
    .where(and(eq(inventoryLedger.runId, runId), eq(inventoryLedger.ref, ref)));
  if (!row) return null;
  if (row.item === "nothing") return { drop: "nothing" as const, remaining: 0 };
  const [balance] = await db
    .select({ qty: inventoryBalance.qty })
    .from(inventoryBalance)
    .where(and(eq(inventoryBalance.userId, row.userId), eq(inventoryBalance.item, row.item)));
  return { drop: row.item, remaining: balance?.qty ?? 0 };
}

export async function milestoneRoutes(app: FastifyInstance) {
  app.post("/api/run/milestone", { preHandler: app.authenticateRun }, async (request, reply) => {
    const parsed = runMilestoneRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    if (parsed.data.runId !== request.runId) {
      return reply.code(403).send({ error: "run_token_mismatch" });
    }

    const userId = request.userId as bigint;
    const { runId, milestone, actions } = parsed.data;
    const ref = `milestone-${milestone}`;

    const already = await existingGrant(runId, ref);
    if (already) return reply.send(runMilestoneResponseSchema.parse(already));

    const [run] = await db
      .select({ seed: runs.seed })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.userId, userId), isNull(runs.endedAt)));
    if (!run) return reply.code(404).send({ error: "run_not_found_or_finished" });

    const result = replay(hexToBytes(run.seed), actions);
    if (!result.valid) {
      app.log.warn({ runId, userId: userId.toString(), reason: result.reason }, "milestone replay failed");
      await db
        .update(users)
        .set({ fraudScore: sql`${users.fraudScore} + 1` })
        .where(eq(users.id, userId));
      return reply.code(409).send({ error: "replay_invalid" });
    }
    if (result.score < milestone * 1000) {
      return reply.code(400).send({ error: "milestone_not_reached" });
    }

    const inventoryRows = await db
      .select({ item: inventoryBalance.item, qty: inventoryBalance.qty })
      .from(inventoryBalance)
      .where(eq(inventoryBalance.userId, userId));
    const currentInventory: Record<string, number> = {};
    for (const row of inventoryRows) currentInventory[row.item] = row.qty;

    const drop = rollDrop(currentInventory);

    try {
      await db.insert(inventoryLedger).values({ userId, item: drop, delta: drop === "nothing" ? 0 : 1, reason: "drop", ref, runId });
    } catch {
      // Unique violation on (run_id, ref): a concurrent duplicate request won the race.
      const grantedByRace = await existingGrant(runId, ref);
      if (grantedByRace) return reply.send(runMilestoneResponseSchema.parse(grantedByRace));
      throw new Error(`milestone grant race for run ${runId} ref ${ref} but no row found afterward`);
    }

    if (drop === "nothing") {
      return reply.send(runMilestoneResponseSchema.parse({ drop, remaining: 0 }));
    }

    const [updated] = await db
      .insert(inventoryBalance)
      .values({ userId, item: drop, qty: 1 })
      .onConflictDoUpdate({
        target: [inventoryBalance.userId, inventoryBalance.item],
        set: { qty: sql`${inventoryBalance.qty} + 1` },
      })
      .returning({ qty: inventoryBalance.qty });

    return reply.send(runMilestoneResponseSchema.parse({ drop, remaining: updated?.qty ?? 1 }));
  });
}
