import { useTranslation } from "react-i18next";
import styles from "./ScoreHud.module.css";

interface ScoreHudProps {
  readonly score: number;
  readonly bestScore: number | null;
}

/**
 * Score and best only. The combo readout used to live here too, but it now
 * sits above the power-up row in both orientations (§19 round 8) — in
 * landscape especially, cramming it next to Score/Best in a narrow rail made
 * the two labels collide.
 */
export function ScoreHud({ score, bestScore }: ScoreHudProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.hud}>
      <div className={styles.scores}>
        <div>
          <span className={styles.label}>{t("scoreHud.score")}</span>
          <span className={styles.score}>{score.toLocaleString()}</span>
        </div>
        {bestScore !== null && (
          <div>
            <span className={styles.label}>{t("scoreHud.best")}</span>
            <span className={styles.bestScore}>{bestScore.toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  );
}
