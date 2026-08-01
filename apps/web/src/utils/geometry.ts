import { BOARD_SIZE } from "@nonet/engine";

export { BOARD_SIZE };

export function cellSizeFromRect(rect: DOMRect): number {
  return rect.width / BOARD_SIZE;
}

/** Fractional (unrounded) row/col of a client point relative to the board's rect. */
export function pointToFractionalCell(rect: DOMRect, clientX: number, clientY: number): { row: number; col: number } {
  const cellSize = cellSizeFromRect(rect);
  return {
    row: (clientY - rect.top) / cellSize,
    col: (clientX - rect.left) / cellSize,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
