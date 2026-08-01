/** cell-count -> --nonet-piece-N family, per §15 ("colour by cell-count family, held constant across the run"). */
export function pieceFamily(cellCount: number): number {
  return Math.min(cellCount, 5);
}
