import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.union([z.literal("development"), z.literal("test"), z.literal("production")]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  BOT_TOKEN: z.string().min(1),
  // Verified against the `X-Telegram-Bot-Api-Secret-Token` header on every
  // webhook delivery (§12) — must match what was passed to `setWebhook`.
  WEBHOOK_SECRET: z.string().min(1),
  // Where the "Play NONET" button opens — the single-origin Mini App (§0.4).
  WEBAPP_URL: z.string().url(),
  // If set, the bot registers this as its webhook URL with Telegram on boot.
  // Left unset in local dev, where the webhook is configured manually/out of band.
  PUBLIC_WEBHOOK_URL: z.string().url().optional(),
  // Where to reach the api service's /api/internal/* routes (§13's Stars
  // flow) — the docker-compose service name internally, localhost in local dev.
  INTERNAL_API_URL: z.string().url().default("http://api:3000"),
  INTERNAL_API_SECRET: z.string().min(16),
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
