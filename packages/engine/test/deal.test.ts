import { describe, expect, it } from "vitest";
import { EMPTY_BOARD, canPlace, placePiece, popcount } from "../src/board.js";
import { PIECE_CATALOGUE, type Piece, cellCount, getPiece, isLargePiece } from "../src/pieces.js";
import { createRngFromSeed, nextInt, type RngState } from "../src/rng.js";
import { adaptiveWeight, dealHand, difficultyTier, drawHand, maxPlaceable, requirementForTier } from "../src/deal.js";

function randomBoard(seed: bigint, targetFillRatio: number): bigint {
  let state: RngState = createRngFromSeed(seed);
  let board = EMPTY_BOARD;
  const small = [getPiece("DOT"), getPiece("I2H"), getPiece("I2V")];
  let attempts = 0;
  while (popcount(board) / 81 < targetFillRatio && attempts < 500) {
    attempts++;
    const [pieceIdx, s1] = nextInt(state, small.length);
    const piece = small[pieceIdx] as Piece;
    const [row, s2] = nextInt(s1, 9);
    const [col, s3] = nextInt(s2, 9);
    state = s3;
    if (canPlace(board, piece, row, col)) {
      board = placePiece(board, piece, row, col);
    }
  }
  return board;
}

describe("difficultyTier / requirementForTier", () => {
  it("maps score ranges per §5", () => {
    expect(difficultyTier(0)).toBe("gentle");
    expect(difficultyTier(1999)).toBe("gentle");
    expect(difficultyTier(2000)).toBe("normal");
    expect(difficultyTier(10000)).toBe("normal");
    expect(difficultyTier(10001)).toBe("hard");
  });

  it("requirement decreases as difficulty rises", () => {
    expect(requirementForTier("gentle")).toBe(3);
    expect(requirementForTier("normal")).toBe(2);
    expect(requirementForTier("hard")).toBe(1);
  });
});

describe("drawHand", () => {
  it("never draws 3 copies of the same >=5-cell piece", () => {
    let state = createRngFromSeed(1n);
    for (let i = 0; i < 2000; i++) {
      const [hand, next] = drawHand(state, 0.5);
      state = next;
      const [a, b, c] = hand;
      if (a.id === b.id && b.id === c.id && isLargePiece(a)) {
        expect.fail(`drew three copies of large piece ${a.id}`);
      }
    }
  });

  it("only ever draws pieces from the catalogue", () => {
    const ids = new Set(PIECE_CATALOGUE.map((p) => p.id));
    let state = createRngFromSeed(2n);
    for (let i = 0; i < 200; i++) {
      const [hand, next] = drawHand(state, 0.3);
      state = next;
      for (const p of hand) expect(ids.has(p.id)).toBe(true);
    }
  });
});

describe("maxPlaceable", () => {
  it("is 3 for an empty board and 3 small pieces", () => {
    const hand = [getPiece("DOT"), getPiece("I2H"), getPiece("I2V")];
    expect(maxPlaceable(EMPTY_BOARD, hand)).toBe(3);
  });

  it("is 0 when no piece in the hand fits anywhere", () => {
    // Fill columns 0,1,2,3 entirely and columns 5,6,7,8 entirely, leaving only
    // column 4 empty. I2H (needs 2 contiguous horizontal cells) cannot fit anywhere.
    let board = EMPTY_BOARD;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (c !== 4) board = board | (1n << BigInt(r * 9 + c));
      }
    }
    const hand = [getPiece("I2H")];
    expect(maxPlaceable(board, hand)).toBe(0);
  });
});

describe("adaptiveWeight: crowded-board bias scales with tier", () => {
  it("protects against large pieces at gentle, but boosts them at hard", () => {
    const large = PIECE_CATALOGUE.find((p) => cellCount(p) >= 5) as Piece;
    const baseline = large.weight;
    expect(adaptiveWeight(large, 0.7, "gentle")).toBeLessThan(baseline);
    expect(adaptiveWeight(large, 0.7, "normal")).toBeLessThan(baseline);
    expect(adaptiveWeight(large, 0.7, "normal")).toBeGreaterThan(adaptiveWeight(large, 0.7, "gentle"));
    expect(adaptiveWeight(large, 0.7, "hard")).toBeGreaterThan(baseline);
  });

  it("a crowded board deals a large piece far more often at hard tier than at gentle", () => {
    let state = createRngFromSeed(555n);
    let gentleHits = 0;
    let hardHits = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i++) {
      const [gentleHand, s1] = drawHand(state, 0.7, "gentle");
      const [hardHand, s2] = drawHand(s1, 0.7, "hard");
      state = s2;
      if (gentleHand.some((p) => cellCount(p) >= 5)) gentleHits++;
      if (hardHand.some((p) => cellCount(p) >= 5)) hardHits++;
    }
    // Directional, not a tight bound — pinning an exact ratio would make this
    // brittle to future weight retuning; the point is hard is meaningfully
    // riskier, not by exactly how much.
    expect(hardHits).toBeGreaterThan(gentleHits * 2);
  });
});

describe("dealHand solvability guard", () => {
  it("never deals a hand with maxPlaceable === 0, across many random boards", () => {
    let rngSeed = 1000n;
    for (let trial = 0; trial < 300; trial++) {
      rngSeed += 1n;
      const fillTarget = (trial % 10) / 12; // sweep 0 .. ~0.75
      const board = randomBoard(rngSeed, fillTarget);
      if (popcount(board) === 81) continue; // fully-full board is terminal, not a dealHand scenario
      let rng = createRngFromSeed(rngSeed * 7919n + 1n);
      const score = trial * 500;
      const { hand } = dealHand(board, rng, score);
      const count = maxPlaceable(board, hand);
      expect(count, `trial ${trial} fill=${fillTarget} board=${board}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("meets the gentle-tier requirement (all 3 placeable) on an empty board", () => {
    const rng = createRngFromSeed(42n);
    const { hand } = dealHand(EMPTY_BOARD, rng, 0);
    expect(maxPlaceable(EMPTY_BOARD, hand)).toBe(3);
  });
});
