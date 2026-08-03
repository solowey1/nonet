import { describe, expect, it } from "vitest";
import { EMPTY_BOARD, cellBit, isFilled } from "../src/board.js";
import { getPiece } from "../src/pieces.js";
import { FillRegionTooLargeError } from "../src/powerups.js";
import { type GameState, createInitialState, isGameOver, reduce } from "../src/reduce.js";

function seed(n: number): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes[0] = n & 0xff;
  bytes[1] = (n >> 8) & 0xff;
  return bytes;
}

describe("createInitialState", () => {
  it("starts with an empty board, score 0, and a fully-placeable hand", () => {
    const state = createInitialState(seed(1));
    expect(state.board).toBe(EMPTY_BOARD);
    expect(state.score).toBe(0);
    expect(state.status).toBe("playing");
    expect(state.hand.every((p) => p !== null)).toBe(true);
  });

  it("is deterministic for the same seed", () => {
    const a = createInitialState(seed(7));
    const b = createInitialState(seed(7));
    expect(a.board).toBe(b.board);
    expect(a.hand.map((p) => p?.id)).toEqual(b.hand.map((p) => p?.id));
    expect(a.rng).toEqual(b.rng);
  });
});

describe("reduce: place", () => {
  it("places a piece, updates the board and score, and clears the slot", () => {
    let state = createInitialState(seed(2));
    const piece = state.hand[0];
    expect(piece).not.toBeNull();
    state = reduce(state, { t: 0, type: "place", slot: 0, r: 0, c: 0 });
    expect(state.hand[0]).toBeNull();
    expect(state.piecesPlaced).toBe(1);
    expect(state.score).toBeGreaterThanOrEqual(piece ? piece.cells.length : 0);
  });

  it("throws when placing into an already-used slot", () => {
    let state = createInitialState(seed(3));
    state = reduce(state, { t: 0, type: "place", slot: 0, r: 0, c: 0 });
    expect(() => reduce(state, { t: 1, type: "place", slot: 0, r: 1, c: 1 })).toThrow();
  });

  it("throws for an out-of-bounds placement", () => {
    const state = createInitialState(seed(4));
    expect(() => reduce(state, { t: 0, type: "place", slot: 0, r: -1, c: 0 })).toThrow();
  });

  it("deals a new hand only once all 3 slots are placed", () => {
    let state = createInitialState(seed(5));
    // Place pieces into slots 0 then 1, using whatever legal position each
    // piece's own hand offers (start scanning from the top-left).
    for (const slot of [0, 1] as const) {
      const piece = state.hand[slot];
      expect(piece).not.toBeNull();
      const pos = findLegalPosition(state, slot);
      state = reduce(state, { t: slot, type: "place", slot, r: pos.row, c: pos.col });
      expect(state.hand[slot]).toBeNull();
    }
    // Slot 2 still holds the original hand's third piece.
    expect(state.hand[2]).not.toBeNull();

    const pos = findLegalPosition(state, 2);
    state = reduce(state, { t: 2, type: "place", slot: 2, r: pos.row, c: pos.col });
    // All 3 slots used -> a fresh hand must have been dealt automatically.
    expect(state.hand.every((p) => p !== null)).toBe(true);
  });

  function findLegalPosition(state: GameState, slot: 0 | 1 | 2): { row: number; col: number } {
    const piece = state.hand[slot];
    if (!piece) throw new Error("slot empty");
    for (let row = 0; row <= 9 - piece.h; row++) {
      for (let col = 0; col <= 9 - piece.w; col++) {
        let ok = true;
        for (const [dr, dc] of piece.cells) {
          if (isFilled(state.board, row + dr, col + dc)) {
            ok = false;
            break;
          }
        }
        if (ok) return { row, col };
      }
    }
    throw new Error("no legal position found");
  }
});

describe("reduce: game over", () => {
  it("marks status gameover when the current hand no longer fits anywhere", () => {
    // Fill the whole board except column 4, then give a hand of only I2H
    // (needs 2 contiguous horizontal cells) which cannot fit anywhere.
    let board = EMPTY_BOARD;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (c !== 4) board |= cellBit(r, c);
      }
    }
    const i2h = getPiece("I2H");
    const state: GameState = {
      board,
      hand: [i2h, null, null],
      rng: createInitialState(seed(6)).rng,
      score: 0,
      comboLevel: 0,
      comboGraceActive: false,
      piecesPlaced: 0,
      unitsCleared: 0,
      maxComboLevel: 0,
      perfectClears: 0,
      powerupsUsed: 0,
      status: "gameover",
    };
    expect(isGameOver(state.board, state.hand)).toBe(true);
    expect(() => reduce(state, { t: 0, type: "place", slot: 0, r: 0, c: 0 })).toThrow(
      "cannot place a piece after game over",
    );
  });

  it("a power-up can rescue a game-over state", () => {
    let board = EMPTY_BOARD;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (c !== 4) board |= cellBit(r, c);
      }
    }
    // I2H needs 2 contiguous free cells; only column 4 is open (isolated), so it's stuck.
    const i2h = getPiece("I2H");
    const stuck: GameState = {
      board,
      hand: [i2h, null, null],
      rng: createInitialState(seed(9)).rng,
      score: 0,
      comboLevel: 0,
      comboGraceActive: false,
      piecesPlaced: 0,
      unitsCleared: 0,
      maxComboLevel: 0,
      perfectClears: 0,
      powerupsUsed: 0,
      status: "gameover",
    };
    expect(isGameOver(stuck.board, stuck.hand)).toBe(true);

    // Rocket-clear column 4's row 0 neighbor row (row 0 entirely) to open up
    // two contiguous cells for I2H.
    const rescued = reduce(stuck, { t: 0, type: "powerup", kind: "rocket", orientation: "row", index: 0 });
    expect(rescued.status).toBe("playing");
  });
});

describe("reduce: powerups", () => {
  it("pencil/eraser do not advance or reset the combo level", () => {
    const state = { ...createInitialState(seed(10)), comboLevel: 3, board: cellBit(0, 0) };
    const after = reduce(state, { t: 0, type: "powerup", kind: "pencil", r: 0, c: 0 });
    expect(after.comboLevel).toBe(3);
    expect(after.powerupsUsed).toBe(1);
  });

  it("fill propagates FillRegionTooLargeError on an oversized region without mutating state", () => {
    const state = createInitialState(seed(11));
    const empty = { ...state, board: EMPTY_BOARD };
    expect(() => reduce(empty, { t: 0, type: "powerup", kind: "fill", r: 0, c: 0 })).toThrow(
      FillRegionTooLargeError,
    );
  });

  it("bomb clears the row+column cross and scores at half rate", () => {
    // Fill only the row-3/col-3 cross (16 cells, excluding the shared center)
    // plus one extra cell elsewhere so the board is NOT left empty afterward
    // (isolating the half-rate scoring check from the perfect-clear bonus).
    let board = EMPTY_BOARD;
    for (let c = 0; c < 9; c++) if (c !== 3) board |= cellBit(3, c);
    for (let r = 0; r < 9; r++) if (r !== 3) board |= cellBit(r, 3);
    board |= cellBit(8, 8);
    const state = { ...createInitialState(seed(12)), board, comboLevel: 0 };
    const after = reduce(state, { t: 0, type: "powerup", kind: "bomb", r: 3, c: 3 });
    expect(isFilled(after.board, 8, 8)).toBe(true);
    expect(after.unitsCleared).toBe(2);
    // 2 units at neutral (level-0 treated as x1.0) multiplier, half rate: 9*2*3/2=27
    expect(after.score).toBe(27);
    expect(after.perfectClears).toBe(0);
  });
});

describe("reduce: combo (round 5 — multi-clear scaling and grace)", () => {
  function twoClearableRows(): GameState["board"] {
    let board = EMPTY_BOARD;
    for (let c = 0; c < 9; c++) if (c !== 3 && c !== 4) board |= cellBit(0, c);
    for (let c = 0; c < 9; c++) if (c !== 3 && c !== 4) board |= cellBit(1, c);
    return board;
  }

  it("a placement clearing 2 units at once increases combo by 2, not a flat 1", () => {
    const o2 = getPiece("O2");
    const state: GameState = { ...createInitialState(seed(30)), board: twoClearableRows(), hand: [o2, null, null] };
    const after = reduce(state, { t: 0, type: "place", slot: 0, r: 0, c: 3 });
    expect(after.unitsCleared).toBe(2);
    expect(after.comboLevel).toBe(2);
    expect(after.comboGraceActive).toBe(false);
  });

  it("a non-clearing placement enters grace, and a second one zeroes the combo", () => {
    const o2 = getPiece("O2");
    const dot = getPiece("DOT");
    let state: GameState = { ...createInitialState(seed(31)), board: twoClearableRows(), hand: [o2, dot, dot] };

    state = reduce(state, { t: 0, type: "place", slot: 0, r: 0, c: 3 });
    expect(state.comboLevel).toBe(2);
    expect(state.comboGraceActive).toBe(false);

    // Miss #1: clears nothing — combo survives on grace, not yet zeroed.
    state = reduce(state, { t: 1, type: "place", slot: 1, r: 8, c: 8 });
    expect(state.comboLevel).toBe(2);
    expect(state.comboGraceActive).toBe(true);

    // Miss #2: the grace is spent — combo actually dies now.
    state = reduce(state, { t: 2, type: "place", slot: 2, r: 8, c: 7 });
    expect(state.comboLevel).toBe(0);
    expect(state.comboGraceActive).toBe(false);
  });
});

describe("reduce: revive", () => {
  it("throws if the run isn't actually over", () => {
    const state = createInitialState(seed(20));
    expect(state.status).toBe("playing");
    expect(() => reduce(state, { t: 0, type: "revive" })).toThrow("revive is only usable after game over");
  });

  it("clears the board, resets combo, returns to playing, and preserves score", () => {
    let board = EMPTY_BOARD;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (c !== 4) board |= cellBit(r, c);
      }
    }
    const i2h = getPiece("I2H");
    const stuck: GameState = {
      board,
      hand: [i2h, null, null],
      rng: createInitialState(seed(21)).rng,
      score: 1234,
      comboLevel: 5,
      comboGraceActive: true,
      piecesPlaced: 10,
      unitsCleared: 3,
      maxComboLevel: 5,
      perfectClears: 1,
      powerupsUsed: 2,
      status: "gameover",
    };
    expect(isGameOver(stuck.board, stuck.hand)).toBe(true);

    const revived = reduce(stuck, { t: 0, type: "revive" });
    expect(revived.status).toBe("playing");
    expect(revived.board).toBe(EMPTY_BOARD);
    expect(revived.comboLevel).toBe(0);
    expect(revived.comboGraceActive).toBe(false);
    // Untouched: score/stats are the player's, and revive isn't a power-up.
    expect(revived.score).toBe(1234);
    expect(revived.piecesPlaced).toBe(10);
    expect(revived.perfectClears).toBe(1);
    expect(revived.powerupsUsed).toBe(2);
    expect(isGameOver(revived.board, revived.hand)).toBe(false);
  });
});
