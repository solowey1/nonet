import { BOARD_SIZE, FILL_MAX_REGION, floodFillEmptyRegion, isFilled, type Board } from "@nonet/engine";
import type { PowerupKind } from "@nonet/shared";
import { clamp } from "./geometry.js";

export interface PowerupPreview {
  readonly kind: PowerupKind;
  readonly cells: ReadonlyArray<{ row: number; col: number }>;
  readonly valid: boolean;
  readonly regionTooLarge?: boolean;
  readonly regionSize?: number;
}

function crossCells(row: number, col: number): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  for (let c = 0; c < BOARD_SIZE; c++) cells.push({ row, col: c });
  for (let r = 0; r < BOARD_SIZE; r++) if (r !== row) cells.push({ row: r, col });
  return cells;
}

/** Pure preview computation reused by both the live drag preview and the commit handler. */
export function computeTargetPreview(board: Board, kind: PowerupKind, rawRow: number, rawCol: number): PowerupPreview {
  const row = clamp(rawRow, 0, BOARD_SIZE - 1);
  const col = clamp(rawCol, 0, BOARD_SIZE - 1);

  switch (kind) {
    case "pencil":
      return { kind, cells: [{ row, col }], valid: isFilled(board, row, col) };

    case "eraser": {
      const topLeftRow = clamp(row, 0, BOARD_SIZE - 2);
      const topLeftCol = clamp(col, 0, BOARD_SIZE - 2);
      const cells = [
        { row: topLeftRow, col: topLeftCol },
        { row: topLeftRow, col: topLeftCol + 1 },
        { row: topLeftRow + 1, col: topLeftCol },
        { row: topLeftRow + 1, col: topLeftCol + 1 },
      ];
      return { kind, cells, valid: true };
    }

    case "bomb":
      return { kind, cells: crossCells(row, col), valid: true };

    case "fill": {
      if (isFilled(board, row, col)) {
        return { kind, cells: [], valid: false };
      }
      const region = floodFillEmptyRegion(board, row, col);
      if (region.length > FILL_MAX_REGION) {
        return { kind, cells: [], valid: false, regionTooLarge: true, regionSize: region.length };
      }
      const cells = region.map(([r, c]) => ({ row: r, col: c }));
      return { kind, cells, valid: true, regionSize: region.length };
    }

    case "rocket":
      // Rocket doesn't use drag targeting — see RocketGutters.
      return { kind, cells: [], valid: false };
  }
}
