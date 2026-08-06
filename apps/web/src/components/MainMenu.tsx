import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Award, Play, RotateCcw, Settings, Share2, Store, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGameStore } from "../store/gameStore.js";
import { hapticSelection, shareViaTelegram } from "../telegram/webapp.js";
import { SoundToggleButton } from "./SoundToggleButton.js";
import { INVENTORY_ITEM_ICON, PowerupInfoSheet, type InventoryItemKind } from "./PowerupInfoSheet.js";
import { formatCount } from "../utils/formatCount.js";

/** Same six items, in the same order, as the in-game tray — revive included (§19 round 8). */
const ITEM_ORDER: readonly InventoryItemKind[] = ["pencil", "eraser", "rocket", "bomb", "fill", "revive"];

/** §19: Continue/New game, Leaderboard, Shop, Settings — a plain list, not the previous button grid. */
export function MainMenu() {
  const { t } = useTranslation();
  const runId = useGameStore((s) => s.runId);
  const gameStatus = useGameStore((s) => s.game.status);
  const inventory = useGameStore((s) => s.inventory);
  const profile = useGameStore((s) => s.profile);
  const newRun = useGameStore((s) => s.newRun);
  const continueRun = useGameStore((s) => s.continueRun);
  const goToLeaderboard = useGameStore((s) => s.goToLeaderboard);
  const goToShop = useGameStore((s) => s.goToShop);
  const goToSettings = useGameStore((s) => s.goToSettings);
  const goToAchievements = useGameStore((s) => s.goToAchievements);
  const actionError = useGameStore((s) => s.actionError);

  const hasActiveRun = runId !== null;
  // Game-over is already the end of the run — nothing left to lose there, so
  // only an in-progress run needs a "are you sure" before New Game discards it.
  const hasUnfinishedRun = hasActiveRun && gameStatus === "playing";
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  const [infoFor, setInfoFor] = useState<InventoryItemKind | null>(null);

  return (
    <div
      className="relative mx-auto flex h-full max-w-[480px] flex-col items-center justify-center gap-3.5"
      style={{
        paddingTop: "calc(24px + var(--nonet-safe-top))",
        paddingRight: "calc(24px + var(--nonet-safe-right))",
        paddingBottom: "calc(24px + var(--nonet-safe-bottom))",
        paddingLeft: "calc(24px + var(--nonet-safe-left))",
      }}
    >
      {/*
        Corner controls. Offset by the same safe-area insets the container
        itself uses, which on Telegram fullscreen already include its own
        chevron/menu strip (§12) — so the top-right button lands below those
        native controls rather than under them, the same problem the in-game
        header had to solve in round 2.
      */}
      <Button
        variant="secondary"
        size="icon"
        className="absolute"
        style={{ top: "calc(10px + var(--nonet-safe-top))", left: "calc(12px + var(--nonet-safe-left))" }}
        aria-label={t("mainMenu.share")}
        onClick={() => {
          hapticSelection();
          shareViaTelegram(
            profile?.bestRun
              ? t("leaderboard.shareText", { score: profile.bestRun.score.toLocaleString() })
              : t("mainMenu.shareInvite"),
          );
        }}
      >
        <Share2 className="h-[18px] w-[18px]" aria-hidden="true" />
      </Button>
      <SoundToggleButton
        className="absolute"
        style={{ top: "calc(10px + var(--nonet-safe-top))", right: "calc(12px + var(--nonet-safe-right))" }}
      />

      <div className="mb-1 text-4xl font-extrabold tracking-[0.12em]">NONET</div>
      {profile?.bestRun && (
        <div className="mb-2 flex flex-col items-center">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("mainMenu.bestScore")}
          </span>
          <span className="text-xl font-bold tabular-nums">{profile.bestRun.score.toLocaleString()}</span>
        </div>
      )}

      {/* Tap (not long-press) opens the description here — unlike the in-game
          tray, nothing on this screen competes for a plain tap (§19 round 8). */}
      <div className="flex justify-center gap-2 p-2">
        {ITEM_ORDER.map((kind) => {
          const Icon = INVENTORY_ITEM_ICON[kind];
          const count = inventory[kind] ?? 0;
          return (
            <button
              key={kind}
              type="button"
              className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg bg-muted p-1.5"
              aria-label={`${t(`inventory.${kind}`)} (${t("inventory.available", { count })})`}
              onClick={() => {
                hapticSelection();
                setInfoFor(kind);
              }}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
              <span className="text-[0.7rem] font-bold text-muted-foreground">
                {formatCount(count, t("common.thousandsSuffix"))}
              </span>
            </button>
          );
        })}
      </div>

      <nav className="mt-1.5 flex w-full max-w-[320px] flex-col gap-2">
        <Button
          size="lg"
          disabled={!hasActiveRun}
          className="justify-start"
          onClick={() => {
            hapticSelection();
            continueRun();
          }}
        >
          <Play className="h-5 w-5" aria-hidden="true" />
          {hasActiveRun && gameStatus === "gameover" ? t("mainMenu.resumeGameOver") : t("mainMenu.continue")}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="justify-start"
          onClick={() => {
            hapticSelection();
            if (hasUnfinishedRun) setConfirmNewGame(true);
            else void newRun();
          }}
        >
          <RotateCcw className="h-5 w-5" aria-hidden="true" />
          {t("mainMenu.newGame")}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="justify-start"
          onClick={() => {
            hapticSelection();
            goToLeaderboard();
          }}
        >
          <Trophy className="h-5 w-5" aria-hidden="true" />
          {t("mainMenu.leaderboard")}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="justify-start"
          onClick={() => {
            hapticSelection();
            goToShop();
          }}
        >
          <Store className="h-5 w-5" aria-hidden="true" />
          {t("mainMenu.shop")}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="justify-start"
          onClick={() => {
            hapticSelection();
            goToAchievements();
          }}
        >
          <Award className="h-5 w-5" aria-hidden="true" />
          {t("mainMenu.achievements")}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="justify-start"
          onClick={() => {
            hapticSelection();
            goToSettings();
          }}
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
          {t("mainMenu.settings")}
        </Button>
      </nav>

      {/* A failed "New game" used to be completely silent (§19 round 9). */}
      {actionError && <p className="mt-1 max-w-[320px] text-center text-sm text-destructive">{t(actionError)}</p>}

      <Dialog open={confirmNewGame} onOpenChange={setConfirmNewGame}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mainMenu.confirmNewGameTitle")}</DialogTitle>
            <DialogDescription>{t("mainMenu.confirmNewGameBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmNewGame(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmNewGame(false);
                hapticSelection();
                void newRun();
              }}
            >
              {t("mainMenu.confirmNewGameConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {infoFor && <PowerupInfoSheet kind={infoFor} onClose={() => setInfoFor(null)} />}
    </div>
  );
}
