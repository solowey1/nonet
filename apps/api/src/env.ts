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
