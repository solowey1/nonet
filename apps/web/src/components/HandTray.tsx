import type { Hand } from "@nonet/engine";
import { PieceView } from "./PieceView.js";
import { pieceFamily } from "../utils/pieceFamily.js";
import styles from "./HandTray.module.css";

const TRAY_SCALE = 0.7;

interface HandTrayProps {
  readonly hand: Hand;
  readonly cellSize: number;
  readonly draggingSlot: 0 | 1 | 2 | null;
  readonly onGrab: (slot: 0 | 1 | 2, pointerId: number, clientX: number, clientY: number) => void;
}

export function HandTray({ hand, cellSize, draggingSlot, onGrab }: HandTrayProps) {
  const traySlotCell = cellSize * TRAY_SCALE;

  return (
    <div className={styles.tray}>
      {([0, 1, 2] as const).map((slot) => {
        const piece = hand[slot];
        return (
          <div
            key={slot}
            className={styles.slot}
            data-empty={!piece}
            data-dragging={draggingSlot === slot}
            role="button"
            aria-label={piece ? `piece ${piece.id}, tap and drag to place` : undefined}
            onPointerDown={(event) => {
              if (!piece) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              onGrab(slot, event.pointerId, event.clientX, event.clientY);
            }}
          >
            {piece && <PieceView piece={piece} cellSize={traySlotCell} family={pieceFamily(piece.cells.length)} />}
          </div>
        );
      })}
    </div>
  );
}
