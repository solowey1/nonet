import { useLayoutEffect, useRef, useState } from "react";
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

  const slotRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);
  // A uniform trayReserve square is bigger than the real spacing between
  // slots on narrow phones, so left uncapped, neighbouring hit-areas overlap
  // and steal each other's taps (§19 round 4). Measure each slot's actual
  // distance to its neighbours and cap the hit-area there, so it's as
  // generous as trayReserve allows without ever overlapping the next one.
  const [hitSizes, setHitSizes] = useState<[number, number, number]>([trayReserve, trayReserve, trayReserve]);

  useLayoutEffect(() => {
    const measure = () => {
      const rects = slotRefs.current.map((el) => el?.getBoundingClientRect() ?? null);
      const centers = rects.map((r) => (r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null));
      const next = centers.map((center, i) => {
        if (!center) return trayReserve;
        let safe = trayReserve;
        for (const j of [i - 1, i + 1]) {
          const other = centers[j];
          if (!other) continue;
          safe = Math.min(safe, Math.hypot(center.x - other.x, center.y - other.y));
        }
        return safe;
      }) as [number, number, number];
      setHitSizes(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    for (const el of slotRefs.current) if (el) observer.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
    // Re-measure whenever the dealt hand (piece sizes) or the reserved size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand, trayReserve]);

  return (
    <div
      className={styles.tray}
      style={{ minHeight: trayReserve, ["--nonet-tray-reserve" as string]: `${trayReserve}px` }}
    >
      {([0, 1, 2] as const).map((slot) => {
        const piece = hand[slot];
        return (
          <div
            key={slot}
            ref={(el) => {
              slotRefs.current[slot] = el;
            }}
            className={styles.slot}
            data-empty={!piece}
            data-dragging={draggingSlot === slot}
          >
            {piece && <PieceView piece={piece} cellSize={traySlotCell} family={pieceFamily(piece.cells.length)} />}
            {/*
              A separate, absolutely-centered hit-area rather than sizing
              `.slot` itself to `trayReserve`: the *visible* piece stays its
              natural size (a 1-cell piece still looks small), but every
              piece gets the same generous grab target regardless of shape —
              without blowing out the tray's flex layout width (3 slots
              literally sized to the largest piece's footprint wouldn't fit
              side by side on a narrow phone) (§19). `hitSizes[slot]` clamps
              that target so it never overlaps a neighbouring slot's own.
            */}
            {piece && (
              <div
                className={styles.hitArea}
                style={{ width: hitSizes[slot], height: hitSizes[slot] }}
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
