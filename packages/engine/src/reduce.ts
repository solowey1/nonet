/**
 * The single entry point: `reduce(state, action) => state` (§2). Pure and
 * deterministic — no DOM, no `Date.now()`, no `Math.random()`. This is what
 * both the browser and the server run, byte-for-byte, so replay verification
 * (§9) is exact.
 *
 * Illegal actions (out-of-bounds placement, targeting an already-used slot,
 * tapping an empty cell with pencil, etc.) throw. That's deliberate: a
 * legitimate client can never produce one, so seeing one during replay means
 * either a bug or a tampered log — either way the run should fail
 * verification loudly, not silently no-op. The one exception is
 * `FillRegionTooLargeError` from powerups.ts, which is a normal, anticipated
 * refusal (§7) that callers should catch separately and not treat as cheating.
 */

import {
  EMPTY_BOARD,
  type Board,
  anyLegalPlacement,
  canPlace,
  isBoardEmpty,
  placePiece,
  resolveClears,
} from "./board.js";
import { dealHand } from "./deal.js";
import { type Piece, cellCount, getPiece } from "./pieces.js";
import {
  applyBomb,
  applyEraser,
  applyFill,
  applyPencil,
  applyRocket,
  type RocketOrientation,
} from "./powerups.js";
import { createRngFromBytes, type RngState } from "./rng.js";
import { nextComboLevel, scorePlacement, scorePowerupClear } from "./score.js";

export type Hand = readonly [Piece | null, Piece | null, Piece | null];

export type RunStatus = "playing" | "gameover";

export interface GameState {
  readonly board: Board;
  readonly hand: Hand;
  readonly rng: RngState;
  readonly score: number;
  readonly comboLevel: number;
  readonly piecesPlaced: number;
  readonly unitsCleared: number;
  readonly maxComboLevel: number;
  readonly perfectClears: number;
  readonly powerupsUsed: number;
  readonly status: RunStatus;
}

export interface PlaceAction {
  readonly t: number;
  readonly type: "place";
  readonly slot: 0 | 1 | 2;
  readonly r: number;
  readonly c: number;
}

export type PowerupAction =
  | { readonly t: number; readonly type: "powerup"; readonly kind: "pencil"; readonly r: number; readonly c: number }
  | { readonly t: number; readonly type: "powerup"; readonly kind: "eraser"; readonly r: number; readonly c: number }
  | {
      readonly t: number;
      readonly type: "powerup";
      readonly kind: "rocket";
      readonly orientation: RocketOrientation;
      readonly index: number;
    }
  | { readonly t: number; readonly type: "powerup"; readonly kind: "bomb"; readonly r: number; readonly c: number }
  | { readonly t: number; readonly type: "powerup"; readonly kind: "fill"; readonly r: number; readonly c: number };

export type Action = PlaceAction | PowerupAction;

export function isGameOver(board: Board, hand: Hand): boolean {
  for (const piece of hand) {
    if (piece !== null && anyLegalPlacement(board, piece)) return false;
  }
  return true;
}

export function createInitialState(seed: Uint8Array): GameState {
  const rng0 = createRngFromBytes(seed);
  const { hand, rng } = dealHand(EMPTY_BOARD, rng0, 0);
  return {
    board: EMPTY_BOARD,
    hand,
    rng,
    score: 0,
    comboLevel: 0,
    piecesPlaced: 0,
    unitsCleared: 0,
    maxComboLevel: 0,
    perfectClears: 0,
    powerupsUsed: 0,
    status: isGameOver(EMPTY_BOARD, hand) ? "gameover" : "playing",
  };
}

export function reduce(state: GameState, action: Action): GameState {
  if (action.type === "place") {
    if (state.status === "gameover") {
      throw new Error("cannot place a piece after game over");
    }
    return reducePlace(state, action);
  }
  // Power-ups remain usable on the game-over screen as a rescue (§7),
  // which may bring status back to "playing" below.
  return reducePowerup(state, action);
}

function reducePlace(state: GameState, action: PlaceAction): GameState {
  if (action.slot !== 0 && action.slot !== 1 && action.slot !== 2) {
    throw new Error(`invalid slot ${action.slot}`);
  }
  const piece = state.hand[action.slot];
  if (!piece) {
    throw new Error(`slot ${action.slot} is already empty`);
  }
  if (!canPlace(state.board, piece, action.r, action.c)) {
    throw new Error(`illegal placement of ${piece.id} at (${action.r}, ${action.c})`);
  }

  const placedBoard = placePiece(state.board, piece, action.r, action.c);
  const { board: clearedBoard, unitsCleared } = resolveClears(placedBoard);
  const comboLevelAfter = nextComboLevel(state.comboLevel, unitsCleared);
  const isEmpty = isBoardEmpty(clearedBoard);
  const scoreResult = scorePlacement({
    pieceCells: cellCount(piece),
    unitsCleared,
    comboLevelAfter,
    isBoardEmptyAfter: isEmpty,
  });
  const nextScore = state.score + scoreResult.turnScore;

  const handAfterPlacement: [Piece | null, Piece | null, Piece | null] = [
    state.hand[0],
    state.hand[1],
    state.hand[2],
  ];
  handAfterPlacement[action.slot] = null;

  let hand: Hand = handAfterPlacement;
  let rng = state.rng;
  if (handAfterPlacement.every((p) => p === null)) {
    const dealt = dealHand(clearedBoard, rng, nextScore);
    hand = dealt.hand;
    rng = dealt.rng;
  }

  const next: GameState = {
    board: clearedBoard,
    hand,
    rng,
    score: nextScore,
    comboLevel: comboLevelAfter,
    piecesPlaced: state.piecesPlaced + 1,
    unitsCleared: state.unitsCleared + unitsCleared,
    maxComboLevel: Math.max(state.maxComboLevel, comboLevelAfter),
    perfectClears: state.perfectClears + (isEmpty ? 1 : 0),
    powerupsUsed: state.powerupsUsed,
    status: "playing",
  };
  return { ...next, status: isGameOver(next.board, next.hand) ? "gameover" : "playing" };
}

function reducePowerup(state: GameState, action: PowerupAction): GameState {
  let board: Board = state.board;
  let unitsCleared = 0;

  switch (action.kind) {
    case "pencil":
      board = applyPencil(board, action.r, action.c);
      break;
    case "eraser":
      board = applyEraser(board, action.r, action.c);
      break;
    case "rocket": {
      const result = applyRocket(board, action.orientation, action.index);
      board = result.board;
      unitsCleared = result.unitsCleared;
      break;
    }
    case "bomb": {
      const result = applyBomb(board, action.r, action.c);
      board = result.board;
      unitsCleared = result.unitsCleared;
      break;
    }
    case "fill": {
      // A region-too-large refusal (FillRegionTooLargeError) propagates to the
      // caller uncaught: it's not a cheat signal, just a declined action that
      // shouldn't be logged/consumed in the first place (§7).
      const filled = applyFill(board, action.r, action.c);
      const cleared = resolveClears(filled.board);
      board = cleared.board;
      unitsCleared = cleared.unitsCleared;
      break;
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown powerup action: ${JSON.stringify(exhaustive)}`);
    }
  }

  const isEmpty = isBoardEmpty(board);
  const scoreResult = scorePowerupClear({
    unitsCleared,
    comboLevel: state.comboLevel,
    isBoardEmptyAfter: isEmpty,
  });

  const next: GameState = {
    board,
    hand: state.hand,
    rng: state.rng,
    score: state.score + scoreResult.turnScore,
    comboLevel: state.comboLevel,
    piecesPlaced: state.piecesPlaced,
    unitsCleared: state.unitsCleared + unitsCleared,
    maxComboLevel: state.maxComboLevel,
    perfectClears: state.perfectClears + (isEmpty ? 1 : 0),
    powerupsUsed: state.powerupsUsed + 1,
    status: "playing",
  };
  return { ...next, status: isGameOver(next.board, next.hand) ? "gameover" : "playing" };
}

// Re-exported so callers building actions don't need a separate import for the fallback piece id.
export const DOT_PIECE_ID: Piece["id"] = getPiece("DOT").id;
