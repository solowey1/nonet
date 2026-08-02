import type { RefObject } from "react";
import { BOARD_SIZE } from "@nonet/engine";
import { POWERUP_ICON } from "../utils/powerupIcon.js";
import styles from "./RocketGutters.module.css";

const RocketIcon = POWERUP_ICON.rocket;

const GUTTER_THICKNESS = 26;
const GUTTER_GAP = 4;

interface RocketGuttersProps {
  readonly boardRef: RefObject<HTMLDivElement | null>;
  readonly visible: boolean;
  readonly onFire: (orientation: "row" | "col", index: number) => void;
}

/** 36 gutter slots around the board — 9 per side (§7): tap a side slot to fire that row/column. */
export function RocketGutters({ boardRef, visible, onFire }: RocketGuttersProps) {
  if (!visible) return null;
  const rect = boardRef.current?.getBoundingClientRect();
  if (!rect) return null;

  const cellSize = rect.width / BOARD_SIZE;
  const slots = [];

  for (let i = 0; i < BOARD_SIZE; i++) {
    // top / bottom -> fire column i
    slots.push({
      key: `top-${i}`,
      x: rect.left + i * cellSize,
      y: rect.top - GUTTER_THICKNESS - GUTTER_GAP,
      w: cellSize,
      h: GUTTER_THICKNESS,
      fire: () => onFire("col", i),
    });
    slots.push({
      key: `bottom-${i}`,
      x: rect.left + i * cellSize,
      y: rect.bottom + GUTTER_GAP,
      w: cellSize,
      h: GUTTER_THICKNESS,
      fire: () => onFire("col", i),
    });
    // left / right -> fire row i
    slots.push({
      key: `left-${i}`,
      x: rect.left - GUTTER_THICKNESS - GUTTER_GAP,
      y: rect.top + i * cellSize,
      w: GUTTER_THICKNESS,
      h: cellSize,
      fire: () => onFire("row", i),
    });
    slots.push({
      key: `right-${i}`,
      x: rect.right + GUTTER_GAP,
      y: rect.top + i * cellSize,
      w: GUTTER_THICKNESS,
      h: cellSize,
      fire: () => onFire("row", i),
    });
  }

  return (
    <>
      {slots.map((slot) => (
        <button
          key={slot.key}
          type="button"
          className={styles.slot}
          style={{ transform: `translate(${slot.x}px, ${slot.y}px)`, width: slot.w, height: slot.h }}
          onClick={slot.fire}
          aria-label="fire rocket"
        >
          <RocketIcon aria-hidden="true" size={14} />
        </button>
      ))}
    </>
  );
}
