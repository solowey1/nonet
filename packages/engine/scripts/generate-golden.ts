/**
 * One-off generator for the golden-replay corpus (§17): commit ~20 recorded
 * runs as fixtures. Run with `node --experimental-strip-types
 * scripts/generate-golden.ts` from packages/engine. Any future engine change
 * that alters these scores must be a deliberate, reviewed break — re-run
 * this script and diff the fixture, don't just silently regenerate it.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { replay } from "../src/replay.js";
import { autoplay, seedFromIndex } from "../test/helpers/autoplay.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURE_COUNT = 20;

interface GoldenFixture {
  readonly seedIndex: number;
  readonly seedHex: string;
  readonly actions: unknown[];
  readonly expectedScore: number;
  readonly expectedHash: string;
  readonly expectedStatus: string;
}

const fixtures: GoldenFixture[] = [];

for (let i = 0; i < FIXTURE_COUNT; i++) {
  const seedIndex = i * 1000 + 3;
  const seedBytes = seedFromIndex(seedIndex);
  const { actions } = autoplay(seedBytes);
  const result = replay(seedBytes, actions);
  if (!result.valid) {
    throw new Error(`golden generation produced an invalid replay for seed index ${seedIndex}: ${result.error}`);
  }
  fixtures.push({
    seedIndex,
    seedHex: Buffer.from(seedBytes).toString("hex"),
    actions,
    expectedScore: result.score,
    expectedHash: result.hash,
    expectedStatus: result.finalState.status,
  });
}

const outPath = join(__dirname, "..", "test", "fixtures", "golden-replays.json");
writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
console.log(`wrote ${fixtures.length} fixtures to ${outPath}`);
