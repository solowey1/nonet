import { useEffect, useState, type RefObject } from "react";
import { BOARD_SIZE } from "@nonet/engine";

/** Tracks the board's actual rendered cell size in pixels, so the hand tray and
 * drag layer stay visually consistent with the board's CSS-driven responsive sizing. */
export function useCellSize(boardRef: RefObject<HTMLElement | null>): number {
  const [cellSize, setCellSize] = useState(0);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const update = () => setCellSize(el.getBoundingClientRect().width / BOARD_SIZE);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [boardRef]);

  return cellSize;
}
