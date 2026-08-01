/**
 * Server-side validation of Telegram Mini App `initData` (§12). Never trust
 * `initDataUnsafe` — this is the only source of truth for who's making the
 * request.
 *
 * Algorithm, per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * (verified against current docs rather than taken solely from the brief's
 * shorthand, per §20 — the HMAC key/message order matters and is easy to get
 * backwards):
 *   secret_key = HMAC_SHA256(key = "WebAppData", message = <bot_token>)
 *   data_check_string = all initData fields except `hash`, formatted as
 *     `key=value`, sorted alphabetically by key, joined with "\n"
 *   expected_hash = HMAC_SHA256(key = secret_key, message = data_check_string)
 * The request is valid iff `expected_hash` (hex) === the received `hash`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const telegramUserSchema = z.object({
  id: z.number().int(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  photo_url: z.string().optional(),
  language_code: z.string().optional(),
  is_premium: z.boolean().optional(),
});

export interface ValidatedInitData {
  readonly user: z.infer<typeof telegramUserSchema>;
  readonly authDate: number;
  readonly startParam: string | undefined;
}

export type InitDataValidationError =
  | { readonly reason: "missing_hash" }
  | { readonly reason: "bad_signature" }
  | { readonly reason: "missing_or_invalid_user" }
  | { readonly reason: "missing_auth_date" }
  | { readonly reason: "stale"; readonly ageSeconds: number };

export type InitDataValidationResult =
  | { readonly ok: true; readonly data: ValidatedInitData }
  | { readonly ok: false; readonly error: InitDataValidationError };

function computeExpectedHash(params: URLSearchParams, botToken: string): string {
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = pairs.join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
}

export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
  now: number = Math.floor(Date.now() / 1000),
): InitDataValidationResult {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return { ok: false, error: { reason: "missing_hash" } };

  const expectedHash = computeExpectedHash(params, botToken);
  const expectedBuf = Buffer.from(expectedHash, "hex");
  const receivedBuf = Buffer.from(receivedHash, "hex");
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    return { ok: false, error: { reason: "bad_signature" } };
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) return { ok: false, error: { reason: "missing_auth_date" } };
  const authDate = Number.parseInt(authDateRaw, 10);
  const ageSeconds = now - authDate;
  if (!Number.isFinite(authDate) || ageSeconds > maxAgeSeconds) {
    return { ok: false, error: { reason: "stale", ageSeconds } };
  }

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, error: { reason: "missing_or_invalid_user" } };
  let userJson: unknown;
  try {
    userJson = JSON.parse(userRaw);
  } catch {
    return { ok: false, error: { reason: "missing_or_invalid_user" } };
  }
  const userResult = telegramUserSchema.safeParse(userJson);
  if (!userResult.success) return { ok: false, error: { reason: "missing_or_invalid_user" } };

  return {
    ok: true,
    data: {
      user: userResult.data,
      authDate,
      startParam: params.get("start_param") ?? undefined,
    },
  };
}
