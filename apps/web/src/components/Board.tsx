import { forwardRef, useEffect, useState } from "react";
import { BOARD_SIZE, type Board as BoardBits } from "@nonet/engine";
import type { ClearEvent } from "../store/gameStore.js";
import type { GhostPreview } from "../types.js";
import { maskToCells } from "../utils/bitmask.js";
import styles from "./Board.module.css";

interface BoardProps {
  readonly board: BoardBits;
  readonly cellFamilies: Uint8Array;
  readonly ghost: GhostPreview | null;
  readonly clearEvent: ClearEvent | null;
}

const CLEAR_STAGGER_MS = 12;
const CLEAR_ANIM_MS = 260;

interface ClearingCell {
  readonly delayMs: number;
}

function isBitSet(mask: BoardBits, index: number): boolean {
  return (mask & (1n << BigInt(index))) !== 0n;
}

export const Board = forwardRef<HTMLDivElement, BoardProps>(function Board(
  { board, cellFamilies, ghost, clearEvent },
  ref,
) {
  const [clearing, setClearing] = useState<Map<number, ClearingCell> | null>(null);

  useEffect(() => {
    if (!clearEvent) return;
    const cells = maskToCells(clearEvent.clearedMask);
    const map = new Map<number, ClearingCell>();
    let maxDelay = 0;
    for (const { row, col, index } of cells) {
      const distance = Math.max(Math.abs(row - clearEvent.originRow), Math.abs(col - clearEvent.originCol));
      const delayMs = distance * CLEAR_STAGGER_MS;
      maxDelay = Math.max(maxDelay, delayMs);
      map.set(index, { delayMs });
    }
    setClearing(map);
    const timer = setTimeout(() => setClearing(null), maxDelay + CLEAR_ANIM_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearEvent?.key]);

  const cells = [];
  for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index++) {
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    const isClearing = clearing?.get(index);
    const filled = isBitSet(board, index) || Boolean(isClearing);
    const family = cellFamilies[index] || 0;
    const inGhost = ghost !== null && isBitSet(ghost.mask, index);
    const wouldClear = ghost !== null && ghost.legal && isBitSet(ghost.highlightMask, index);

    let ghostState: "legal" | "illegal" | undefined;
    if (inGhost) ghostState = ghost?.legal ? "legal" : "illegal";

    cells.push(
      <div
        key={index}
        className={styles.cell}
        data-border-right={col % 3 === 2 && col !== BOARD_SIZE - 1}
        data-border-bottom={row % 3 === 2 && row !== BOARD_SIZE - 1}
      >
        <div
          className={styles.cellInner}
          data-filled={filled}
          data-ghost={ghostState}
          data-would-clear={wouldClear}
          data-clearing={Boolean(isClearing)}
          style={{
            ["--piece-color" as string]: family ? `var(--nonet-piece-${family})` : undefined,
            ["--clear-delay" as string]: isClearing ? `${isClearing.delayMs}ms` : undefined,
          }}
        />
      </div>,
    );
  }

  return (
    <div ref={ref} className={styles.board} role="grid" aria-label="NONET board">
      {cells}
    </div>
  );
});
