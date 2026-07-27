/**
 * A loose regression guard for the §16 engine budgets (dealHand <= 3ms worst
 * case, replay of a 500-action run <= 20ms). Thresholds are generously
 * padded above local measurements to absorb CI machine variance — this is a
 * smoke test against a 10x regression, not a precise benchmark.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_BOARD, canPlace, placePiece } from "../src/board.js";
import { dealHand } from "../src/deal.js";
import { getPiece } from "../src/pieces.js";
import { createRngFromSeed, type RngState } from "../src/rng.js";
import { replay } from "../src/replay.js";
import { autoplay, seedFromIndex } from "./helpers/autoplay.js";

function randomishBoard(seedNum: number, targetFill: number): bigint {
  let state: RngState = createRngFromSeed(BigInt(seedNum));
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
    const row = Number((state.s0 ^ state.s1) % 9n);
    const col = Number((state.s1 ^ (state.s0 >> 3n)) % 9n);
    const piece = small[tries % small.length] as ReturnType<typeof getPiece>;
    if (canPlace(board, piece, row, col)) board = placePiece(board, piece, row, col);
  }
  return board;
}

describe("performance budgets (§16, loose smoke test)", () => {
  it("dealHand stays well under a 10x margin of the 3ms budget across many boards", () => {
    // Warm up the JIT first — cold-start cost isn't the budget being measured.
    for (let i = 0; i < 50; i++) {
      dealHand(randomishBoard(i + 1, 0.55), createRngFromSeed(BigInt(i + 1)), 0);
    }

    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const board = randomishBoard(i + 1000, 0.55); // gentle tier (score 0) is the most expensive search
      const rng = createRngFromSeed(BigInt(i + 1000));
      const t0 = performance.now();
      dealHand(board, rng, 0);
      const t1 = performance.now();
      worst = Math.max(worst, t1 - t0);
    }
    expect(worst).toBeLessThan(30);
  });

  it("replay stays well under a 10x margin of the 20ms/500-action budget", () => {
    for (let i = 0; i < 20; i++) {
      const seedBytes = seedFromIndex(i);
      const { actions } = autoplay(seedBytes, 200);
      replay(seedBytes, actions);
    }

    let totalActions = 0;
    let totalTime = 0;
    for (let i = 0; i < 100; i++) {
      const seedBytes = seedFromIndex(i * 31 + 5000);
      const { actions } = autoplay(seedBytes, 1000);
      const t0 = performance.now();
      replay(seedBytes, actions);
      const t1 = performance.now();
      totalActions += actions.length;
      totalTime += t1 - t0;
    }
    const projectedFor500 = (totalTime / totalActions) * 500;
    expect(projectedFor500).toBeLessThan(200);
  });
});
