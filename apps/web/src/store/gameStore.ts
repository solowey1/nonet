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
import type { Action as SharedAction, AchievementProgress, PowerupKind, ProfileResponse } from "@nonet/shared";
import {
  ApiError,
  getAchievements,
  getProfile,
  postDevSession,
  postInventoryConsume,
  postRunCheckpoint,
  postRunFinish,
  postRunStart,
  postSession,
  postShopInvoice,
  sendCheckpointBeacon,
} from "../api/client.js";
import {
  bootstrapTelegramWebApp,
  getTelegramInitData,
  hapticImpact,
  hapticNotification,
  openInvoice,
  setClosingConfirmation,
  setShareTargetUrl,
} from "../telegram/webapp.js";
import { playSound } from "../audio/sounds.js";
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
  readonly unlockedAchievements: readonly string[];
}

export type BootStatus = "loading" | "ready" | "error";

export type ConsumeFailureReason = "insufficient_inventory" | "region_too_large" | "invalid_target" | "network";

/** `cancelled`/`pending` mirror Telegram's own openInvoice statuses (§13); `failed` also covers no-WebApp/network cases. */
export type ReviveOutcome = "purchased" | "cancelled" | "pending" | "failed";

/**
 * The main menu is the landing screen (§19 step 6) — bootstrap never
 * auto-starts or auto-resumes into a run. Every non-menu screen is exactly
 * one level deep (reached only from the menu), so "back" from any of them
 * always means "menu" — a flat graph, not a generic stack/router.
 */
export type Screen = "menu" | "game" | "leaderboard" | "shop" | "settings" | "achievements";

interface GameStoreState {
  readonly bootStatus: BootStatus;
  readonly bootError: string | null;
  readonly screen: Screen;

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
  readonly profile: ProfileResponse | null;
  readonly achievements: readonly AchievementProgress[] | null;

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
  loadProfile(): Promise<void>;
  loadAchievements(): Promise<void>;
  newRun(): Promise<void>;
  continueRun(): void;
  goToMenu(): void;
  goToLeaderboard(): void;
  goToShop(): void;
  goToSettings(): void;
  goToAchievements(): void;
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

  /** Ignores the periodic threshold — used wherever progress must be saved *now* (e.g. leaving the game screen via Back). */
  async function forceCheckpoint() {
    const { runId, runToken, actionLog, checkpointedCount } = get();
    if (!runId || !runToken || actionLog.length <= checkpointedCount) return;
    try {
      await postRunCheckpoint(runToken, runId, actionLog);
      set({ checkpointedCount: actionLog.length });
    } catch (err) {
      console.error("checkpoint failed (non-fatal, will retry on the next threshold/back/close)", err);
    }
  }

  async function maybeCheckpoint() {
    const { runId, actionLog, checkpointedCount } = get();
    if (!runId || actionLog.length - checkpointedCount < CHECKPOINT_EVERY_N_ACTIONS) return;
    await forceCheckpoint();
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
      set({
        finishResult: {
          score: result.score,
          verified: result.verified,
          rank: result.rank,
          unlockedAchievements: result.unlockedAchievements,
        },
      });
      if (result.verified) void get().loadProfile(); // best score may have just changed
      // Achievement rewards (and any milestone drops) are granted server-side
      // without a matching client-side balance update — only worth the round
      // trip when something was actually earned.
      if (result.unlockedAchievements.length > 0) void get().refreshInventory();
    } catch (err) {
      console.error("run/finish failed — local score still stands, just unranked", err);
      set({ finishResult: { score: game.score, verified: false, rank: null, unlockedAchievements: [] } });
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

    // The power-up's own sound always fires (it's what tells you *which*
    // power-up went off); the outcome sound layers on top only when the turn
    // produced something bigger than the power-up itself — a perfect clear or
    // the end of the run.
    playSound(kind);
    if (next.status === "gameover") playSound("gameOver");
    else if (isPerfectClear) playSound("perfectClear");

    if (next.status === "gameover") hapticNotification("error");
    else if (isPerfectClear) hapticNotification("success");
    else if (clearedMask !== 0n) hapticImpact("medium");
    else hapticImpact("light");

    void maybeCheckpoint();
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
    screen: "menu",

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
    profile: null,
    achievements: null,

    async bootstrap() {
      await bootstrapTelegramWebApp();
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
        // Only the server knows the bot's username, so the link a share card
        // points at arrives with the session rather than being baked into
        // this bundle (§19 round 7).
        setShareTargetUrl(session.miniAppUrl);

        // The main menu is always the landing screen (§19 step 6) — a
        // resumed run is loaded into the store so "Continue" is available,
        // but entering it is the player's own choice, not automatic. With no
        // resumable run, runId/game are simply left at their initial blank
        // state and the menu offers "Play" instead.
        if (session.activeRun) {
          const { runId, seedHex, actions, runToken } = session.activeRun;
          let state = createInitialState(hexToBytes(seedHex));
          try {
            for (const action of actions) state = reduce(state, action);
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
            setClosingConfirmation(true);
          } catch (err) {
            // Corrupted/incompatible resumed log — fall through with no
            // active run rather than silently starting a new one behind the
            // player's back; the menu's "Play" button covers this the same
            // as a genuinely fresh user.
            console.error("failed to replay the resumed run locally — discarding it", err);
          }
        }

        set({ bootStatus: "ready" });
        void get().loadProfile(); // best score for the HUD — non-critical, doesn't block boot
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

      // Sound mirrors the same four outcomes the haptics below distinguish.
      // The placement thunk always plays first — a clear is something that
      // happens *because* a piece landed, so hearing only the fanfare would
      // lose the landing itself.
      playSound("place");
      if (next.status === "gameover") playSound("gameOver");
      else if (isPerfectClear) playSound("perfectClear");
      else if (preview.unitsCleared > 0) playSound("clear", preview.unitsCleared, next.comboLevel);

      // §12 haptics: scale with what actually happened this turn, so a plain
      // placement, a line clear, a perfect clear, and running out of moves
      // each have a distinctly different feel rather than one generic buzz.
      if (next.status === "gameover") hapticNotification("error");
      else if (isPerfectClear) hapticNotification("success");
      else if (preview.unitsCleared > 0) hapticImpact("medium");
      else hapticImpact("light");

      void maybeCheckpoint();
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
      const { sessionToken, runId, runToken, game, actionLog, revivePending, inventory } = get();
      if (!sessionToken || !runId || !runToken || game.status !== "gameover" || revivePending) return "failed";

      set({ revivePending: true });
      try {
        let consumeToken: string;
        const stocked = (inventory.revive ?? 0) > 0;

        if (stocked) {
          // Free: spend one already-owned revive (bought in bulk from the
          // Shop, §19 round 5) instead of paying Stars again right now.
          try {
            const consumed = await postInventoryConsume(runToken, runId, "revive");
            consumeToken = consumed.consumeToken;
          } catch (err) {
            console.error("failed to consume a stocked revive", err);
            return "failed";
          }
        } else {
          let invoiceLink: string;
          try {
            const invoice = await postShopInvoice(sessionToken, "revive", runId);
            invoiceLink = invoice.invoiceLink;
            consumeToken = invoice.purchaseId;
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
        }

        const reviveAction = { t: Date.now(), type: "revive" as const, consumeToken };
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
        playSound("revive");
        hapticNotification("success");
        void maybeCheckpoint();
        if (stocked) void get().refreshInventory(); // just spent one from stock — keep the displayed count honest
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

    async loadProfile() {
      const { sessionToken } = get();
      if (!sessionToken) return;
      try {
        const profile = await getProfile(sessionToken);
        set({ profile });
      } catch (err) {
        console.error("failed to load profile", err); // best score just doesn't show — not fatal
      }
    },

    async loadAchievements() {
      const { sessionToken } = get();
      if (!sessionToken) return;
      try {
        const { achievements } = await getAchievements(sessionToken);
        set({ achievements });
      } catch (err) {
        console.error("failed to load achievements", err);
      }
    },

    async newRun() {
      const { sessionToken, game } = get();
      if (!sessionToken) return;
      // Fire-and-forget, same as the old auto-finish: the player chose to
      // move on without reviving, so the run is really over now.
      if (game.status === "gameover") void finishRun();
      await startFreshRun(sessionToken);
      setClosingConfirmation(true);
      set({ screen: "game" });
    },

    continueRun() {
      // No network call — a resumed run is already loaded into the store by
      // bootstrap(); this just switches which screen is showing.
      setClosingConfirmation(true);
      set({ screen: "game" });
    },

    goToMenu() {
      // Leaving the game screen — via the native BackButton or the in-game
      // Home button, both route through here — must save progress right
      // away, not just wait for the next periodic checkpoint (§19: "Back"
      // saves the run same as closing the app does). Fire-and-forget: the
      // visibilitychange/pagehide safety net still covers a real app close
      // regardless of whether this particular request succeeds.
      if (get().screen === "game") void forceCheckpoint();
      set({ screen: "menu" });
    },

    goToLeaderboard() {
      set({ screen: "leaderboard" });
    },

    goToShop() {
      set({ screen: "shop" });
    },

    goToSettings() {
      set({ screen: "settings" });
    },

    goToAchievements() {
      set({ screen: "achievements" });
      void get().loadAchievements();
    },
  };
});

/**
 * The periodic every-25-actions checkpoint (see maybeCheckpoint above) is
 * fine for the normal case, but a naive Telegram-close mid-session — the
 * scenario the user actually complained about — can easily land between two
 * of those. `visibilitychange`/`pagehide` are the standard signal for "the
 * app is being backgrounded or torn down"; there's no Telegram-specific
 * "about to close" hook to prefer over them. Registered once at module load
 * (not per-component-mount) since this is a single global concern, not tied
 * to any particular component's lifecycle.
 */
if (typeof document !== "undefined") {
  const forceCheckpointIfDirty = () => {
    const { runId, runToken, actionLog, checkpointedCount } = useGameStore.getState();
    if (!runId || !runToken) return;
    if (actionLog.length <= checkpointedCount) return; // already covered by the last checkpoint/finish
    sendCheckpointBeacon(runToken, runId, actionLog);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) forceCheckpointIfDirty();
  });
  window.addEventListener("pagehide", forceCheckpointIfDirty);
}
