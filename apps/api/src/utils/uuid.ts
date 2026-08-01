import { randomBytes } from "node:crypto";

/**
 * UUID v7 (§9: "runId (uuid v7)") — time-ordered, so run ids sort
 * chronologically and index well. Node's `crypto.randomUUID()` only
 * produces v4, so this is a small manual implementation of RFC 9562 §5.7:
 * a 48-bit millisecond timestamp followed by 74 random bits, with the
 * version/variant nibbles set.
 */
export function randomUuidV7(): string {
  const bytes = randomBytes(16);
  const now = BigInt(Date.now());

  bytes[0] = Number((now >> 40n) & 0xffn);
  bytes[1] = Number((now >> 32n) & 0xffn);
  bytes[2] = Number((now >> 24n) & 0xffn);
  bytes[3] = Number((now >> 16n) & 0xffn);
  bytes[4] = Number((now >> 8n) & 0xffn);
  bytes[5] = Number(now & 0xffn);

  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // variant 10xxxxxx

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
