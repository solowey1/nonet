import { useState } from "react";
import type { GameState } from "@nonet/engine";
import type { FinishResult, ReviveOutcome } from "../store/gameStore.js";
import styles from "./GameOverOverlay.module.css";

interface GameOverOverlayProps {
  readonly game: GameState;
  readonly finishResult: FinishResult | null;
  readonly revivePending: boolean;
  readonly onRestart: () => void;
  readonly onBuyRevive: () => Promise<ReviveOutcome>;
}

const REVIVE_HINTS: Record<Exclude<ReviveOutcome, "purchased">, string> = {
  cancelled: "Revive cancelled.",
  pending: "Payment still pending — try again in a moment.",
  failed: "Couldn't start the revive purchase.",
};

// A run isn't actually finished server-side the moment `game.status` flips
// to "gameover" — that only happens once the player leaves this screen (see
// gameStore's `finishRun`), specifically so a revive purchase is still valid
// against this exact run right up until then.
export function GameOverOverlay({ game, finishResult, revivePending, onRestart, onBuyRevive }: GameOverOverlayProps) {
  const [reviveHint, setReviveHint] = useState<string | null>(null);

  const handleRevive = async () => {
    setReviveHint(null);
    const outcome = await onBuyRevive();
    if (outcome !== "purchased") setReviveHint(REVIVE_HINTS[outcome]);
  };

  return (
    <div className={styles.overlay} role="alertdialog" aria-label="Game over">
      <div className={styles.title}>Game Over</div>
      <div className={styles.finalScore}>{game.score.toLocaleString()}</div>
      {/* §9: never a scary error for an unverified run — just no rank, same as any other score. */}
      <div className={styles.rank}>
        {!finishResult && "verifying…"}
        {finishResult?.verified && finishResult.rank && `Rank #${finishResult.rank}`}
      </div>
      <div className={styles.stats}>
        <div>
          Pieces
          <span className={styles.statValue}>{game.piecesPlaced}</span>
        </div>
        <div>
          Best combo
          <span className={styles.statValue}>x{game.maxComboLevel}</span>
        </div>
        <div>
          Perfect clears
          <span className={styles.statValue}>{game.perfectClears}</span>
        </div>
      </div>
      {reviveHint && <div className={styles.reviveHint}>{reviveHint}</div>}
      <div className={styles.actions}>
        <button type="button" className={styles.revive} disabled={revivePending} onClick={() => void handleRevive()}>
          {revivePending ? "…" : "⭐ Revive (30)"}
        </button>
        <button type="button" className={styles.restart} onClick={onRestart}>
          Play again
        </button>
      </div>
    </div>
  );
}
