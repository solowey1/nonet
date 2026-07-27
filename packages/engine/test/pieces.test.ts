import { describe, expect, it } from "vitest";
import { LARGE_PIECE_CELL_THRESHOLD, PIECE_CATALOGUE, cellCount, getPiece, isLargePiece } from "../src/pieces.js";

describe("piece catalogue", () => {
  it("has unique ids", () => {
    const ids = PIECE_CATALOGUE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has roughly ~40 entries", () => {
    expect(PIECE_CATALOGUE.length).toBeGreaterThanOrEqual(35);
    expect(PIECE_CATALOGUE.length).toBeLessThanOrEqual(45);
  });

  it("every piece is normalised: min row and min col are 0", () => {
    for (const p of PIECE_CATALOGUE) {
      const minR = Math.min(...p.cells.map(([r]) => r));
      const minC = Math.min(...p.cells.map(([, c]) => c));
      expect(minR, `${p.id} min row`).toBe(0);
      expect(minC, `${p.id} min col`).toBe(0);
    }
  });

  it("w/h match the actual bounding box of cells", () => {
    for (const p of PIECE_CATALOGUE) {
      const maxR = Math.max(...p.cells.map(([r]) => r));
      const maxC = Math.max(...p.cells.map(([, c]) => c));
      expect(p.h, `${p.id} h`).toBe(maxR + 1);
      expect(p.w, `${p.id} w`).toBe(maxC + 1);
    }
  });

  it("has no duplicate cells within a single piece", () => {
    for (const p of PIECE_CATALOGUE) {
      const keys = p.cells.map(([r, c]) => `${r},${c}`);
      expect(new Set(keys).size, `${p.id} duplicate cells`).toBe(keys.length);
    }
  });

  it("all weights are positive", () => {
    for (const p of PIECE_CATALOGUE) {
      expect(p.weight, `${p.id} weight`).toBeGreaterThan(0);
    }
  });

  it("O3 and the 5-cell lines are distinctly rare", () => {
    const o3 = getPiece("O3");
    const i5h = getPiece("I5H");
    const i5v = getPiece("I5V");
    const median = [...PIECE_CATALOGUE].map((p) => p.weight).sort((a, b) => a - b)[
      Math.floor(PIECE_CATALOGUE.length / 2)
    ] as number;
    expect(o3.weight).toBeLessThan(median);
    expect(i5h.weight).toBeLessThan(median);
    expect(i5v.weight).toBeLessThan(median);
  });

  it("getPiece throws for unknown ids", () => {
    expect(() => getPiece("NOT_A_PIECE")).toThrow();
  });

  it("isLargePiece matches the >=5 cell threshold", () => {
    for (const p of PIECE_CATALOGUE) {
      expect(isLargePiece(p)).toBe(cellCount(p) >= LARGE_PIECE_CELL_THRESHOLD);
    }
  });

  it("fits within the 9x9 board (w,h <= 9)", () => {
    for (const p of PIECE_CATALOGUE) {
      expect(p.w).toBeLessThanOrEqual(9);
      expect(p.h).toBeLessThanOrEqual(9);
    }
  });
});
