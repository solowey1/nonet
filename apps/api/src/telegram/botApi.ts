/**
 * The one Bot API call the api service itself needs to make directly
 * (§13's `createInvoiceLink`) — everything else Telegram-protocol-shaped
 * (webhook updates, pre_checkout_query, successful_payment) is grammY's
 * job over in apps/bot. No need to pull grammY into this service for a
 * single POST.
 */
import { env } from "../env.js";

export interface CreateInvoiceLinkParams {
  readonly title: string;
  readonly description: string;
  readonly payload: string;
  readonly starsAmount: number;
}

export async function createInvoiceLink(params: CreateInvoiceLinkParams): Promise<string> {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: params.title,
      description: params.description,
      payload: params.payload,
      currency: "XTR",
      prices: [{ label: params.title, amount: params.starsAmount }],
      provider_token: "", // must be empty for Stars (§13)
    }),
  });

  const json = (await res.json()) as { ok: boolean; result?: string; description?: string };
  if (!json.ok || !json.result) {
    throw new Error(`createInvoiceLink failed: ${json.description ?? `HTTP ${res.status}`}`);
  }
  return json.result;
}
