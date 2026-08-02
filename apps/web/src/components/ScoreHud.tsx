import styles from "./ScoreHud.module.css";

interface ScoreHudProps {
  readonly score: number;
  readonly comboLevel: number;
  readonly bestScore: number | null;
}

export function ScoreHud({ score, comboLevel, bestScore }: ScoreHudProps) {
  return (
    <div className={styles.hud}>
      <div className={styles.scores}>
        <div>
          <span className={styles.label}>Score</span>
          <span className={styles.score}>{score.toLocaleString()}</span>
        </div>
        {bestScore !== null && (
          <div>
            <span className={styles.label}>Best</span>
            <span className={styles.bestScore}>{bestScore.toLocaleString()}</span>
          </div>
        )}
      </div>
      <div className={styles.combo}>{comboLevel > 1 ? `combo x${comboLevel}` : ""}</div>
    </div>
  );
}
