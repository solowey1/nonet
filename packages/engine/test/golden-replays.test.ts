/**
 * Golden-replay corpus (§17): ~20 recorded runs, frozen at a point in time.
 * Any engine change that alters these scores/hashes must be a deliberate,
 * reviewed break — regenerate via `pnpm exec tsx scripts/generate-golden.ts`
 * and diff the fixture, don't just silently accept a failing test here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Action } from "../src/reduce.js";
import { replay } from "../src/replay.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface GoldenFixture {
  readonly seedIndex: number;
  readonly seedHex: string;
  readonly actions: Action[];
  readonly expectedScore: number;
  readonly expectedHash: string;
  readonly expectedStatus: string;
}

const fixtures: GoldenFixture[] = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "golden-replays.json"), "utf-8"),
);

function seedFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

describe("golden replay corpus", () => {
  it("has at least 20 fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  for (const fixture of fixtures) {
    it(`reproduces seed index ${fixture.seedIndex} exactly`, () => {
      const seedBytes = seedFromHex(fixture.seedHex);
      const result = replay(seedBytes, fixture.actions);
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.score).toBe(fixture.expectedScore);
      expect(result.hash).toBe(fixture.expectedHash);
      expect(result.finalState.status).toBe(fixture.expectedStatus);
    });
  }
});
