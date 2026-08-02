import { create } from "zustand";
import {
  BOARD_SIZE,
  FILL_MAX_REGION,
  applyFill,
  createInitialState,
  floodFillEmptyRegion,
  placePiece,
  reduce,
  resolveClears,
  type Board,
  type GameState,
} from "@nonet/engine";
import type { Action as SharedAction, PowerupKind } from "@nonet/shared";
import {
  ApiError,
  postDevSession,
  postInventoryConsume,
  postRunCheckpoint,
  postRunFinish,
  postRunStart,
  postSession,
  postShopInvoice,
} from "../api/client.js";
import { bootstrapTelegramWebApp, getTelegramInitData, openInvoice, setClosingConfirmation } from "../telegram/webapp.js";
import { maskToCells } from "../utils/bitmask.js";
import { getOrCreateDevUserId } from "../utils/devUser.js";
import { hexToBytes } from "../utils/hex.js";
import { pieceFamily } from "../utils/pieceFamily.js";

const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
const CHECKPOINT_EVERY_N_ACTIONS = 25;

function randomSeed(): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytes;
}

function freshCellFamilies(): Uint8Array {
  return new Uint8Array(TOTAL_CELLS);
}

export interface ClearEvent {
  /** Bumped on every clear so React effects re-fire even if the mask repeats. */
  readonly key: number;
  readonly clearedMask: Board;
  readonly unitsCleared: number;
  readonly comboLevel: number;
  readonly turnScore: number;
  readonly isPerfectClear: boolean;
  /** Where the animation staggers outward from. */
  readonly originRow: number;
  readonly originCol: number;
}

export interface FinishResult {
  readonly score: number;
  readonly verified: boolean;
  readonly rank: number | null;
}

export type BootStatus = "loading" | "ready" | "error";

export type ConsumeFailureReason = "insufficient_inventory" | "region_too_large" | "invalid_target" | "network";

/** `cancelled`/`pending` mirror Telegram's own openInvoice statuses (§13); `failed` also covers no-WebApp/network cases. */
export type ReviveOutcome = "purchased" | "cancelled" | "pending" | "failed";

interface GameStoreState {
  readonly bootStatus: BootStatus;
  readonly bootError: string | null;

  readonly sessionToken: string | null;
  readonly runId: string | null;
  readonly runToken: string | null;
  readonly actionLog: SharedAction[];
  readonly checkpointedCount: number;

  readonly game: GameState;
  readonly cellFamilies: Uint8Array;
  readonly lastClear: ClearEvent | null;
  readonly inventory: Record<string, number>;
  readonly armedPowerup: PowerupKind | null;
  readonly finishResult: FinishResult | null;
  readonly revivePending: boolean;

  bootstrap(): Promise<void>;
  place(slot: 0 | 1 | 2, row: number, col: number): boolean;
  armPowerup(kind: PowerupKind | null): void;
  applyPencil(row: number, col: number): Promise<boolean>;
  applyEraser(row: number, col: number): Promise<boolean>;
  applyBomb(row: number, col: number): Promise<boolean>;
  applyRocket(orientation: "row" | "col", index: number): Promise<boolean>;
  applyFillPowerup(row: number, col: number): Promise<{ ok: boolean; reason?: ConsumeFailureReason; regionSize?: number }>;
  buyRevive(): Promise<ReviveOutcome>;
  refreshInventory(): Promise<void>;
  newRun(): Promise<void>;
}

let clearEventCounter = 0;

function markCellsForPiece(cellFamilies: Uint8Array, piece: GameState["hand"][number], row: number, col: number): Uint8Array {
  const next = cellFamilies.slice();
  if (!piece) return next;
  const family = pieceFamily(piece.cells.length);
  for (const [dr, dc] of piece.cells) {
    next[(row + dr) * BOARD_SIZE + (col + dc)] = family;
  }
  return next;
}

function clearCellFamilies(cellFamilies: Uint8Array, clearedMask: Board): Uint8Array {
  const next = cellFamilies.slice();
  for (const { index } of maskToCells(clearedMask)) next[index] = 0;
  return next;
}

export const useGameStore = create<GameStoreState>((set, get) => {
  async function startFreshRun(sessionToken: string) {
    const { runId, seedHex, runToken } = await postRunStart(sessionToken);
    set({
      runId,
      runToken,
      actionLog: [],
      checkpointedCount: 0,
      game: createInitialState(hexToBytes(seedHex)),
      cellFamilies: freshCellFamilies(),
      lastClear: null,
      finishResult: null,
    });
  }

  async function maybeCheckpoint(actionLog: SharedAction[]) {
    const { runId, runToken, checkpointedCount } = get();
    if (!runId || !runToken) return;
    if (actionLog.length - checkpointedCount < CHECKPOINT_EVERY_N_ACTIONS) return;
    try {
      await postRunCheckpoint(runToken, runId, actionLog);
      set({ checkpointedCount: actionLog.length });
    } catch (err) {
      console.error("checkpoint failed (non-fatal, will retry on the next threshold)", err);
    }
  }

  // Deliberately not triggered the instant `game.status` flips to "gameover"
  // (§8: a revive purchase must still be possible against this exact run) —
  // called only once the player actually leaves the game-over screen, via
  // `newRun()` below. Until then the run just sits open server-side; if the
  // player never comes back, `/api/session` resumes it as `activeRun` next
  // time, unfinished and un-scored, which is fine (see DECISIONS.md).
  async function finishRun() {
    const { game, runId, runToken, actionLog, finishResult } = get();
    if (game.status !== "gameover" || finishResult) return;
    if (!runId || !runToken) return;
    setClosingConfirmation(false);
    try {
      const result = await postRunFinish(runToken, runId, actionLog);
      set({ finishResult: { score: result.score, verified: result.verified, rank: result.rank } });
    } catch (err) {
      console.error("run/finish failed — local score still stands, just unranked", err);
      set({ finishResult: { score: game.score, verified: false, rank: null } });
    }
  }

  async function applyPowerupAction(
    kind: PowerupKind,
    argsWithoutToken: Omit<Extract<SharedAction, { kind: PowerupKind }>, "t" | "type" | "kind" | "consumeToken">,
    originRow: number,
    originCol: number,
  ): Promise<boolean> {
    const { game, runId, runToken, inventory, actionLog, cellFamilies } = get();
    if (!runId || !runToken) return false;
    if ((inventory[kind] ?? 0) <= 0) return false;

    let consumeToken: string;
    let remaining: number;
    try {
      const res = await postInventoryConsume(runToken, runId, kind);
      consumeToken = res.consumeToken;
      remaining = res.remaining;
    } catch {
      return false; // insufficient inventory (server-authoritative race) or network error
    }

    const action = {
      t: Date.now(),
      type: "powerup",
      kind,
      ...argsWithoutToken,
      consumeToken,
    } as SharedAction;

    let next: GameState;
    try {
      next = reduce(game, action);
    } catch (err) {
      // The item is already spent server-side — consuming is deliberately
      // irreversible at use time (§9), so a local engine rejection here (it
      // shouldn't happen if the targeting UI only ever offers legal targets)
      // is a real, if rare, "used it and it whiffed" cost, not a rollback case.
      console.error("engine rejected a just-consumed power-up action", err);
      set({ inventory: { ...inventory, [kind]: remaining } });
      return false;
    }

    const clearedMask = kind === "fill" ? computeFillClearedMask(game.board, originRow, originCol) : game.board & ~next.board;
    const isPerfectClear = next.perfectClears > game.perfectClears;
    const turnScore = next.score - game.score;

    const nextActionLog = [...actionLog, action];
    set({
      game: next,
      inventory: { ...inventory, [kind]: remaining },
      cellFamilies: clearCellFamilies(cellFamilies, clearedMask),
      actionLog: nextActionLog,
      armedPowerup: null,
      lastClear:
        clearedMask !== 0n
          ? {
              key: ++clearEventCounter,
              clearedMask,
              unitsCleared: kind === "rocket" ? 1 : kind === "bomb" ? 2 : 0,
              comboLevel: next.comboLevel,
              turnScore,
              isPerfectClear,
              originRow,
              originCol,
            }
          : null,
    });

    void maybeCheckpoint(nextActionLog);
    return true;
  }

  function computeFillClearedMask(board: Board, row: number, col: number): Board {
    // Fill can fill-then-clear cells that were never set in `board`, invisible
    // to a simple before/after diff — recompute the same way reduce.ts does.
    const filled = applyFill(board, row, col);
    return resolveClears(filled.board).clearedMask;
  }

  return {
    bootStatus: "loading",
    bootError: null,

    sessionToken: null,
    runId: null,
    runToken: null,
    actionLog: [],
    checkpointedCount: 0,

    game: createInitialState(new Uint8Array(16)),
    cellFamilies: freshCellFamilies(),
    lastClear: null,
    inventory: {},
    armedPowerup: null,
    finishResult: null,
    revivePending: false,

    async bootstrap() {
      bootstrapTelegramWebApp();
      try {
        const initData = getTelegramInitData();
        const session = initData
          ? await postSession(initData)
          : import.meta.env.DEV
            ? await postDevSession(getOrCreateDevUserId(), "dev")
            : (() => {
                throw new Error("no Telegram initData available outside a Telegram WebView");
              })();

        set({ sessionToken: session.token, inventory: session.inventory });

        if (session.activeRun) {
          const { runId, seedHex, actions, runToken } = session.activeRun;
          let state = createInitialState(hexToBytes(seedHex));
          try {
            for (const action of actions) state = reduce(state, action);
          } catch (err) {
            console.error("failed to replay the resumed run locally — starting a fresh run instead", err);
            await startFreshRun(session.token);
            set({ bootStatus: "ready" });
            return;
          }
          set({
            runId,
            runToken,
            actionLog: actions,
            checkpointedCount: actions.length,
            game: state,
            cellFamilies: freshCellFamilies(), // cosmetic only — see DECISIONS.md
            lastClear: null,
            finishResult: null,
          });
        } else {
          await startFreshRun(session.token);
        }

        setClosingConfirmation(true);
        set({ bootStatus: "ready" });
      } catch (err) {
        console.error("bootstrap failed", err);
        const message = err instanceof ApiError ? `API error ${err.status}` : (err as Error).message;
        set({ bootStatus: "error", bootError: message });
      }
    },

    place(slot, row, col) {
      const { game, cellFamilies, runId, runToken, actionLog } = get();
      if (game.status === "gameover" || !runId || !runToken) return false;
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
        return false;
      }

      const action: SharedAction = { t: Date.now(), type: "place", slot, r: row, c: col };
      let next: GameState;
      try {
        next = reduce(game, action);
      } catch {
        return false;
      }

      let nextFamilies = markCellsForPiece(cellFamilies, piece, row, col);
      nextFamilies = clearCellFamilies(nextFamilies, preview.clearedMask);

      const isPerfectClear = preview.unitsCleared > 0 && next.perfectClears > game.perfectClears;
      const nextActionLog = [...actionLog, action];

      set({
        game: next,
        cellFamilies: nextFamilies,
        actionLog: nextActionLog,
        lastClear:
          preview.unitsCleared > 0
            ? {
                key: ++clearEventCounter,
                clearedMask: preview.clearedMask,
                unitsCleared: preview.unitsCleared,
                comboLevel: next.comboLevel,
                turnScore: next.score - game.score,
                isPerfectClear,
                originRow: row,
                originCol: col,
              }
            : null,
      });

      void maybeCheckpoint(nextActionLog);
      return true;
    },

    armPowerup(kind) {
      set({ armedPowerup: kind });
    },

    applyPencil(row, col) {
      return applyPowerupAction("pencil", { r: row, c: col }, row, col);
    },

    applyEraser(row, col) {
      return applyPowerupAction("eraser", { r: row, c: col }, row, col);
    },

    applyBomb(row, col) {
      return applyPowerupAction("bomb", { r: row, c: col }, row, col);
    },

    applyRocket(orientation, index) {
      const origin = orientation === "row" ? { row: index, col: 0 } : { row: 0, col: index };
      return applyPowerupAction("rocket", { orientation, index }, origin.row, origin.col);
    },

    async applyFillPowerup(row, col) {
      const { game, inventory } = get();
      if ((inventory.fill ?? 0) <= 0) return { ok: false, reason: "insufficient_inventory" };

      let region;
      try {
        region = floodFillEmptyRegion(game.board, row, col);
      } catch {
        return { ok: false, reason: "invalid_target" };
      }
      if (region.length > FILL_MAX_REGION) {
        return { ok: false, reason: "region_too_large", regionSize: region.length };
      }

      const ok = await applyPowerupAction("fill", { r: row, c: col }, row, col);
      return ok ? { ok: true } : { ok: false, reason: "network" };
    },

    async buyRevive() {
      const { sessionToken, runId, runToken, game, actionLog, revivePending } = get();
      if (!sessionToken || !runId || !runToken || game.status !== "gameover" || revivePending) return "failed";

      set({ revivePending: true });
      try {
        let invoiceLink: string, purchaseId: string;
        try {
          const invoice = await postShopInvoice(sessionToken, "revive", runId);
          invoiceLink = invoice.invoiceLink;
          purchaseId = invoice.purchaseId;
        } catch (err) {
          console.error("failed to mint a revive invoice", err);
          return "failed";
        }

        const status = await openInvoice(invoiceLink);
        if (status !== "paid") return status;

        // §13: openInvoice's "paid" is optimistic client-side signal — the
        // bot's successful_payment webhook is the actual source of truth for
        // crediting, but the purchase row it needs already exists (created
        // above) so the consumeToken is valid the instant Telegram reports it.
        const reviveAction = { t: Date.now(), type: "revive" as const, consumeToken: purchaseId };
        let next: GameState;
        try {
          next = reduce(game, reviveAction);
        } catch (err) {
          console.error("engine rejected a just-purchased revive action", err);
          return "failed";
        }

        const nextActionLog = [...actionLog, reviveAction as SharedAction];
        set({
          game: next,
          actionLog: nextActionLog,
          cellFamilies: freshCellFamilies(), // board was reset — cosmetic only, see DECISIONS.md
          lastClear: null,
          finishResult: null,
        });
        setClosingConfirmation(true);
        void maybeCheckpoint(nextActionLog);
        return "purchased";
      } finally {
        set({ revivePending: false });
      }
    },

    async refreshInventory() {
      // No standalone "GET my inventory" endpoint — /api/session already
      // returns the current balance and is safe to re-call mid-session (the
      // daily gift it may grant is idempotent per calendar day server-side).
      const { sessionToken } = get();
      if (!sessionToken) return;
      try {
        const initData = getTelegramInitData();
        const session = initData
          ? await postSession(initData)
          : import.meta.env.DEV
            ? await postDevSession(getOrCreateDevUserId(), "dev")
            : null;
        if (session) set({ sessionToken: session.token, inventory: session.inventory });
      } catch (err) {
        console.error("failed to refresh inventory", err);
      }
    },

    async newRun() {
      const { sessionToken, game } = get();
      if (!sessionToken) return;
      // Fire-and-forget, same as the old auto-finish: the player chose to
      // move on without reviving, so the run is really over now.
      if (game.status === "gameover") void finishRun();
      await startFreshRun(sessionToken);
    },
  };
});
