import styles from "./ScoreHud.module.css";

interface ScoreHudProps {
  readonly score: number;
  readonly comboLevel: number;
}

export function ScoreHud({ score, comboLevel }: ScoreHudProps) {
  return (
    <div className={styles.hud}>
      <div>
        <span className={styles.label}>Score</span>
        <span className={styles.score}>{score.toLocaleString()}</span>
      </div>
      <div className={styles.combo}>{comboLevel > 1 ? `combo x${comboLevel}` : ""}</div>
    </div>
  );
}
