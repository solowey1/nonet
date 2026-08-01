import { sessionRequestSchema, sessionResponseSchema } from "@nonet/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { inventoryBalance, runs, users } from "../db/schema.js";
import { env } from "../env.js";
import { validateInitData } from "../telegram/initData.js";

export async function sessionRoutes(app: FastifyInstance) {
  app.post("/api/session", async (request, reply) => {
    const parsed = sessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const validation = validateInitData(parsed.data.initData, env.BOT_TOKEN, env.INIT_DATA_MAX_AGE_SECONDS);
    if (!validation.ok) {
      return reply.code(401).send({ error: "invalid_init_data", reason: validation.error.reason });
    }

    const { user: tgUser } = validation.data;
    const userId = BigInt(tgUser.id);

    await db
      .insert(users)
      .values({
        id: userId,
        username: tgUser.username ?? null,
        firstName: tgUser.first_name ?? null,
        photoUrl: tgUser.photo_url ?? null,
        languageCode: tgUser.language_code ?? null,
        isPremium: tgUser.is_premium ?? false,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          username: tgUser.username ?? null,
          firstName: tgUser.first_name ?? null,
          photoUrl: tgUser.photo_url ?? null,
          languageCode: tgUser.language_code ?? null,
          isPremium: tgUser.is_premium ?? false,
          lastSeenAt: new Date(),
        },
      });

    const inventoryRows = await db
      .select({ item: inventoryBalance.item, qty: inventoryBalance.qty })
      .from(inventoryBalance)
      .where(eq(inventoryBalance.userId, userId));
    const inventory: Record<string, number> = {};
    for (const row of inventoryRows) inventory[row.item] = row.qty;

    const [openRun] = await db
      .select({ id: runs.id, seed: runs.seed, actions: runs.actions })
      .from(runs)
      .where(and(eq(runs.userId, userId), isNull(runs.endedAt)))
      .orderBy(desc(runs.startedAt))
      .limit(1);

    const token = await reply.jwtSign({ sub: userId.toString() }, { expiresIn: env.SESSION_TOKEN_TTL_SECONDS });

    const body = sessionResponseSchema.parse({
      token,
      user: {
        id: userId.toString(),
        username: tgUser.username ?? null,
        firstName: tgUser.first_name ?? null,
        photoUrl: tgUser.photo_url ?? null,
        languageCode: tgUser.language_code ?? null,
        isPremium: tgUser.is_premium ?? false,
      },
      inventory,
      activeRun: openRun
        ? { runId: openRun.id, seedHex: openRun.seed, actions: openRun.actions }
        : null,
    });
    return reply.send(body);
  });
}
