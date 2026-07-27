/**
 * Power-up effects (§7). Each is a pure, deterministic board transform so
 * replays can verify them exactly like placements.
 *
 * Interpretation note (see DECISIONS.md for the full reasoning): `fill`
 * FILLS the flood-filled empty region (marks those cells as occupied), which
 * can then complete rows/cols/blocks for the normal clear pass to remove —
 * that's what makes an unbounded fill an "instant-win button" and why it
 * needs the FILL_MAX_REGION guard rail. `pencil`/`eraser`/`rocket`/`bomb` all
 * *remove* cells instead.
 */

import { BOARD_SIZE, type Board, ROW_MASKS, COL_MASKS, cellBit, cellIndex, isFilled } from "./board.js";
import type { Cell } from "./pieces.js";

export const FILL_MAX_REGION = 15;

export class FillRegionTooLargeError extends Error {
  public readonly regionSize: number;
  constructor(regionSize: number) {
    super(`fill region has ${regionSize} cells, exceeds FILL_MAX_REGION (${FILL_MAX_REGION})`);
    this.name = "FillRegionTooLargeError";
    this.regionSize = regionSize;
  }
}

function assertInBounds(row: number, col: number, label: string): void {
  if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) {
    throw new Error(`${label} target (${row}, ${col}) is out of bounds`);
  }
}

/** Remove exactly 1 filled cell. Throws if the target isn't filled — the UI only allows tapping filled cells. */
export function applyPencil(board: Board, row: number, col: number): Board {
  assertInBounds(row, col, "pencil");
  if (!isFilled(board, row, col)) {
    throw new Error(`pencil target (${row}, ${col}) is not filled`);
  }
  return board & ~cellBit(row, col);
}

/**
 * Remove a 2x2 area with top-left at (row, col). Cells outside the board or
 * already empty are simply ignored (clearing an unset/out-of-range bit is a no-op).
 */
export function applyEraser(board: Board, row: number, col: number): Board {
  let mask = 0n;
  for (let dr = 0; dr < 2; dr++) {
    for (let dc = 0; dc < 2; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) continue;
      mask |= cellBit(r, c);
    }
  }
  return board & ~mask;
}

export type RocketOrientation = "row" | "col";

/** Clear one entire row or column, regardless of its current fill state. Always 1 unit. */
export function applyRocket(
  board: Board,
  orientation: RocketOrientation,
  index: number,
): { board: Board; unitsCleared: 1 } {
  if (index < 0 || index >= BOARD_SIZE) {
    throw new Error(`rocket index ${index} out of range`);
  }
  const mask = orientation === "row" ? (ROW_MASKS[index] as Board) : (COL_MASKS[index] as Board);
  return { board: board & ~mask, unitsCleared: 1 };
}

/** Clear the full row and column through (row, col) — a cross. Always 2 units. */
export function applyBomb(board: Board, row: number, col: number): { board: Board; unitsCleared: 2 } {
  assertInBounds(row, col, "bomb");
  const mask = (ROW_MASKS[row] as Board) | (COL_MASKS[col] as Board);
  return { board: board & ~mask, unitsCleared: 2 };
}

/** The 4-connected region of empty cells containing (row, col). Board edges are walls, not openings. */
export function floodFillEmptyRegion(board: Board, row: number, col: number): Cell[] {
  assertInBounds(row, col, "fill");
  if (isFilled(board, row, col)) {
    throw new Error(`fill target (${row}, ${col}) is not empty`);
  }
  const seen = new Set<number>();
  const stack: Cell[] = [[row, col]];
  const cells: Cell[] = [];
  seen.add(cellIndex(row, col));
  while (stack.length > 0) {
    const current = stack.pop() as Cell;
    const [r, c] = current;
    cells.push(current);
    const neighbors: Cell[] = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ];
    for (const [nr, nc] of neighbors) {
      if (nr < 0 || nc < 0 || nr >= BOARD_SIZE || nc >= BOARD_SIZE) continue;
      const idx = cellIndex(nr, nc);
      if (seen.has(idx)) continue;
      if (isFilled(board, nr, nc)) continue;
      seen.add(idx);
      stack.push([nr, nc]);
    }
  }
  return cells;
}

/**
 * Flood-fill the empty region containing (row, col), marking it occupied.
 * Throws `FillRegionTooLargeError` (not a generic error) if the region
 * exceeds FILL_MAX_REGION — callers should catch this specifically to refund
 * the tap without consuming the item or logging the action, per §7.
 */
export function applyFill(board: Board, row: number, col: number): { board: Board; cells: readonly Cell[] } {
  const cells = floodFillEmptyRegion(board, row, col);
  if (cells.length > FILL_MAX_REGION) {
    throw new FillRegionTooLargeError(cells.length);
  }
  let mask = 0n;
  for (const [r, c] of cells) mask |= cellBit(r, c);
  return { board: board | mask, cells };
}
