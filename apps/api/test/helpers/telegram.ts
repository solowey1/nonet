import { createHmac } from "node:crypto";

export interface FakeTelegramUser {
  readonly id: number;
  readonly username?: string;
  readonly first_name?: string;
  readonly is_premium?: boolean;
}

/** Builds a validly-signed initData string, mirroring Telegram's real algorithm, for tests. */
export function buildSignedInitData(
  botToken: string,
  user: FakeTelegramUser,
  authDate: number = Math.floor(Date.now() / 1000),
): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAH_test");

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);

  return params.toString();
}
