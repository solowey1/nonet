/**
 * All configuration in one validated place. Every variable here must also be
 * documented in the root `.env.example` — undocumented env vars are a
 * deploy-time footgun waiting to happen.
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.union([z.literal("development"), z.literal("test"), z.literal("production")]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  SESSION_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  RUN_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600 * 6),
  // §12: reject initData older than this when minting a session.
  INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  CORS_ORIGIN: z.string().optional(),
  // Enables POST /api/session/dev, which mints a session for an arbitrary
  // user id WITHOUT validating initData — for local web dev only, where
  // there's no real Telegram WebView to supply it. Requires an explicit
  // opt-in (not just NODE_ENV) so it can never be live by accident; see
  // DECISIONS.md.
  ALLOW_DEV_SESSION: z.coerce.boolean().default(false),
  // Shared secret the bot service presents (as a header) when forwarding a
  // paid Stars payment. nginx denies /api/internal/* at the edge (see
  // docker/nginx/nginx.conf) so this is defense in depth, not the only guard.
  INTERNAL_API_SECRET: z.string().min(16),
  // Already required by the bot service for its own "Play NONET" button;
  // the api service also reads it to serve a same-origin TON Connect
  // manifest (§14) whose `url`/`iconUrl` must be this deployment's real
  // public origin. Defaulted (unlike the bot's) since it's a stub feature,
  // not something worth hard-failing local/CI runs over.
  WEBAPP_URL: z.string().url().default("http://localhost:5173"),
  // §19 round 7: the bot's @username, used to build the t.me deep link that
  // actually *launches* the Mini App when a player shares their score — a
  // plain WEBAPP_URL link only opens the website, which can't start a Mini
  // App. Optional rather than required on purpose: an unset value degrades
  // sharing back to the website link, which is strictly better than a whole
  // API that refuses to boot over a share button.
  BOT_USERNAME: z.string().min(1).optional(),
  // Only needed if the Mini App is a *named* one (BotFather "Web Apps" ->
  // short name), giving `t.me/<bot>/<short>`. Leave unset when it's the
  // bot's Main Mini App, which `t.me/<bot>?startapp=` opens directly.
  MINI_APP_SHORT_NAME: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment configuration:", result.error.flatten().fieldErrors);
    throw new Error("invalid environment configuration");
  }
  return result.data;
}

export const env = loadEnv();
