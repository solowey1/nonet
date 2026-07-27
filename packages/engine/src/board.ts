/**
 * Bitboard representation of the 9x9 board (§3).
 *
 * A `Board` is a single bigint bitmask; bit `row*9 + col` is set when that
 * cell is filled. This gives placement legality and clear detection as a
 * handful of bitwise ops, which is what keeps the solvability search in
 * deal.ts cheap. (The brief suggests a pair of bitboards / Uint32Array(3);
 * a single JS bigint holds all 81 bits just as well and is simpler — see
 * DECISIONS.md.)
 */

import { PIECE_CATALOGUE, type Piece } from "./pieces.js";

export const BOARD_SIZE = 9;
export const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;

export type Board = bigint;

export const EMPTY_BOARD: Board = 0n;

export const FULL_BOARD_MASK: Board = (1n << BigInt(TOTAL_CELLS)) - 1n;

export function cellIndex(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

export function cellBit(row: number, col: number): Board {
  return 1n << BigInt(cellIndex(row, col));
}

function buildRowMasks(): readonly Board[] {
  const masks: Board[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    let mask = 0n;
    for (let c = 0; c < BOARD_SIZE; c++) mask |= cellBit(r, c);
    masks.push(mask);
  }
  return masks;
}

function buildColMasks(): readonly Board[] {
  const masks: Board[] = [];
  for (let c = 0; c < BOARD_SIZE; c++) {
    let mask = 0n;
    for (let r = 0; r < BOARD_SIZE; r++) mask |= cellBit(r, c);
    masks.push(mask);
  }
  return masks;
}

function buildBlockMasks(): readonly Board[] {
  const masks: Board[] = [];
  for (let b = 0; b < 9; b++) {
    const blockRow = Math.floor(b / 3) * 3;
    const blockCol = (b % 3) * 3;
    let mask = 0n;
    for (let r = blockRow; r < blockRow + 3; r++) {
      for (let c = blockCol; c < blockCol + 3; c++) mask |= cellBit(r, c);
    }
    masks.push(mask);
  }
  return masks;
}

export const ROW_MASKS: readonly Board[] = buildRowMasks();
export const COL_MASKS: readonly Board[] = buildColMasks();
export const BLOCK_MASKS: readonly Board[] = buildBlockMasks();

export function blockIndexOf(row: number, col: number): number {
  return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}

export function isFilled(board: Board, row: number, col: number): boolean {
  return (board & cellBit(row, col)) !== 0n;
}

export function popcount(board: Board): number {
  let x = board;
  let count = 0;
  while (x > 0n) {
    x &= x - 1n;
    count++;
  }
  return count;
}

export function isBoardEmpty(board: Board): boolean {
  return board === 0n;
}

export function fillRatio(board: Board): number {
  return popcount(board) / TOTAL_CELLS;
}

function computeMask(piece: Piece, row: number, col: number): Board | null {
  if (row < 0 || col < 0 || row + piece.h > BOARD_SIZE || col + piece.w > BOARD_SIZE) {
    return null;
  }
  let mask = 0n;
  for (const [dr, dc] of piece.cells) {
    mask |= cellBit(row + dr, col + dc);
  }
  return mask;
}

/**
 * Every catalogue piece's mask at every (row, col) is precomputed once at
 * module load. `pieceMask` is on the hottest path in the codebase — it runs
 * inside the solvability DFS (deal.ts) for every candidate placement — and
 * turning it into an array lookup instead of a per-call shift/OR loop over
 * `piece.cells` is what keeps that search inside its performance budget (§16).
 */
const PIECE_MASK_TABLE: ReadonlyMap<string, ReadonlyArray<ReadonlyArray<Board | null>>> = new Map(
  PIECE_CATALOGUE.map((piece) => [
    piece.id,
    Array.from({ length: BOARD_SIZE }, (_, row) =>
      Array.from({ length: BOARD_SIZE }, (_, col) => computeMask(piece, row, col)),
    ),
  ]),
);

/**
 * Bitmask of the cells `piece` would occupy with its bounding-box top-left at
 * (row, col), or `null` if any cell would fall outside the 9x9 board.
 */
export function pieceMask(piece: Piece, row: number, col: number): Board | null {
  if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return null;
  const table = PIECE_MASK_TABLE.get(piece.id);
  if (!table) return computeMask(piece, row, col); // fallback for a piece outside the static catalogue
  return (table[row] as ReadonlyArray<Board | null>)[col] ?? null;
}

export function canPlace(board: Board, piece: Piece, row: number, col: number): boolean {
  const mask = pieceMask(piece, row, col);
  if (mask === null) return false;
  return (board & mask) === 0n;
}

/** Places `piece` at (row, col). Caller must have verified `canPlace` first. */
export function placePiece(board: Board, piece: Piece, row: number, col: number): Board {
  const mask = pieceMask(piece, row, col);
  if (mask === null || (board & mask) !== 0n) {
    throw new Error(`illegal placement of ${piece.id} at (${row}, ${col})`);
  }
  return board | mask;
}

/** All (row, col) top-left positions where `piece` legally fits on `board`. */
export function legalPlacements(board: Board, piece: Piece): Array<{ row: number; col: number }> {
  const positions: Array<{ row: number; col: number }> = [];
  const maxRow = BOARD_SIZE - piece.h;
  const maxCol = BOARD_SIZE - piece.w;
  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      if (canPlace(board, piece, row, col)) positions.push({ row, col });
    }
  }
  return positions;
}

export function anyLegalPlacement(board: Board, piece: Piece): boolean {
  const maxRow = BOARD_SIZE - piece.h;
  const maxCol = BOARD_SIZE - piece.w;
  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      if (canPlace(board, piece, row, col)) return true;
    }
  }
  return false;
}

export interface DetectedUnits {
  readonly rows: readonly number[];
  readonly cols: readonly number[];
  readonly blocks: readonly number[];
}

/** Which rows/cols/blocks are completely full on `board`, computed against the board as-is. */
export function detectFullUnits(board: Board): DetectedUnits {
  const rows: number[] = [];
  const cols: number[] = [];
  const blocks: number[] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    if ((board & (ROW_MASKS[i] as Board)) === ROW_MASKS[i]) rows.push(i);
    if ((board & (COL_MASKS[i] as Board)) === COL_MASKS[i]) cols.push(i);
  }
  for (let b = 0; b < 9; b++) {
    if ((board & (BLOCK_MASKS[b] as Board)) === BLOCK_MASKS[b]) blocks.push(b);
  }
  return { rows, cols, blocks };
}

export function unitsCount(units: DetectedUnits): number {
  return units.rows.length + units.cols.length + units.blocks.length;
}

/** Union bitmask of every cell belonging to any of the given units. A cell in two units appears once. */
export function unitsMask(units: DetectedUnits): Board {
  let mask = 0n;
  for (const r of units.rows) mask |= ROW_MASKS[r] as Board;
  for (const c of units.cols) mask |= COL_MASKS[c] as Board;
  for (const b of units.blocks) mask |= BLOCK_MASKS[b] as Board;
  return mask;
}

export interface ClearResult {
  readonly board: Board;
  readonly units: DetectedUnits;
  readonly unitsCleared: number;
  readonly clearedMask: Board;
}

/**
 * The standard "simultaneous clear" pass (§3): detect every full row/col/block
 * against the board as it stands *before* any removal, then remove all their
 * cells in one step. A cell shared by two cleared units is removed once but
 * both units still count toward `unitsCleared`.
 */
export function resolveClears(board: Board): ClearResult {
  const units = detectFullUnits(board);
  const clearedMask = unitsMask(units);
  return {
    board: board & ~clearedMask,
    units,
    unitsCleared: unitsCount(units),
    clearedMask,
  };
}
