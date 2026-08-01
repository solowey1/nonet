import { create } from "zustand";
import {
  BOARD_SIZE,
  createInitialState,
  placePiece,
  reduce,
  resolveClears,
  type Board,
  type GameState,
} from "@nonet/engine";
import { maskToCells } from "../utils/bitmask.js";
import { pieceFamily } from "../utils/pieceFamily.js";

function randomSeed(): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytes;
}

export interface ClearEvent {
  /** Bumped on every clear so React effects re-fire even if the mask repeats. */
  readonly key: number;
  readonly clearedMask: Board;
  readonly rows: readonly number[];
  readonly cols: readonly number[];
  readonly blocks: readonly number[];
  readonly unitsCleared: number;
  readonly comboLevel: number;
  readonly turnScore: number;
  readonly isPerfectClear: boolean;
  /** The placement that triggered this clear — the animation staggers outward from here. */
  readonly originRow: number;
  readonly originCol: number;
}

const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;

function freshCellFamilies(): Uint8Array {
  return new Uint8Array(TOTAL_CELLS);
}

interface GameStoreState {
  readonly game: GameState;
  readonly lastClear: ClearEvent | null;
  /** Purely cosmetic, parallel to `game.board`: which piece-family filled each cell, for stable colouring. */
  readonly cellFamilies: Uint8Array;
  place(slot: 0 | 1 | 2, row: number, col: number): boolean;
  newRun(): void;
}

let clearEventCounter = 0;

export const useGameStore = create<GameStoreState>((set, get) => ({
  game: createInitialState(randomSeed()),
  lastClear: null,
  cellFamilies: freshCellFamilies(),

  place(slot, row, col) {
    const { game, cellFamilies } = get();
    if (game.status === "gameover") return false;
    const piece = game.hand[slot];
    if (!piece) return false;

    // Mirror the reducer's own placement to capture *which* units cleared,
    // for animation purposes only — reduce() below remains the sole source
    // of authoritative state.
    let preview: ReturnType<typeof resolveClears>;
    try {
      const placedBoard = placePiece(game.board, piece, row, col);
      preview = resolveClears(placedBoard);
    } catch {
      return false; // illegal placement (out of bounds / collision)
    }

    let next: GameState;
    try {
      next = reduce(game, { t: Date.now(), type: "place", slot, r: row, c: col });
    } catch {
      return false;
    }

    const nextFamilies = cellFamilies.slice();
    const family = pieceFamily(piece.cells.length);
    for (const [dr, dc] of piece.cells) {
      nextFamilies[(row + dr) * BOARD_SIZE + (col + dc)] = family;
    }
    for (const { index } of maskToCells(preview.clearedMask)) {
      nextFamilies[index] = 0;
    }

    const isPerfectClear = preview.unitsCleared > 0 && next.perfectClears > game.perfectClears;

    set({
      game: next,
      cellFamilies: nextFamilies,
      lastClear:
        preview.unitsCleared > 0
          ? {
              key: ++clearEventCounter,
              clearedMask: preview.clearedMask,
              rows: preview.units.rows,
              cols: preview.units.cols,
              blocks: preview.units.blocks,
              unitsCleared: preview.unitsCleared,
              comboLevel: next.comboLevel,
              turnScore: next.score - game.score,
              isPerfectClear,
              originRow: row,
              originCol: col,
            }
          : null,
    });
    return true;
  },

  newRun() {
    set({ game: createInitialState(randomSeed()), lastClear: null, cellFamilies: freshCellFamilies() });
  },
}));
