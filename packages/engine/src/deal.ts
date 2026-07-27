/**
 * Hand generation & the solvability guard (§5). The dealer must reason about
 * the board — a naive random hand can be unplaceable, which would end a run
 * on bad luck rather than a bad placement.
 */

import { type Board, fillRatio, legalPlacements, placePiece, resolveClears } from "./board.js";
import { PIECE_CATALOGUE, type Piece, cellCount, getPiece, isLargePiece } from "./pieces.js";
import { type RngState, pickWeightedIndex } from "./rng.js";

export type DifficultyTier = "gentle" | "normal" | "hard";

export function difficultyTier(score: number): DifficultyTier {
  if (score < 2000) return "gentle";
  if (score <= 10000) return "normal";
  return "hard";
}

/** How many of the 3 dealt pieces must be simultaneously placeable, per §5. */
export function requirementForTier(tier: DifficultyTier): number {
  switch (tier) {
    case "gentle":
      return 3;
    case "normal":
      return 2;
    case "hard":
      return 1;
  }
}

/**
 * Adaptive weighting (§4): favour small pieces on a near-empty board, and
 * penalise large ones on a crowded board.
 */
export function adaptiveWeight(piece: Piece, fill: number): number {
  let w = piece.weight;
  const cells = cellCount(piece);
  if (fill > 0.6 && cells >= 5) w *= 0.35;
  if (fill < 0.25 && cells <= 2) w *= 0.5;
  return w;
}

function weightsForFill(fill: number): number[] {
  return PIECE_CATALOGUE.map((p) => adaptiveWeight(p, fill));
}

function drawOne(state: RngState, weights: readonly number[], excludeIndex?: number): [Piece, RngState] {
  let w: readonly number[] = weights;
  if (excludeIndex !== undefined) {
    const copy = weights.slice();
    copy[excludeIndex] = 0;
    w = copy;
  }
  const [idx, next] = pickWeightedIndex(state, w);
  return [PIECE_CATALOGUE[idx] as Piece, next];
}

/**
 * Draw 3 weighted-random pieces (with replacement), enforcing "never deal
 * three copies of the same large (>=5 cell) piece in one hand" (§4).
 */
export function drawHand(state: RngState, fill: number): [[Piece, Piece, Piece], RngState] {
  const weights = weightsForFill(fill);
  const [p1, s1] = drawOne(state, weights);
  const [p2, s2] = drawOne(s1, weights);
  let p3: Piece;
  let s3: RngState;
  if (p1.id === p2.id && isLargePiece(p1)) {
    const excludeIndex = PIECE_CATALOGUE.findIndex((p) => p.id === p1.id);
    [p3, s3] = drawOne(s2, weights, excludeIndex);
  } else {
    [p3, s3] = drawOne(s2, weights);
  }
  return [[p1, p2, p3], s3];
}

function remainingKey(board: Board, remaining: readonly Piece[]): string {
  const ids = remaining
    .map((p) => p.id)
    .slice()
    .sort()
    .join(",");
  return `${board.toString(36)}|${ids}`;
}

/**
 * DFS over every ordering and every legal position for `hand`, returning the
 * maximum number of the hand's pieces that can be placed consecutively
 * (each placement mutating the board, with clears resolved in between).
 * Memoised on (board, remaining-piece-set): the recursion already explores
 * every ordering by choosing which piece to place next at each level, so a
 * (board, set) pair fully determines the best achievable count from there.
 */
export function maxPlaceable(
  board: Board,
  hand: readonly Piece[],
  sharedMemo?: Map<string, number>,
): number {
  const memo = sharedMemo ?? new Map<string, number>();

  function search(currentBoard: Board, remaining: readonly Piece[]): number {
    if (remaining.length === 0) return 0;
    const key = remainingKey(currentBoard, remaining);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    let best = 0;
    for (let i = 0; i < remaining.length && best < remaining.length; i++) {
      const piece = remaining[i] as Piece;
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
      const positions = legalPlacements(currentBoard, piece);
      for (const { row, col } of positions) {
        const placed = placePiece(currentBoard, piece, row, col);
        const { board: cleared } = resolveClears(placed);
        const sub = 1 + search(cleared, rest);
        if (sub > best) {
          best = sub;
          if (best >= remaining.length) break;
        }
      }
    }

    memo.set(key, best);
    return best;
  }

  return search(board, hand);
}

export const DEAL_MAX_ATTEMPTS = 40;

export interface DealResult {
  readonly hand: readonly [Piece, Piece, Piece];
  readonly rng: RngState;
}

/**
 * Deal a hand of 3, retrying up to DEAL_MAX_ATTEMPTS times to satisfy the
 * current tier's solvability requirement. Falls back to the best hand seen
 * if no attempt meets the requirement, and — as a last resort — to an
 * all-DOT hand, so it is a hard invariant that maxPlaceable(hand) >= 1
 * whenever the board has any empty cell (§5: "never deal a hand where zero
 * pieces fit").
 */
export function dealHand(board: Board, rng: RngState, score: number): DealResult {
  const fill = fillRatio(board);
  const requirement = requirementForTier(difficultyTier(score));

  let state = rng;
  let best: { hand: [Piece, Piece, Piece]; count: number } | null = null;
  // Shared across every retry: the board is the same for all attempts, so a
  // (board, remaining-set) subproblem solved for one candidate hand is very
  // often reusable by the next, especially once hands start repeating pieces.
  const sharedMemo = new Map<string, number>();

  for (let attempt = 0; attempt < DEAL_MAX_ATTEMPTS; attempt++) {
    const [hand, next] = drawHand(state, fill);
    state = next;
    const count = maxPlaceable(board, hand, sharedMemo);
    if (best === null || count > best.count) best = { hand, count };
    if (count >= requirement) {
      return { hand, rng: state };
    }
  }

  if (best !== null && best.count > 0) {
    return { hand: best.hand, rng: state };
  }

  const dot = getPiece("DOT");
  const fallbackHand: [Piece, Piece, Piece] = [dot, dot, dot];
  return { hand: fallbackHand, rng: state };
}
