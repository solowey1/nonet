import Fastify, { type FastifyInstance } from "fastify";
import { webhookCallback } from "grammy";
import { bot } from "./bot.js";
import { env } from "./env.js";

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: env.NODE_ENV !== "test" });

  // grammY's fastify adapter verifies the `X-Telegram-Bot-Api-Secret-Token`
  // header itself when `secretToken` is passed (§12) — a request without a
  // matching header never reaches the bot's update handlers.
  app.post("/tg/webhook", webhookCallback(bot, "fastify", { secretToken: env.WEBHOOK_SECRET }));

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}
