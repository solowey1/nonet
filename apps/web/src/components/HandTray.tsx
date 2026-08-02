import { useTranslation } from "react-i18next";
import { PIECE_CATALOGUE, type Hand } from "@nonet/engine";
import { PieceView } from "./PieceView.js";
import { pieceFamily } from "../utils/pieceFamily.js";
import styles from "./HandTray.module.css";

const TRAY_SCALE = 0.7;

// PieceView sizes its root to the actual piece (w/h in cells), so a slot's
// rendered height varies with whichever piece is currently dealt into it —
// left unreserved, the tray's own height (and everything below/above it in
// the column layout, i.e. the board) shifts every time the hand changes.
// Reserving the tallest possible piece's height up front keeps the tray a
// fixed size regardless of hand contents.
const MAX_PIECE_DIM = Math.max(...PIECE_CATALOGUE.map((p) => Math.max(p.w, p.h)));

interface HandTrayProps {
  readonly hand: Hand;
  readonly cellSize: number;
  readonly draggingSlot: 0 | 1 | 2 | null;
  readonly onGrab: (slot: 0 | 1 | 2, pointerId: number, clientX: number, clientY: number) => void;
}

export function HandTray({ hand, cellSize, draggingSlot, onGrab }: HandTrayProps) {
  const { t } = useTranslation();
  const traySlotCell = cellSize * TRAY_SCALE;
  // Reserves whichever axis actually varies per hand: height in portrait's
  // row layout, width in landscape's column layout (see HandTray.module.css)
  // — both read the same number, so it's exposed as one custom property
  // rather than computed twice.
  const trayReserve = Math.max(44, traySlotCell * MAX_PIECE_DIM);

  return (
    <div
      className={styles.tray}
      style={{ minHeight: trayReserve, ["--nonet-tray-reserve" as string]: `${trayReserve}px` }}
    >
      {([0, 1, 2] as const).map((slot) => {
        const piece = hand[slot];
        return (
          <div key={slot} className={styles.slot} data-empty={!piece} data-dragging={draggingSlot === slot}>
            {piece && <PieceView piece={piece} cellSize={traySlotCell} family={pieceFamily(piece.cells.length)} />}
            {/*
              A separate, absolutely-centered hit-area rather than sizing
              `.slot` itself to `trayReserve`: the *visible* piece stays its
              natural size (a 1-cell piece still looks small), but every
              piece gets the same generous 5x5-cell-equivalent grab target
              regardless of shape — without blowing out the tray's flex
              layout width (3 slots literally sized to the largest piece's
              footprint wouldn't fit side by side on a narrow phone) (§19).
            */}
            {piece && (
              <div
                className={styles.hitArea}
                style={{ width: trayReserve, height: trayReserve }}
                role="button"
                aria-label={t("game.grabPiece", { id: piece.id })}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onGrab(slot, event.pointerId, event.clientX, event.clientY);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
