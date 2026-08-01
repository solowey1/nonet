import type { GameState } from "@nonet/engine";
import styles from "./GameOverOverlay.module.css";

interface GameOverOverlayProps {
  readonly game: GameState;
  readonly onRestart: () => void;
}

export function GameOverOverlay({ game, onRestart }: GameOverOverlayProps) {
  return (
    <div className={styles.overlay} role="alertdialog" aria-label="Game over">
      <div className={styles.title}>Game Over</div>
      <div className={styles.finalScore}>{game.score.toLocaleString()}</div>
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
      <button type="button" className={styles.restart} onClick={onRestart}>
        Play again
      </button>
    </div>
  );
}
