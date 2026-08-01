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
