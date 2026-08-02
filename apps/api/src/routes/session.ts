import { devSessionRequestSchema, sessionRequestSchema, sessionResponseSchema } from "@nonet/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { db } from "../db/client.js";
import { inventoryBalance, runs, users } from "../db/schema.js";
import { env } from "../env.js";
import { evaluateLoginAchievements } from "../services/achievements.js";
import { grantDailyGiftIfNeeded } from "../services/dailyGift.js";
import { grantWelcomeGift } from "../services/inventory.js";
import { validateInitData } from "../telegram/initData.js";

interface ProfileFields {
  readonly id: number;
  readonly username?: string | undefined;
  readonly firstName?: string | undefined;
  readonly photoUrl?: string | undefined;
  readonly languageCode?: string | undefined;
  readonly isPremium?: boolean | undefined;
}

async function issueSession(reply: FastifyReply, profile: ProfileFields) {
  const userId = BigInt(profile.id);

  // onConflictDoNothing + returning tells us, atomically, whether this is a
  // brand-new user — that's the signal to grant the welcome gift below,
  // rather than a separate (racy) existence check.
  const insertedRows = await db
    .insert(users)
    .values({
      id: userId,
      username: profile.username ?? null,
      firstName: profile.firstName ?? null,
      photoUrl: profile.photoUrl ?? null,
      languageCode: profile.languageCode ?? null,
      isPremium: profile.isPremium ?? false,
    })
    .onConflictDoNothing({ target: users.id })
    .returning({ id: users.id });

  if (insertedRows.length > 0) {
    await grantWelcomeGift(db, userId);
  } else {
    await db
      .update(users)
      .set({
        username: profile.username ?? null,
        firstName: profile.firstName ?? null,
        photoUrl: profile.photoUrl ?? null,
        languageCode: profile.languageCode ?? null,
        isPremium: profile.isPremium ?? false,
        lastSeenAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  const dailyGift = await grantDailyGiftIfNeeded(db, userId);
  await evaluateLoginAchievements(db, userId, dailyGift.streak);

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

  let activeRun = null;
  if (openRun) {
    const runToken = await reply.jwtSign(
      { sub: userId.toString(), runId: openRun.id },
      { expiresIn: env.RUN_TOKEN_TTL_SECONDS },
    );
    activeRun = { runId: openRun.id, seedHex: openRun.seed, actions: openRun.actions, runToken };
  }

  return sessionResponseSchema.parse({
    token,
    user: {
      id: userId.toString(),
      username: profile.username ?? null,
      firstName: profile.firstName ?? null,
      photoUrl: profile.photoUrl ?? null,
      languageCode: profile.languageCode ?? null,
      isPremium: profile.isPremium ?? false,
    },
    inventory,
    activeRun,
    dailyGift,
  });
}

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
    const body = await issueSession(reply, {
      id: tgUser.id,
      username: tgUser.username,
      firstName: tgUser.first_name,
      photoUrl: tgUser.photo_url,
      languageCode: tgUser.language_code,
      isPremium: tgUser.is_premium,
    });
    return reply.send(body);
  });

  if (env.ALLOW_DEV_SESSION) {
    app.log.warn("ALLOW_DEV_SESSION is enabled — /api/session/dev bypasses initData validation entirely");

    app.post("/api/session/dev", async (request, reply) => {
      const parsed = devSessionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const body = await issueSession(reply, { id: parsed.data.userId, username: parsed.data.username });
      return reply.send(body);
    });
  }
}
