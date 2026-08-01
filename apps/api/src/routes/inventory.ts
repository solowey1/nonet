import { inventoryConsumeRequestSchema, inventoryConsumeResponseSchema } from "@nonet/shared";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { inventoryBalance, inventoryLedger, runs } from "../db/schema.js";

/**
 * Inventory is consumed at use time, not at finish time (§9) — otherwise a
 * player can kill the app to dodge spending an item. The `consumeToken`
 * returned here is just the new `inventory_ledger` row's id: unforgeable
 * (an attacker can't produce a valid id without this endpoint having
 * actually decremented their balance) and naturally one-time-use once
 * `run/finish` checks each token is claimed by at most one action.
 */
export async function inventoryRoutes(app: FastifyInstance) {
  app.post("/api/inventory/consume", { preHandler: app.authenticateRun }, async (request, reply) => {
    const parsed = inventoryConsumeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    if (parsed.data.runId !== request.runId) {
      return reply.code(403).send({ error: "run_token_mismatch" });
    }

    const userId = request.userId as bigint;
    const { runId, item } = parsed.data;

    const [run] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.userId, userId), isNull(runs.endedAt)));
    if (!run) {
      return reply.code(404).send({ error: "run_not_found_or_finished" });
    }

    const result = await db.transaction(async (tx) => {
      const updated = await tx
        .update(inventoryBalance)
        .set({ qty: sql`${inventoryBalance.qty} - 1` })
        .where(and(eq(inventoryBalance.userId, userId), eq(inventoryBalance.item, item), gt(inventoryBalance.qty, 0)))
        .returning({ qty: inventoryBalance.qty });

      const updatedRow = updated[0];
      if (!updatedRow) return null; // insufficient inventory

      const [ledgerRow] = await tx
        .insert(inventoryLedger)
        .values({ userId, item, delta: -1, reason: "use", runId })
        .returning({ id: inventoryLedger.id });

      return { remaining: updatedRow.qty, consumeToken: (ledgerRow as { id: bigint }).id.toString() };
    });

    if (!result) {
      return reply.code(409).send({ error: "insufficient_inventory" });
    }

    return reply.send(inventoryConsumeResponseSchema.parse(result));
  });
}
