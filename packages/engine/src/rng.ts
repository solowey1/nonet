/**
 * Deterministic, dependency-free PRNG: xorshift128+.
 *
 * No `Math.random`, no hidden module-level state — every function takes an
 * explicit `RngState` and returns the next value alongside the *new* state,
 * so callers thread it through immutably (it becomes part of `GameState`).
 */

const MASK64 = (1n << 64n) - 1n;

export interface RngState {
  readonly s0: bigint;
  readonly s1: bigint;
}

/** splitmix64 — used only to expand a small/weak seed into two well-mixed 64-bit words. */
function splitmix64(seed: bigint): { value: bigint; next: bigint } {
  let z = (seed + 0x9e3779b97f4a7c15n) & MASK64;
  const state = z;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  z = z ^ (z >> 31n);
  return { value: z, next: state };
}

/** Build an RNG state from any 64-bit bigint seed (expanded via splitmix64). */
export function createRngFromSeed(seed: bigint): RngState {
  const a = splitmix64(seed & MASK64);
  const b = splitmix64(a.next);
  let s0 = a.value;
  let s1 = b.value;
  if (s0 === 0n && s1 === 0n) {
    // xorshift128+ requires non-zero state.
    s1 = 1n;
  }
  return { s0, s1 };
}

/** Build an RNG state from a 128-bit (16-byte) seed, e.g. server-generated run seed. */
export function createRngFromBytes(bytes: Uint8Array): RngState {
  if (bytes.length < 16) {
    throw new Error("createRngFromBytes requires at least 16 bytes");
  }
  let s0 = 0n;
  let s1 = 0n;
  for (let i = 0; i < 8; i++) {
    s0 |= BigInt(bytes[i] ?? 0) << BigInt(8 * i);
    s1 |= BigInt(bytes[i + 8] ?? 0) << BigInt(8 * i);
  }
  if (s0 === 0n && s1 === 0n) {
    s1 = 1n;
  }
  return { s0, s1 };
}

/** Parse a 32-hex-char (16-byte) seed string, e.g. as stored in Postgres `bytea`. */
export function createRngFromHex(hex: string): RngState {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length !== 32) {
    throw new Error("createRngFromHex requires a 32-character hex string (128 bits)");
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return createRngFromBytes(bytes);
}

/** Single xorshift128+ step. Returns the next 64-bit value and the advanced state. */
export function nextUint64(state: RngState): [bigint, RngState] {
  let s1 = state.s0;
  const s0 = state.s1;
  const result = (s0 + s1) & MASK64;
  s1 ^= (s1 << 23n) & MASK64;
  s1 ^= s1 >> 18n;
  s1 ^= s0;
  s1 ^= s0 >> 5n;
  return [result, { s0, s1 }];
}

/** Uniform in [0, 2^32). */
export function nextUint32(state: RngState): [number, RngState] {
  const [value, next] = nextUint64(state);
  return [Number(value & 0xffffffffn), next];
}

/** Uniform float in [0, 1). */
export function nextFloat(state: RngState): [number, RngState] {
  const [value, next] = nextUint64(state);
  // Use the top 53 bits for full double precision.
  const mantissa = value >> 11n;
  return [Number(mantissa) / 9007199254740992 /* 2^53 */, next];
}

/** Uniform integer in [0, maxExclusive). maxExclusive must be a positive safe integer. */
export function nextInt(state: RngState, maxExclusive: number): [number, RngState] {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("nextInt requires a positive integer bound");
  }
  const [value, next] = nextUint64(state);
  return [Number(value % BigInt(maxExclusive)), next];
}

/**
 * Pick an index from `weights` proportional to weight. Weights <= 0 are never picked
 * (unless every weight is <= 0, which is a caller error).
 */
export function pickWeightedIndex(state: RngState, weights: readonly number[]): [number, RngState] {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) {
    throw new Error("pickWeightedIndex requires at least one positive weight");
  }
  const [f, next] = nextFloat(state);
  let target = f * total;
  for (let i = 0; i < weights.length; i++) {
    const w = Math.max(0, weights[i] ?? 0);
    if (target < w) return [i, next];
    target -= w;
  }
  // Floating-point edge case: fall back to the last positive-weight entry.
  for (let i = weights.length - 1; i >= 0; i--) {
    if ((weights[i] ?? 0) > 0) return [i, next];
  }
  throw new Error("unreachable: no positive weight found");
}
