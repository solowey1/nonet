import type { Board } from "@nonet/engine";

export interface GhostPreview {
  readonly row: number;
  readonly col: number;
  readonly mask: Board;
  readonly legal: boolean;
  /** Union mask of rows/cols/blocks that would clear if dropped here. */
  readonly highlightMask: Board;
}

export interface DragState {
  readonly slot: 0 | 1 | 2;
  readonly pointerId: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly ghost: GhostPreview | null;
}
