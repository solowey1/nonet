/**
 * grammY bot instance (§2: grammY over telegraf — better Stars/payments
 * ergonomics and typing). Phase 3 scope is deliberately thin: a `/start`
 * deep-link entry point into the Mini App. Invoices, `pre_checkout_query`,
 * and `successful_payment` handling are economy work (§19 step 5).
 */
import { Bot } from "grammy";
import { env } from "./env.js";

export const bot = new Bot(env.BOT_TOKEN);

bot.command("start", async (ctx) => {
  const startParam = ctx.match?.trim();
  const url = startParam ? `${env.WEBAPP_URL}?startapp=${encodeURIComponent(startParam)}` : env.WEBAPP_URL;

  await ctx.reply("Place, clear, chase the combo. Ready?", {
    reply_markup: {
      inline_keyboard: [[{ text: "▶️ Play NONET", web_app: { url } }]],
    },
  });
});

bot.catch((error) => {
  console.error("bot error:", error);
});
