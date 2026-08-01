import { BOARD_SIZE, type Board } from "@nonet/engine";

export interface MaskCell {
  readonly row: number;
  readonly col: number;
  readonly index: number;
}

/** Expands a bitmask into its set (row, col) cells. Bit `row*BOARD_SIZE+col` per board.ts's convention. */
export function maskToCells(mask: Board): MaskCell[] {
  const cells: MaskCell[] = [];
  const total = BOARD_SIZE * BOARD_SIZE;
  for (let index = 0; index < total; index++) {
    if ((mask & (1n << BigInt(index))) !== 0n) {
      cells.push({ row: Math.floor(index / BOARD_SIZE), col: index % BOARD_SIZE, index });
    }
  }
  return cells;
}
