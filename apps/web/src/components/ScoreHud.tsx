import { useTranslation } from "react-i18next";
import styles from "./ScoreHud.module.css";

interface ScoreHudProps {
  readonly score: number;
  readonly comboLevel: number;
  readonly comboGraceActive: boolean;
  readonly bestScore: number | null;
}

export function ScoreHud({ score, comboLevel, comboGraceActive, bestScore }: ScoreHudProps) {
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
      <div className={styles.combo} data-grace={comboLevel > 1 && comboGraceActive}>
        {comboLevel > 1 ? t("scoreHud.combo", { level: comboLevel }) : ""}
      </div>
    </div>
  );
}
