import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { ClearEvent } from "../store/gameStore.js";
import styles from "./ComboPopup.module.css";

const POPUP_DURATION_MS = 700;

interface ComboPopupProps {
  readonly clearEvent: ClearEvent | null;
  readonly boardRef: RefObject<HTMLDivElement | null>;
}

/** A floating, scaling number near the last placement (§15). */
export function ComboPopup({ clearEvent, boardRef }: ComboPopupProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!clearEvent) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), POPUP_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearEvent?.key]);

  if (!visible || !clearEvent) return null;
  const boardEl = boardRef.current;
  if (!boardEl) return null;

  const rect = boardEl.getBoundingClientRect();
  const cellSize = rect.width / 9;
  const x = rect.left + (clearEvent.originCol + 0.5) * cellSize;
  const y = rect.top + clearEvent.originRow * cellSize;

  return (
    <div key={clearEvent.key} className={styles.popup} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <span className={styles.score}>+{clearEvent.turnScore}</span>
      {clearEvent.comboLevel > 1 && (
        <span className={styles.combo}>{t("scoreHud.combo", { level: clearEvent.comboLevel })}</span>
      )}
      {clearEvent.isPerfectClear && <span className={styles.combo}>{t("game.perfectClear")}</span>}
    </div>
  );
}
