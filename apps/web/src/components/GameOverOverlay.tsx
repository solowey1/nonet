import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Heart, Share2, Star } from "lucide-react";
import type { GameState } from "@nonet/engine";
import type { FinishResult, ReviveOutcome } from "../store/gameStore.js";
import { hapticSelection, shareViaTelegram } from "../telegram/webapp.js";
import { Button } from "@/components/ui/button";

interface GameOverOverlayProps {
  readonly game: GameState;
  readonly finishResult: FinishResult | null;
  readonly revivePending: boolean;
  readonly hasStockedRevive: boolean;
  readonly onRestart: () => void;
  readonly onBuyRevive: () => Promise<ReviveOutcome>;
}

const REVIVE_HINT_KEYS: Record<Exclude<ReviveOutcome, "purchased">, string> = {
  cancelled: "gameOver.reviveCancelled",
  pending: "gameOver.revivePending",
  failed: "gameOver.reviveFailed",
};

// A run isn't actually finished server-side the moment `game.status` flips
// to "gameover" — that only happens once the player leaves this screen (see
// gameStore's `finishRun`), specifically so a revive purchase is still valid
// against this exact run right up until then.
export function GameOverOverlay({ game, finishResult, revivePending, hasStockedRevive, onRestart, onBuyRevive }: GameOverOverlayProps) {
  const { t } = useTranslation();
  const [reviveHint, setReviveHint] = useState<string | null>(null);

  const handleRevive = async () => {
    setReviveHint(null);
    const outcome = await onBuyRevive();
    if (outcome !== "purchased") setReviveHint(t(REVIVE_HINT_KEYS[outcome]));
  };

  return (
    <div
      className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-3 rounded-lg backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--nonet-bg) 85%, transparent)" }}
      role="alertdialog"
      aria-label={t("gameOver.title")}
    >
      <div className="text-lg uppercase tracking-wide text-destructive">{t("gameOver.title")}</div>
      <div className="text-4xl font-bold tabular-nums">{game.score.toLocaleString()}</div>
      {/* §9: never a scary error for an unverified run — just no rank, same as any other score. */}
      <div className="min-h-[1.1em] text-sm text-muted-foreground">
        {!finishResult && t("gameOver.verifying")}
        {finishResult?.verified && finishResult.rank && t("gameOver.rank", { rank: finishResult.rank })}
      </div>
      <div className="mb-2 flex gap-5 text-sm text-muted-foreground">
        <div>
          {t("gameOver.pieces")}
          <span className="block text-base font-semibold text-foreground">{game.piecesPlaced}</span>
        </div>
        <div>
          {t("gameOver.bestCombo")}
          <span className="block text-base font-semibold text-foreground">x{game.maxComboLevel}</span>
        </div>
        <div>
          {t("gameOver.perfectClears")}
          <span className="block text-base font-semibold text-foreground">{game.perfectClears}</span>
        </div>
      </div>
      {/*
        Unlocked achievements used to be listed right here — a good run could
        stack six lines and shove the buttons off-screen. They now announce
        themselves in the bottom toast stack instead (AchievementToasts,
        §19 round 9), so this card's height no longer depends on how well the
        player did.
      */}
      {reviveHint && <div className="min-h-[1.1em] text-sm text-muted-foreground">{reviveHint}</div>}
      <div className="flex gap-2.5">
        <Button variant="outline" size="lg" disabled={revivePending} onClick={() => void handleRevive()}>
          {revivePending ? (
            "…"
          ) : hasStockedRevive ? (
            <>
              <Heart className="h-4 w-4" aria-hidden="true" /> {t("gameOver.reviveFree")}
            </>
          ) : (
            <>
              <Star className="h-4 w-4" fill="#FFC335" stroke="#E98615" aria-hidden="true" /> {t("gameOver.revive")}
            </>
          )}
        </Button>
        <Button size="lg" onClick={onRestart}>
          {t("gameOver.playAgain")}
        </Button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 text-muted-foreground"
        onClick={() => {
          hapticSelection();
          shareViaTelegram(t("gameOver.shareText", { score: game.score.toLocaleString() }));
        }}
      >
        <Share2 className="h-4 w-4" aria-hidden="true" /> {t("gameOver.share")}
      </Button>
    </div>
  );
}
