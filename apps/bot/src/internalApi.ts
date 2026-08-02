/**
 * Talks to the api service's bot-only /api/internal/* routes (§13). Kept
 * deliberately tiny and dependency-free (plain fetch) — this is the only
 * thing the bot needs the api service for.
 */
import { env } from "./env.js";

async function internalFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${env.INTERNAL_API_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, "X-Internal-Secret": env.INTERNAL_API_SECRET },
  });
}

export async function validatePendingPurchase(payload: string, sku: string, amount: number): Promise<boolean> {
  const url = `/api/internal/purchases/validate?${new URLSearchParams({ payload, sku, amount: String(amount) })}`;
  try {
    const res = await internalFetch(url);
    if (!res.ok) return false;
    const body = (await res.json()) as { valid: boolean };
    return body.valid;
  } catch (err) {
    console.error("validatePendingPurchase failed:", err);
    return false;
  }
}

export async function reportStarsPayment(
  payload: string,
  telegramPaymentChargeId: string,
  starsAmount: number,
): Promise<void> {
  const res = await internalFetch("/api/internal/stars-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload, telegramPaymentChargeId, starsAmount }),
  });
  if (!res.ok) {
    throw new Error(`reportStarsPayment failed with HTTP ${res.status}`);
  }
}
