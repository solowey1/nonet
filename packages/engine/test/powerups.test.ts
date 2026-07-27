import { describe, expect, it } from "vitest";
import { EMPTY_BOARD, cellBit, isFilled, placePiece, popcount } from "../src/board.js";
import { getPiece } from "../src/pieces.js";
import {
  FILL_MAX_REGION,
  FillRegionTooLargeError,
  applyBomb,
  applyEraser,
  applyFill,
  applyPencil,
  applyRocket,
  floodFillEmptyRegion,
} from "../src/powerups.js";

function fillAll(rows: Array<[number, number]>): bigint {
  let b = EMPTY_BOARD;
  for (const [r, c] of rows) b |= cellBit(r, c);
  return b;
}

describe("pencil", () => {
  it("removes exactly one filled cell", () => {
    const dot = getPiece("DOT");
    const board = placePiece(EMPTY_BOARD, dot, 3, 3);
    const result = applyPencil(board, 3, 3);
    expect(isFilled(result, 3, 3)).toBe(false);
    expect(popcount(result)).toBe(0);
  });

  it("throws when the target cell is empty", () => {
    expect(() => applyPencil(EMPTY_BOARD, 0, 0)).toThrow();
  });
});

describe("eraser", () => {
  it("removes a 2x2 area", () => {
    const o2 = getPiece("O2");
    const board = placePiece(EMPTY_BOARD, o2, 4, 4);
    const result = applyEraser(board, 4, 4);
    expect(popcount(result)).toBe(0);
  });

  it("ignores already-empty cells within the 2x2 without error", () => {
    const dot = getPiece("DOT");
    const board = placePiece(EMPTY_BOARD, dot, 4, 4);
    const result = applyEraser(board, 4, 4);
    expect(popcount(result)).toBe(0);
  });

  it("ignores cells that fall outside the board", () => {
    const dot = getPiece("DOT");
    const board = placePiece(EMPTY_BOARD, dot, 8, 8);
    // top-left (8,8): only (8,8) is in-bounds, (8,9)/(9,8)/(9,9) are off-board.
    const result = applyEraser(board, 8, 8);
    expect(popcount(result)).toBe(0);
  });
});

describe("rocket", () => {
  it("clears a full row regardless of current fill state", () => {
    const board = fillAll([
      [2, 0],
      [2, 3],
    ]);
    const result = applyRocket(board, "row", 2);
    expect(popcount(result.board)).toBe(0);
    expect(result.unitsCleared).toBe(1);
  });

  it("clears a full column regardless of current fill state", () => {
    const board = fillAll([[0, 5]]);
    const result = applyRocket(board, "col", 5);
    expect(popcount(result.board)).toBe(0);
    expect(result.unitsCleared).toBe(1);
  });

  it("leaves other rows/columns untouched", () => {
    const board = fillAll([
      [1, 0],
      [2, 0],
    ]);
    const result = applyRocket(board, "row", 1);
    expect(isFilled(result.board, 2, 0)).toBe(true);
  });
});

describe("bomb", () => {
  it("clears the full row and column through the target cell", () => {
    const board = fillAll([
      [3, 3],
      [3, 8],
      [0, 3],
    ]);
    const result = applyBomb(board, 3, 3);
    expect(popcount(result.board)).toBe(0);
    expect(result.unitsCleared).toBe(2);
  });

  it("leaves cells outside the cross untouched", () => {
    const board = fillAll([[5, 5]]);
    const result = applyBomb(board, 0, 0);
    expect(isFilled(result.board, 5, 5)).toBe(true);
  });
});

describe("fill", () => {
  it("throws if the target cell is already filled", () => {
    const dot = getPiece("DOT");
    const board = placePiece(EMPTY_BOARD, dot, 0, 0);
    expect(() => applyFill(board, 0, 0)).toThrow();
  });

  it("fills a small bounded empty pocket and returns its cells", () => {
    // A single empty cell at (4,4) fully surrounded by filled cells.
    const board = fillAll([
      [3, 4],
      [5, 4],
      [4, 3],
      [4, 5],
    ]);
    const cells = floodFillEmptyRegion(board, 4, 4);
    expect(cells).toEqual([[4, 4]]);
    const result = applyFill(board, 4, 4);
    expect(isFilled(result.board, 4, 4)).toBe(true);
  });

  it("treats board edges as walls, not openings", () => {
    // Corner (0,0) is empty and only bounded by the edges plus (0,1)/(1,0) filled.
    const board = fillAll([
      [0, 1],
      [1, 0],
    ]);
    const cells = floodFillEmptyRegion(board, 0, 0);
    expect(cells).toEqual([[0, 0]]);
  });

  it("refuses (throws FillRegionTooLargeError) when the region exceeds FILL_MAX_REGION", () => {
    // Empty board: region containing any cell is the whole 81-cell board.
    expect(() => applyFill(EMPTY_BOARD, 4, 4)).toThrow(FillRegionTooLargeError);
    try {
      applyFill(EMPTY_BOARD, 4, 4);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FillRegionTooLargeError);
      expect((err as FillRegionTooLargeError).regionSize).toBe(81);
    }
  });

  it("does not mutate the board when refusing", () => {
    const before = EMPTY_BOARD;
    try {
      applyFill(before, 0, 0);
    } catch {
      // expected
    }
    expect(before).toBe(EMPTY_BOARD);
  });

  it("accepts a region exactly at the FILL_MAX_REGION boundary", () => {
    // Carve an exact 15-cell empty region: row 0 fully open (9 cells) plus
    // row 1 cols 0-5 open (6 cells) = 15, walled off from the rest of the board.
    let board = EMPTY_BOARD;
    for (let c = 0; c < 9; c++) board |= cellBit(2, c); // wall under row 1
    for (let c = 6; c < 9; c++) board |= cellBit(1, c); // wall right of row 1's open part
    const cells = floodFillEmptyRegion(board, 0, 0);
    expect(cells.length).toBe(FILL_MAX_REGION);
    const result = applyFill(board, 0, 0);
    expect(result.cells.length).toBe(FILL_MAX_REGION);
  });
});
