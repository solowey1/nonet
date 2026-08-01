import type { Piece } from "@nonet/engine";
import styles from "./PieceView.module.css";

interface PieceViewProps {
  readonly piece: Piece;
  readonly cellSize: number;
  readonly family: number;
  readonly gap?: number;
}

export function PieceView({ piece, cellSize, family, gap = 2 }: PieceViewProps) {
  const inner = cellSize - gap;
  return (
    <div
      className={styles.piece}
      style={{ width: piece.w * cellSize, height: piece.h * cellSize }}
      aria-hidden="true"
    >
      {piece.cells.map(([dr, dc]) => (
        <div
          key={`${dr}-${dc}`}
          className={styles.cell}
          style={{
            width: inner,
            height: inner,
            left: dc * cellSize + gap / 2,
            top: dr * cellSize + gap / 2,
            ["--piece-color" as string]: `var(--nonet-piece-${family})`,
          }}
        />
      ))}
    </div>
  );
}
