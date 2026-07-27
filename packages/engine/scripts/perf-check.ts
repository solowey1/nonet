/**
 * Ad-hoc perf sanity check against the §16 budgets:
 *   - dealHand worst case <= 3ms
 *   - replay of a 500-action run <= 20ms server-side
 * Not part of CI — just a manual gut-check during development.
 * Run: pnpm exec tsx scripts/perf-check.ts
 */
import { EMPTY_BOARD, canPlace, placePiece } from "../src/board.js";
import { dealHand } from "../src/deal.js";
import { getPiece } from "../src/pieces.js";
import { createRngFromSeed } from "../src/rng.js";
import { replay } from "../src/replay.js";
import { autoplay, seedFromIndex } from "../test/helpers/autoplay.js";

function randomishBoard(seedNum: number, targetFill: number) {
  let state = createRngFromSeed(BigInt(seedNum));
  let board = EMPTY_BOARD;
  const small = [getPiece("DOT"), getPiece("I2H"), getPiece("I2V"), getPiece("I3H")];
  let tries = 0;
  while (true) {
    let filled = 0;
    let x = board;
    while (x > 0n) {
      x &= x - 1n;
      filled++;
    }
    if (filled / 81 >= targetFill || tries > 3000) break;
    tries++;
    state = { s0: state.s1, s1: (state.s0 + state.s1) & ((1n << 64n) - 1n) };
    const r = Number((state.s0 ^ state.s1) % 9n);
    const c = Number((state.s1 ^ (state.s0 >> 3n)) % 9n);
    const p = small[tries % small.length]!;
    if (canPlace(board, p, r, c)) board = placePiece(board, p, r, c);
  }
  return board;
}

let worstDeal = 0;
for (let i = 0; i < 300; i++) {
  const board = randomishBoard(i + 1, 0.55);
  const rng = createRngFromSeed(BigInt(i + 1));
  const t0 = performance.now();
  dealHand(board, rng, 0); // gentle tier: requires all 3 placeable, the most expensive search
  const t1 = performance.now();
  worstDeal = Math.max(worstDeal, t1 - t0);
}
console.log(`dealHand worst-of-300 (gentle tier, ~55% fill): ${worstDeal.toFixed(3)} ms (budget: 3ms)`);

const seedBytes = seedFromIndex(777);
const { actions } = autoplay(seedBytes, 500);
console.log(`autoplay produced ${actions.length} actions`);
const t0 = performance.now();
replay(seedBytes, actions);
const t1 = performance.now();
console.log(`replay of ${actions.length}-action run: ${(t1 - t0).toFixed(3)} ms (budget: 20ms @ 500 actions)`);
