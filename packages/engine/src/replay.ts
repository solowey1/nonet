/**
 * `replay(seed, actions) => {score, hash, valid}` (§9). The server calls this
 * with the exact same engine package the client ran, replaying the action log
 * against the deterministic reducer and comparing the result. A rolling hash
 * is folded in after every action so any divergence — even one that
 * coincidentally produces the same final score — is caught.
 */

import { type Action, type GameState, createInitialState, reduce } from "./reduce.js";

function fnv1a32(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function serializeState(state: GameState): string {
  const handIds = state.hand.map((p) => (p ? p.id : "_")).join(",");
  return [
    state.board.toString(16),
    handIds,
    state.score,
    state.comboLevel,
    state.piecesPlaced,
    state.unitsCleared,
    state.maxComboLevel,
    state.perfectClears,
    state.powerupsUsed,
    state.status,
  ].join("|");
}

export const MAX_SUSTAINED_ACTIONS_PER_SECOND = 8;
/** "Sustained" means averaged over a rolling window, not a single 2-action burst. */
export const SUSTAINED_WINDOW_MS = 3000;

export interface ApmCheckResult {
  readonly flagged: boolean;
  readonly windowStartIndex?: number;
}

/** Flags action logs whose timestamps imply superhuman, sustained input rate (§9). */
export function detectSuperhumanApm(
  actions: readonly Action[],
  maxPerSecond: number = MAX_SUSTAINED_ACTIONS_PER_SECOND,
  windowMs: number = SUSTAINED_WINDOW_MS,
): ApmCheckResult {
  const limit = maxPerSecond * (windowMs / 1000);
  let start = 0;
  for (let end = 0; end < actions.length; end++) {
    const endAction = actions[end] as Action;
    while (endAction.t - (actions[start] as Action).t > windowMs) {
      start++;
    }
    const count = end - start + 1;
    if (count > limit) {
      return { flagged: true, windowStartIndex: start };
    }
  }
  return { flagged: false };
}

export interface ReplaySuccess {
  readonly valid: true;
  readonly score: number;
  readonly hash: string;
  readonly finalState: GameState;
  readonly durationMs: number;
}

export interface ReplayFailure {
  readonly valid: false;
  readonly reason: "illegal_action" | "superhuman_apm";
  readonly error: string;
  readonly failedAtIndex: number;
  readonly scoreSoFar: number;
}

export type ReplayResult = ReplaySuccess | ReplayFailure;

export function replay(seed: Uint8Array, actions: readonly Action[]): ReplayResult {
  const apm = detectSuperhumanApm(actions);
  if (apm.flagged) {
    return {
      valid: false,
      reason: "superhuman_apm",
      error: `sustained action rate exceeds ${MAX_SUSTAINED_ACTIONS_PER_SECOND}/s starting at action ${apm.windowStartIndex}`,
      failedAtIndex: apm.windowStartIndex ?? 0,
      scoreSoFar: 0,
    };
  }

  let state = createInitialState(seed);
  let rollingHash = fnv1a32(serializeState(state));

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i] as Action;
    try {
      state = reduce(state, action);
    } catch (err) {
      return {
        valid: false,
        reason: "illegal_action",
        error: err instanceof Error ? err.message : String(err),
        failedAtIndex: i,
        scoreSoFar: state.score,
      };
    }
    rollingHash = fnv1a32(`${rollingHash.toString(16)}|${serializeState(state)}`);
  }

  const durationMs = actions.length > 0 ? (actions[actions.length - 1] as Action).t - (actions[0] as Action).t : 0;

  return {
    valid: true,
    score: state.score,
    hash: rollingHash.toString(16).padStart(8, "0"),
    finalState: state,
    durationMs,
  };
}
