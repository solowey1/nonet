import { randomBytes } from "node:crypto";
import { shopInvoiceRequestSchema, shopInvoiceResponseSchema, shopResponseSchema } from "@nonet/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { purchases, runs, shopSkus } from "../db/schema.js";
import { createInvoiceLink } from "../telegram/botApi.js";

export async function shopRoutes(app: FastifyInstance) {
  app.get("/api/shop", async (_request, reply) => {
    const rows = await db.select().from(shopSkus).where(eq(shopSkus.active, true)).orderBy(shopSkus.sortOrder);
    return reply.send(
      shopResponseSchema.parse({
        skus: rows.map((r) => ({
          sku: r.sku,
          title: r.title,
          description: r.description,
          starsAmount: r.starsAmount,
          contents: r.contents,
        })),
      }),
    );
  });

  app.post(
    "/api/shop/invoice",
    { preHandler: app.authenticate, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = shopInvoiceRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const userId = request.userId as bigint;

      const [skuRow] = await db
        .select()
        .from(shopSkus)
        .where(and(eq(shopSkus.sku, parsed.data.sku), eq(shopSkus.active, true)));
      if (!skuRow) return reply.code(404).send({ error: "sku_not_found" });

      let runId: string | null = null;
      if (skuRow.sku === "revive") {
        if (!parsed.data.runId) return reply.code(400).send({ error: "revive_requires_run_id" });
        const [run] = await db
          .select({ id: runs.id })
          .from(runs)
          .where(and(eq(runs.id, parsed.data.runId), eq(runs.userId, userId), isNull(runs.endedAt)));
        if (!run) return reply.code(404).send({ error: "run_not_found_or_finished" });
        runId = run.id;
      }

      // §13: payload = `${userId}:${sku}:${nonce}` — the nonce keeps repeat
      // purchases of the same SKU from colliding on the payload uniqueness
      // constraint that lets successful_payment look a pending row up later.
      const nonce = randomBytes(8).toString("hex");
      const payload = `${userId}:${skuRow.sku}:${nonce}`;

      const invoiceLink = await createInvoiceLink({
        title: skuRow.title,
        description: skuRow.description,
        payload,
        starsAmount: skuRow.starsAmount,
      });

      const [purchaseRow] = await db
        .insert(purchases)
        .values({
          userId,
          sku: skuRow.sku,
          starsAmount: skuRow.starsAmount,
          payload,
          status: "pending",
          runId,
        })
        .returning({ id: purchases.id });

      return reply.send(
        shopInvoiceResponseSchema.parse({ invoiceLink, purchaseId: (purchaseRow as { id: string }).id }),
      );
    },
  );
}
