import type { Piece } from "@nonet/engine";
import type { DragState } from "../types.js";
import { pieceFamily } from "../utils/pieceFamily.js";
import { PieceView } from "./PieceView.js";
import styles from "./DragLayer.module.css";

interface DragLayerProps {
  readonly drag: DragState | null;
  readonly piece: Piece | null;
  readonly cellSize: number;
}

export function DragLayer({ drag, piece, cellSize }: DragLayerProps) {
  if (!drag || !piece) return null;

  const width = piece.w * cellSize;
  const height = piece.h * cellSize;
  const x = drag.pointerX - width / 2;
  const y = drag.pointerY - height / 2;

  return (
    <div className={styles.floating} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <div className={styles.pickupInner}>
        <PieceView piece={piece} cellSize={cellSize} family={pieceFamily(piece.cells.length)} />
      </div>
    </div>
  );
}
