import { canPlace, createInitialState, reduce, type Action, type GameState } from "@nonet/engine";

/** Same "first legal position, row-major scan" bot as the engine's own test fixtures — just for building a legitimate action log to exercise the API's run endpoints. */
export function autoplay(seedBytes: Uint8Array, maxActions = 60): { actions: Action[]; finalState: GameState } {
  let state = createInitialState(seedBytes);
  const actions: Action[] = [];
  let t = 0;

  while (state.status === "playing" && actions.length < maxActions) {
    let placedThisRound = false;
    for (const slot of [0, 1, 2] as const) {
      const piece = state.hand[slot];
      if (!piece) continue;
      let target: { row: number; col: number } | null = null;
      outer: for (let row = 0; row <= 9 - piece.h; row++) {
        for (let col = 0; col <= 9 - piece.w; col++) {
          if (canPlace(state.board, piece, row, col)) {
            target = { row, col };
            break outer;
          }
        }
      }
      if (!target) continue;
      t += 200;
      const action: Action = { t, type: "place", slot, r: target.row, c: target.col };
      state = reduce(state, action);
      actions.push(action);
      placedThisRound = true;
      break;
    }
    if (!placedThisRound) break;
  }

  return { actions, finalState: state };
}

/**
 * Greedily plays whichever legal (slot, position) scores the most on that
 * placement each turn, starting from an arbitrary state/timestamp — not just
 * a fresh deal. Shared by `autoplayGreedy` (from a new seed) and tests that
 * need to keep playing past a specific point, e.g. after a revive resets the
 * board mid-run.
 */
export function continueGreedy(
  startState: GameState,
  startT: number,
  maxActions: number,
): { actions: Action[]; finalState: GameState } {
  let state = startState;
  const actions: Action[] = [];
  let t = startT;

  while (state.status === "playing" && actions.length < maxActions) {
    let best: { action: Action; next: GameState } | null = null;

    for (const slot of [0, 1, 2] as const) {
      const piece = state.hand[slot];
      if (!piece) continue;
      for (let row = 0; row <= 9 - piece.h; row++) {
        for (let col = 0; col <= 9 - piece.w; col++) {
          if (!canPlace(state.board, piece, row, col)) continue;
          const action: Action = { t: t + 200, type: "place", slot, r: row, c: col };
          const next = reduce(state, action);
          if (!best || next.score - state.score > best.next.score - state.score) {
            best = { action, next };
          }
        }
      }
    }

    if (!best) break;
    t += 200;
    state = best.next;
    actions.push(best.action);
  }

  return { actions, finalState: state };
}

/**
 * Greedily plays whichever legal (slot, position) scores the most on that
 * placement, instead of `autoplay`'s first-legal-position scan — the naive
 * bot rarely clears lines and stalls out at a low score, which makes it
 * impractical for milestone tests that need a real run to legitimately reach
 * a high score against a genuinely random server-issued seed.
 */
export function autoplayGreedy(seedBytes: Uint8Array, maxActions = 300): { actions: Action[]; finalState: GameState } {
  return continueGreedy(createInitialState(seedBytes), 0, maxActions);
}
