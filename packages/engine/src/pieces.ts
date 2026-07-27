/**
 * Piece catalogue (§4). Every piece is normalised so the top-left of its
 * bounding box is (0,0); `[row, col]` pairs. No rotation happens at runtime —
 * each orientation is its own catalogue entry.
 *
 * Weights are hand-tuned, roughly inverse to cell count, with `O3` and the
 * two 5-cell lines made distinctly rare per §4. This table is the only thing
 * that should need editing to retune drop feel — the dealer logic in
 * deal.ts never hardcodes an id.
 */

export type Cell = readonly [row: number, col: number];

export interface Piece {
  readonly id: string;
  readonly cells: readonly Cell[];
  readonly w: number;
  readonly h: number;
  readonly weight: number;
}

function piece(id: string, cells: Cell[], weight: number): Piece {
  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of cells) {
    if (r < 0 || c < 0) throw new Error(`piece ${id}: cell coordinates must be >= 0`);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  const frozen = cells.map((cell) => Object.freeze(cell) as Cell);
  return Object.freeze({ id, cells: Object.freeze(frozen), w: maxC + 1, h: maxR + 1, weight });
}

export const PIECE_CATALOGUE: readonly Piece[] = Object.freeze([
  // --- Dot (1 cell) ---
  piece("DOT", [[0, 0]], 40),

  // --- Lines (2, 3, 4, 5 cells) ---
  piece("I2H", [[0, 0], [0, 1]], 30),
  piece("I2V", [[0, 0], [1, 0]], 30),
  piece("I3H", [[0, 0], [0, 1], [0, 2]], 22),
  piece("I3V", [[0, 0], [1, 0], [2, 0]], 22),
  piece("I4H", [[0, 0], [0, 1], [0, 2], [0, 3]], 14),
  piece("I4V", [[0, 0], [1, 0], [2, 0], [3, 0]], 14),
  piece("I5H", [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], 3),
  piece("I5V", [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 3),

  // --- Squares ---
  piece("O2", [[0, 0], [0, 1], [1, 0], [1, 1]], 14),
  piece(
    "O3",
    [
      [0, 0], [0, 1], [0, 2],
      [1, 0], [1, 1], [1, 2],
      [2, 0], [2, 1], [2, 2],
    ],
    3,
  ),

  // --- Small corners (3 cells, 2x2 bounding box) ---
  // Named by the "elbow" — the cell adjacent to both other cells.
  piece("L3_NW", [[0, 0], [0, 1], [1, 0]], 22), // elbow top-left
  piece("L3_NE", [[0, 0], [0, 1], [1, 1]], 22), // elbow top-right
  piece("L3_SW", [[0, 0], [1, 0], [1, 1]], 22), // elbow bottom-left
  piece("L3_SE", [[0, 1], [1, 0], [1, 1]], 22), // elbow bottom-right

  // --- Big corners (5 cells, 3x3 bounding box: two 3-arms sharing the elbow) ---
  piece("L5_NW", [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], 8),
  piece("L5_NE", [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], 8),
  piece("L5_SW", [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], 8),
  piece("L5_SE", [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]], 8),

  // --- L-tetromino (4 rotations, no mirroring) ---
  piece("L4_0", [[0, 0], [1, 0], [2, 0], [2, 1]], 14),
  piece("L4_1", [[0, 0], [0, 1], [0, 2], [1, 0]], 14),
  piece("L4_2", [[0, 0], [0, 1], [1, 1], [2, 1]], 14),
  piece("L4_3", [[0, 2], [1, 0], [1, 1], [1, 2]], 14),

  // --- J-tetromino (mirror of L, 4 rotations) ---
  piece("J4_0", [[0, 1], [1, 1], [2, 0], [2, 1]], 14),
  piece("J4_1", [[0, 0], [1, 0], [1, 1], [1, 2]], 14),
  piece("J4_2", [[0, 0], [0, 1], [1, 0], [2, 0]], 14),
  piece("J4_3", [[0, 0], [0, 1], [0, 2], [1, 2]], 14),

  // --- T-tetromino (4 rotations) ---
  piece("T4_0", [[0, 0], [0, 1], [0, 2], [1, 1]], 14),
  piece("T4_1", [[0, 1], [1, 0], [1, 1], [2, 1]], 14),
  piece("T4_2", [[0, 1], [1, 0], [1, 1], [1, 2]], 14),
  piece("T4_3", [[0, 0], [1, 0], [1, 1], [2, 0]], 14),

  // --- S / Z (only 2 distinct orientations each) ---
  piece("S_H", [[0, 1], [0, 2], [1, 0], [1, 1]], 14),
  piece("S_V", [[0, 0], [1, 0], [1, 1], [2, 1]], 14),
  piece("Z_H", [[0, 0], [0, 1], [1, 1], [1, 2]], 14),
  piece("Z_V", [[0, 1], [1, 0], [1, 1], [2, 0]], 14),

  // --- Diagonals (disconnected cells; genre-standard difficulty spice) ---
  piece("D2_A", [[0, 0], [1, 1]], 30),
  piece("D2_B", [[0, 1], [1, 0]], 30),
  piece("D3_A", [[0, 0], [1, 1], [2, 2]], 8),
  piece("D3_B", [[0, 2], [1, 1], [2, 0]], 8),
]);

export const PIECE_BY_ID: ReadonlyMap<string, Piece> = new Map(
  PIECE_CATALOGUE.map((p) => [p.id, p]),
);

export function getPiece(id: string): Piece {
  const p = PIECE_BY_ID.get(id);
  if (!p) throw new Error(`unknown piece id: ${id}`);
  return p;
}

export function cellCount(p: Piece): number {
  return p.cells.length;
}

export const LARGE_PIECE_CELL_THRESHOLD = 5;

export function isLargePiece(p: Piece): boolean {
  return cellCount(p) >= LARGE_PIECE_CELL_THRESHOLD;
}
