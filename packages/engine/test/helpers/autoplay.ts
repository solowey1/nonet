/**
 * Test-only helper: a deterministic "always place the first piece at the
 * first legal position, row-major scan" bot. Used both by the replay
 * property test and to generate the golden-replay fixtures. Not part of the
 * shipped engine — the real client/server pick real placements.
 */
import { canPlace } from "../../src/board.js";
import { type Action, type GameState, createInitialState, reduce } from "../../src/reduce.js";

export function seedFromIndex(i: number): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes[0] = i & 0xff;
  bytes[1] = (i >> 8) & 0xff;
  bytes[2] = (i >> 16) & 0xff;
  bytes[15] = 0xa5; // avoid an all-zero seed
  return bytes;
}

export interface AutoplayResult {
  readonly actions: Action[];
  readonly finalState: GameState;
}

export function autoplay(seedBytes: Uint8Array, maxActions = 400): AutoplayResult {
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
      break; // re-scan from slot 0 next round: the hand may have just been redealt
    }

    if (!placedThisRound) break; // no piece in the current hand fits anywhere: game over
  }

  return { actions, finalState: state };
}
