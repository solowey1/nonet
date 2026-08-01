import { useCallback, useState, type RefObject } from "react";
import type { PowerupKind } from "@nonet/shared";
import { useGameStore } from "../store/gameStore.js";
import { BOARD_SIZE, clamp, pointToFractionalCell } from "../utils/geometry.js";
import { computeTargetPreview, type PowerupPreview } from "../utils/powerupPreview.js";

export interface TargetingState {
  readonly kind: PowerupKind;
  readonly preview: PowerupPreview;
}

/**
 * Press-drag-release targeting for the four board-based power-ups (§7):
 * pencil/eraser/bomb/fill all "tap a cell, see a preview, release to
 * confirm" — only what the preview computes (pencil's single cell vs bomb's
 * cross vs fill's flood-filled region) differs. Rocket is a different
 * interaction entirely (gutter taps) — see RocketGutters.
 */
export function usePowerupTargeting(boardRef: RefObject<HTMLDivElement | null>) {
  const [targeting, setTargeting] = useState<TargetingState | null>(null);

  const beginTargeting = useCallback(
    (kind: Exclude<PowerupKind, "rocket">, pointerId: number, clientX: number, clientY: number) => {
      function computeAt(x: number, y: number): { preview: PowerupPreview; row: number; col: number } | null {
        const boardEl = boardRef.current;
        if (!boardEl) return null;
        const board = useGameStore.getState().game.board;
        const rect = boardEl.getBoundingClientRect();
        const { row: fRow, col: fCol } = pointToFractionalCell(rect, x, y);
        const row = Math.floor(clamp(fRow, 0, BOARD_SIZE - 1));
        const col = Math.floor(clamp(fCol, 0, BOARD_SIZE - 1));
        return { preview: computeTargetPreview(board, kind, row, col), row, col };
      }

      function cleanup() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      }

      function onMove(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        const result = computeAt(event.clientX, event.clientY);
        setTargeting(result ? { kind, preview: result.preview } : null);
      }

      async function commit(x: number, y: number) {
        const result = computeAt(x, y);
        setTargeting(null);
        if (!result || !result.preview.valid) return;
        const { row, col } = result; // the actual tapped cell — NOT preview.cells[0] (e.g. bomb's cross starts elsewhere)
        const store = useGameStore.getState();
        if (kind === "pencil") await store.applyPencil(row, col);
        else if (kind === "eraser") await store.applyEraser(row, col);
        else if (kind === "bomb") await store.applyBomb(row, col);
        else if (kind === "fill") await store.applyFillPowerup(row, col);
      }

      function onUp(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        cleanup();
        void commit(event.clientX, event.clientY);
      }

      function onCancel(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        cleanup();
        setTargeting(null);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      const initial = computeAt(clientX, clientY);
      setTargeting(initial ? { kind, preview: initial.preview } : null);
    },
    [boardRef],
  );

  return { targeting, beginTargeting };
}
