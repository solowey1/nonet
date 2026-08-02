/**
 * Bot-to-api only (§13's Stars flow) — verified by a shared secret header
 * AND denied at the nginx edge (docker/nginx/nginx.conf), so a leaked secret
 * alone still isn't enough to reach this from outside the docker network.
 */
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { inventoryBalance, inventoryLedger, purchases, runs, shopSkus } from "../db/schema.js";
import { env } from "../env.js";

const validatePayloadQuerySchema = z.object({
  payload: z.string(),
  sku: z.string(),
  amount: z.coerce.number().int().positive(),
});

const starsPaymentBodySchema = z.object({
  payload: z.string(),
  telegramPaymentChargeId: z.string(),
  starsAmount: z.number().int().positive(),
});

function requireInternalSecret(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.headers["x-internal-secret"] !== env.INTERNAL_API_SECRET) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

export async function internalRoutes(app: FastifyInstance) {
  // Called from the bot's pre_checkout_query handler (§13), which must
  // answer within 10 seconds — validates that the invoice being paid still
  // corresponds to a real, still-pending, amount-matching purchase.
  app.get("/api/internal/purchases/validate", async (request, reply) => {
    if (!requireInternalSecret(request, reply)) return;
    const parsed = validatePayloadQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ valid: false, reason: "invalid_request" });

    const [row] = await db
      .select({ sku: purchases.sku, starsAmount: purchases.starsAmount, status: purchases.status })
      .from(purchases)
      .where(eq(purchases.payload, parsed.data.payload));

    if (!row) return reply.send({ valid: false, reason: "no_such_purchase" });
    if (row.status !== "pending") return reply.send({ valid: false, reason: "not_pending" });
    if (row.sku !== parsed.data.sku) return reply.send({ valid: false, reason: "sku_mismatch" });
    if (row.starsAmount !== parsed.data.amount) return reply.send({ valid: false, reason: "amount_mismatch" });
    return reply.send({ valid: true });
  });

  // Called from the bot's successful_payment handler (§13). Idempotent
  // against Telegram's redelivery two ways: by charge id (already fully
  // processed) and by payload+status (the UPDATE only matches a still-pending row).
  app.post("/api/internal/stars-payment", async (request, reply) => {
    if (!requireInternalSecret(request, reply)) return;
    const parsed = starsPaymentBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const { payload, telegramPaymentChargeId, starsAmount } = parsed.data;

    const [alreadyProcessed] = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.telegramPaymentChargeId, telegramPaymentChargeId));
    if (alreadyProcessed) {
      return reply.send({ ok: true, alreadyProcessed: true });
    }

    const [updated] = await db
      .update(purchases)
      .set({ telegramPaymentChargeId, status: "paid" })
      .where(and(eq(purchases.payload, payload), eq(purchases.status, "pending")))
      .returning();

    if (!updated) {
      app.log.warn({ payload }, "stars payment for an unknown or already-processed pending purchase");
      return reply.send({ ok: true, alreadyProcessed: true });
    }

    if (updated.starsAmount !== starsAmount) {
      app.log.warn(
        { payload, expected: updated.starsAmount, received: starsAmount },
        "stars payment amount did not match the invoice — crediting anyway, flag for review",
      );
    }

    const [skuRow] = await db.select({ contents: shopSkus.contents }).from(shopSkus).where(eq(shopSkus.sku, updated.sku));
    const contents = (skuRow?.contents ?? {}) as Record<string, number>;
    for (const [item, qty] of Object.entries(contents)) {
      await db
        .insert(inventoryLedger)
        .values({ userId: updated.userId, item, delta: qty, reason: "purchase", ref: updated.id, runId: updated.runId });
      await db
        .insert(inventoryBalance)
        .values({ userId: updated.userId, item, qty })
        .onConflictDoUpdate({
          target: [inventoryBalance.userId, inventoryBalance.item],
          set: { qty: sql`${inventoryBalance.qty} + ${qty}` },
        });
    }

    if (updated.sku === "revive" && updated.runId) {
      await db.update(runs).set({ revived: true }).where(eq(runs.id, updated.runId));
    }

    return reply.send({ ok: true, alreadyProcessed: false });
  });
}
