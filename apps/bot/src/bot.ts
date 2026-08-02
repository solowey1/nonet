/**
 * grammY bot instance (§2: grammY over telegraf — better Stars/payments
 * ergonomics and typing). `/start` is a deep-link entry point into the Mini
 * App; the payment handlers below implement §13's Stars flow — everything
 * DB-side (crediting inventory, marking a run revived) lives in the api
 * service, reached over the internal API (see internalApi.ts), so this
 * process never touches Postgres directly.
 */
import { Bot } from "grammy";
import { env } from "./env.js";
import { reportStarsPayment, validatePendingPurchase } from "./internalApi.js";

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

// §13: must answer within 10 seconds. The payload/amount pairing was already
// fixed by Telegram at createInvoiceLink time, so the only thing worth
// checking here is that the underlying purchase is still real and pending —
// e.g. hasn't already been paid, or the SKU wasn't deactivated meanwhile.
bot.on("pre_checkout_query", async (ctx) => {
  const query = ctx.preCheckoutQuery;
  const parts = query.invoice_payload.split(":");
  if (parts.length !== 3) {
    await ctx.answerPreCheckoutQuery(false, "This invoice looks malformed. Please start a new purchase.");
    return;
  }
  const [, sku] = parts;
  const valid = await validatePendingPurchase(query.invoice_payload, sku as string, query.total_amount);
  if (!valid) {
    await ctx.answerPreCheckoutQuery(false, "This invoice is no longer valid — please try again from the shop.");
    return;
  }
  await ctx.answerPreCheckoutQuery(true);
});

// The webhook is the source of truth for a payment (§13) — this is what
// actually credits inventory / marks a run revived, via the api service.
// Deliberately doesn't catch: grammY's webhookCallback calls handleUpdate()
// directly (not the batch handleUpdates() that bot.catch() below actually
// covers), so a throw here propagates all the way out as a rejected promise —
// Fastify turns that into a 500, and Telegram retries a non-2xx webhook
// delivery later. /api/internal/stars-payment is idempotent on the charge id,
// so that retry is always safe. Swallowing the error here would silently
// strand a paid purchase with no automatic recovery.
bot.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  await reportStarsPayment(payment.invoice_payload, payment.telegram_payment_charge_id, payment.total_amount);
  // The "realtime nudge" §13 asks for — there's no push channel into an
  // open WebApp, so a normal bot reply the player can tap back into is the
  // practical equivalent.
  await ctx.reply("✅ Purchase received! Open NONET to see it in your inventory.", {
    reply_markup: { inline_keyboard: [[{ text: "▶️ Open NONET", web_app: { url: env.WEBAPP_URL } }]] },
  });
});

bot.catch((error) => {
  console.error("bot error:", error);
});
