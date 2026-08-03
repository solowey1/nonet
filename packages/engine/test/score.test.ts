import { describe, expect, it } from "vitest";
import {
  PERFECT_CLEAR_BONUS,
  clearBaseScore,
  comboMultiplierX10,
  nextCombo,
  scorePlacement,
  scorePowerupClear,
} from "../src/score.js";

describe("clearBaseScore", () => {
  it("matches the documented table for the placement (18) constant", () => {
    expect(clearBaseScore(1, 18)).toBe(18);
    expect(clearBaseScore(2, 18)).toBe(54);
    expect(clearBaseScore(3, 18)).toBe(108);
    expect(clearBaseScore(4, 18)).toBe(180);
    expect(clearBaseScore(5, 18)).toBe(270);
  });

  it("is 0 for zero units cleared", () => {
    expect(clearBaseScore(0, 18)).toBe(0);
  });
});

describe("comboMultiplierX10", () => {
  it("ramps from x1.0 to x5.0 and caps there", () => {
    expect(comboMultiplierX10(1)).toBe(10);
    expect(comboMultiplierX10(2)).toBe(15);
    expect(comboMultiplierX10(3)).toBe(20);
    expect(comboMultiplierX10(9)).toBe(50);
    expect(comboMultiplierX10(10)).toBe(50);
    expect(comboMultiplierX10(100)).toBe(50);
  });

  it("treats level 0 (or negative) as a neutral x1.0 floor", () => {
    expect(comboMultiplierX10(0)).toBe(10);
    expect(comboMultiplierX10(-5)).toBe(10);
  });
});

describe("nextCombo", () => {
  it("increments by the number of units cleared, not a flat +1", () => {
    expect(nextCombo({ comboLevel: 0, comboGraceActive: false }, 1)).toEqual({
      comboLevel: 1,
      comboGraceActive: false,
    });
    expect(nextCombo({ comboLevel: 3, comboGraceActive: false }, 2)).toEqual({
      comboLevel: 5,
      comboGraceActive: false,
    });
  });

  it("clearing also cancels an active grace warning", () => {
    expect(nextCombo({ comboLevel: 4, comboGraceActive: true }, 1)).toEqual({
      comboLevel: 5,
      comboGraceActive: false,
    });
  });

  it("a non-clearing placement enters grace instead of zeroing immediately", () => {
    expect(nextCombo({ comboLevel: 5, comboGraceActive: false }, 0)).toEqual({
      comboLevel: 5,
      comboGraceActive: true,
    });
  });

  it("a second consecutive non-clearing placement zeroes the combo", () => {
    expect(nextCombo({ comboLevel: 5, comboGraceActive: true }, 0)).toEqual({
      comboLevel: 0,
      comboGraceActive: false,
    });
  });

  it("stays at 0 with no grace when there was nothing to lose", () => {
    expect(nextCombo({ comboLevel: 0, comboGraceActive: false }, 0)).toEqual({
      comboLevel: 0,
      comboGraceActive: false,
    });
  });
});

describe("scorePlacement", () => {
  it("scores placement points only when nothing clears", () => {
    const result = scorePlacement({
      pieceCells: 4,
      unitsCleared: 0,
      comboLevelAfter: 0,
      isBoardEmptyAfter: false,
    });
    expect(result.turnScore).toBe(4);
    expect(result.clearPoints).toBe(0);
    expect(result.perfectClearBonus).toBe(0);
  });

  it("applies the combo multiplier to a single-unit clear", () => {
    // First-ever clear: comboLevelAfter = 1 -> x1.0, clearBase(1,18)=18 -> clearPoints=18
    const result = scorePlacement({
      pieceCells: 3,
      unitsCleared: 1,
      comboLevelAfter: 1,
      isBoardEmptyAfter: false,
    });
    expect(result.clearPoints).toBe(18);
    expect(result.turnScore).toBe(3 + 18);
  });

  it("a 3-in-a-row combo at unitsCleared=1 scores base * x2.0", () => {
    const result = scorePlacement({
      pieceCells: 1,
      unitsCleared: 1,
      comboLevelAfter: 3,
      isBoardEmptyAfter: false,
    });
    // clearBase=18, mult=20 (x2.0) -> 18*20/10 = 36
    expect(result.clearPoints).toBe(36);
  });

  it("adds the perfect clear bonus when the board ends empty", () => {
    const result = scorePlacement({
      pieceCells: 1,
      unitsCleared: 1,
      comboLevelAfter: 1,
      isBoardEmptyAfter: true,
    });
    expect(result.perfectClearBonus).toBe(PERFECT_CLEAR_BONUS);
    expect(result.turnScore).toBe(1 + 18 + PERFECT_CLEAR_BONUS);
  });

  it("integer division truncates rather than rounds", () => {
    // unitsCleared=1, comboLevelAfter=2 -> mult=15 (x1.5): clearBase=18*15=270/10=27 exactly (no truncation here);
    // pick a case that actually forces truncation: 3 units at combo level 2.
    // clearBase(3,18) = 108, mult=15 -> 108*15=1620/10=162 exactly too.
    // Use a hand-picked odd case: unitsCleared=1 with a powerup-style base(9) at mult=15 -> 9*15=135/10=13.5 -> 13
    const result = scorePowerupClear({ unitsCleared: 1, comboLevel: 2, isBoardEmptyAfter: false });
    expect(result.clearPoints).toBe(13);
  });
});

describe("scorePowerupClear", () => {
  it("scores at half the per-unit base of a normal clear", () => {
    const normal = scorePlacement({ pieceCells: 0, unitsCleared: 1, comboLevelAfter: 1, isBoardEmptyAfter: false });
    const powerup = scorePowerupClear({ unitsCleared: 1, comboLevel: 0, isBoardEmptyAfter: false });
    expect(powerup.clearPoints).toBe(normal.clearPoints / 2);
  });

  it("never awards placement points", () => {
    const result = scorePowerupClear({ unitsCleared: 2, comboLevel: 5, isBoardEmptyAfter: false });
    expect(result.placementPoints).toBe(0);
  });

  it("is 0 when the powerup clears nothing (e.g. pencil/eraser)", () => {
    const result = scorePowerupClear({ unitsCleared: 0, comboLevel: 4, isBoardEmptyAfter: false });
    expect(result.turnScore).toBe(0);
  });

  it("reads the current combo level without requiring it be incremented", () => {
    const atZero = scorePowerupClear({ unitsCleared: 1, comboLevel: 0, isBoardEmptyAfter: false });
    const atThree = scorePowerupClear({ unitsCleared: 1, comboLevel: 3, isBoardEmptyAfter: false });
    expect(atThree.clearPoints).toBeGreaterThan(atZero.clearPoints);
  });
});
