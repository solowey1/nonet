import { describe, expect, it } from "vitest";
import {
  BOARD_SIZE,
  EMPTY_BOARD,
  anyLegalPlacement,
  canPlace,
  cellBit,
  detectFullUnits,
  fillRatio,
  isBoardEmpty,
  isFilled,
  legalPlacements,
  pieceMask,
  placePiece,
  popcount,
  resolveClears,
} from "../src/board.js";
import { getPiece } from "../src/pieces.js";

function fillRow(board: bigint, row: number): bigint {
  let b = board;
  for (let c = 0; c < BOARD_SIZE; c++) b |= cellBit(row, c);
  return b;
}

function fillCol(board: bigint, col: number): bigint {
  let b = board;
  for (let r = 0; r < BOARD_SIZE; r++) b |= cellBit(r, col);
  return b;
}

function fillBlock(board: bigint, blockRow: number, blockCol: number): bigint {
  let b = board;
  for (let r = blockRow * 3; r < blockRow * 3 + 3; r++) {
    for (let c = blockCol * 3; c < blockCol * 3 + 3; c++) b |= cellBit(r, c);
  }
  return b;
}

describe("board", () => {
  it("starts empty", () => {
    expect(isBoardEmpty(EMPTY_BOARD)).toBe(true);
    expect(popcount(EMPTY_BOARD)).toBe(0);
    expect(fillRatio(EMPTY_BOARD)).toBe(0);
  });

  it("pieceMask rejects out-of-bounds placement", () => {
    const i3h = getPiece("I3H");
    expect(pieceMask(i3h, 0, 7)).toBeNull();
    expect(canPlace(EMPTY_BOARD, i3h, 0, 7)).toBe(false);
    expect(pieceMask(i3h, 0, 6)).not.toBeNull();
  });

  it("placePiece sets exactly the piece's cells", () => {
    const o2 = getPiece("O2");
    const board = placePiece(EMPTY_BOARD, o2, 3, 4);
    expect(isFilled(board, 3, 4)).toBe(true);
    expect(isFilled(board, 3, 5)).toBe(true);
    expect(isFilled(board, 4, 4)).toBe(true);
    expect(isFilled(board, 4, 5)).toBe(true);
    expect(popcount(board)).toBe(4);
  });

  it("canPlace is false when any target cell is occupied", () => {
    const dot = getPiece("DOT");
    const board = placePiece(EMPTY_BOARD, dot, 2, 2);
    expect(canPlace(board, dot, 2, 2)).toBe(false);
  });

  it("placePiece throws for an illegal placement", () => {
    const dot = getPiece("DOT");
    const board = placePiece(EMPTY_BOARD, dot, 2, 2);
    expect(() => placePiece(board, dot, 2, 2)).toThrow();
  });

  it("legalPlacements / anyLegalPlacement agree", () => {
    const i5h = getPiece("I5H");
    const board = fillRow(EMPTY_BOARD, 0); // whole row 0 filled
    const positions = legalPlacements(board, i5h);
    expect(anyLegalPlacement(board, i5h)).toBe(positions.length > 0);
    for (const { row, col } of positions) {
      expect(row).not.toBe(0);
      expect(canPlace(board, i5h, row, col)).toBe(true);
    }
  });

  it("detects a full row", () => {
    const board = fillRow(EMPTY_BOARD, 4);
    const units = detectFullUnits(board);
    expect(units.rows).toEqual([4]);
    expect(units.cols).toEqual([]);
    expect(units.blocks).toEqual([]);
  });

  it("detects a full column", () => {
    const board = fillCol(EMPTY_BOARD, 6);
    const units = detectFullUnits(board);
    expect(units.cols).toEqual([6]);
    expect(units.rows).toEqual([]);
  });

  it("detects a full 3x3 block", () => {
    const board = fillBlock(EMPTY_BOARD, 1, 2);
    const units = detectFullUnits(board);
    expect(units.blocks).toEqual([1 * 3 + 2]);
  });

  it("resolves simultaneous clears computed against the pre-removal board", () => {
    // Fill row 0 and column 0 entirely except their shared cell (0,0), then
    // place a piece at (0,0) that completes both simultaneously.
    let board = EMPTY_BOARD;
    for (let c = 1; c < BOARD_SIZE; c++) board |= cellBit(0, c);
    for (let r = 1; r < BOARD_SIZE; r++) board |= cellBit(r, 0);
    const dot = getPiece("DOT");
    board = placePiece(board, dot, 0, 0);

    const result = resolveClears(board);
    expect(result.units.rows).toEqual([0]);
    expect(result.units.cols).toEqual([0]);
    // The shared cell (0,0) is removed exactly once, but both units count.
    expect(result.unitsCleared).toBe(2);
    expect(isBoardEmpty(result.board)).toBe(true);
  });

  it("a cell shared by a cleared row and a cleared block is removed once but scores for both", () => {
    // Block (0,0) occupies rows 0-2, cols 0-2. Fill block 0 fully except (0,0),
    // and fill row 0 fully except (0,0). Placing at (0,0) completes both.
    let board = EMPTY_BOARD;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (r === 0 && c === 0) continue;
        board |= cellBit(r, c);
      }
    }
    for (let c = 3; c < BOARD_SIZE; c++) board |= cellBit(0, c);
    const dot = getPiece("DOT");
    board = placePiece(board, dot, 0, 0);

    const before = popcount(board);
    const result = resolveClears(board);
    expect(result.units.rows).toEqual([0]);
    expect(result.units.blocks).toEqual([0]);
    expect(result.unitsCleared).toBe(2);
    // Row (9 cells) + block (9 cells) overlap in 3 cells (row 0 within block 0):
    // union size = 9 + 9 - 3 = 15.
    expect(before - popcount(result.board)).toBe(15);
  });

  it("no clear when nothing is full", () => {
    const dot = getPiece("DOT");
    const board = placePiece(EMPTY_BOARD, dot, 5, 5);
    const result = resolveClears(board);
    expect(result.unitsCleared).toBe(0);
    expect(result.board).toBe(board);
  });
});
