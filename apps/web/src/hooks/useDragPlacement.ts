import { useCallback, useState, type RefObject } from "react";
import { canPlace, detectFullUnits, placePiece, unitsMask } from "@nonet/engine";
import { useGameStore } from "../store/gameStore.js";
import { hapticNotification } from "../telegram/webapp.js";
import { BOARD_SIZE, clamp, pointToFractionalCell } from "../utils/geometry.js";
import type { DragState, GhostPreview } from "../types.js";

/**
 * Pointer-events based drag from the hand tray onto the board (no native HTML5
 * DnD — it doesn't play well with touch). Reads/writes the store via
 * `getState()` inside the drag-session closures rather than through the hook,
 * so a single continuous gesture never operates on a stale `game` snapshot.
 */
export function useDragPlacement(boardRef: RefObject<HTMLDivElement | null>) {
  const [drag, setDrag] = useState<DragState | null>(null);

  const beginDrag = useCallback(
    (slot: 0 | 1 | 2, pointerId: number, clientX: number, clientY: number) => {
      const { game } = useGameStore.getState();
      if (game.status === "gameover" || !game.hand[slot]) return;

      function computeGhost(x: number, y: number): GhostPreview | null {
        const boardEl = boardRef.current;
        const current = useGameStore.getState().game;
        const piece = current.hand[slot];
        if (!boardEl || !piece) return null;

        const rect = boardEl.getBoundingClientRect();
        const { row: fRow, col: fCol } = pointToFractionalCell(rect, x, y);
        const row = clamp(Math.round(fRow - piece.h / 2), 0, BOARD_SIZE - piece.h);
        const col = clamp(Math.round(fCol - piece.w / 2), 0, BOARD_SIZE - piece.w);
        const legal = canPlace(current.board, piece, row, col);

        let mask = 0n;
        let highlightMask = 0n;
        if (legal) {
          const placed = placePiece(current.board, piece, row, col);
          mask = placed & ~current.board;
          highlightMask = unitsMask(detectFullUnits(placed));
        } else {
          for (const [dr, dc] of piece.cells) {
            const r = row + dr;
            const c = col + dc;
            if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) mask |= 1n << BigInt(r * BOARD_SIZE + c);
          }
        }
        return { row, col, mask, legal, highlightMask };
      }

      function cleanup() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      }

      function onMove(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        setDrag({ slot, pointerId, pointerX: event.clientX, pointerY: event.clientY, ghost: computeGhost(event.clientX, event.clientY) });
      }

      function onUp(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        cleanup();
        const ghost = computeGhost(event.clientX, event.clientY);
        if (ghost?.legal) {
          useGameStore.getState().place(slot, ghost.row, ghost.col);
        } else {
          hapticNotification("error");
        }
        setDrag(null);
      }

      function onCancel(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        cleanup();
        setDrag(null);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      setDrag({ slot, pointerId, pointerX: clientX, pointerY: clientY, ghost: computeGhost(clientX, clientY) });
    },
    [boardRef],
  );

  return { drag, beginDrag };
}
