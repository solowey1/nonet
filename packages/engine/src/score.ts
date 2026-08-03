/**
 * Scoring & combo maths (§6). All-integer — no floats anywhere in the engine.
 * `comboMultiplierX10` is fixed-point tenths (10 = x1.0, 50 = x5.0) so the
 * final division is a single integer division, not a float multiply.
 */

export const PERFECT_CLEAR_BONUS = 300;
export const PLACEMENT_CLEAR_PER_UNIT = 18;
export const POWERUP_CLEAR_PER_UNIT = 9;
export const MAX_COMBO_STEP = 8; // multiplier caps at x5.0 (10 + 5*8 = 50)

/** Triangular-number clear base: 1->18, 2->54, 3->108, 4->180, 5->270 ... (per unit constant scales it). */
export function clearBaseScore(unitsCleared: number, perUnit: number): number {
  return (perUnit * unitsCleared * (unitsCleared + 1)) / 2;
}

/**
 * Fixed-point x10 combo multiplier for a given combo level (x1.0 .. x5.0).
 * A level <= 1 always yields exactly x1.0 — this matters for power-ups,
 * which read the *current* combo level without having incremented it first
 * (see scorePowerupClear below), so an untouched level of 0 must still read
 * as a neutral x1.0 rather than underflowing.
 */
export function comboMultiplierX10(comboLevel: number): number {
  const level = Math.max(comboLevel, 1);
  return 10 + 5 * Math.min(level - 1, MAX_COMBO_STEP);
}

export interface TurnScoreResult {
  readonly placementPoints: number;
  readonly clearBase: number;
  readonly comboMultiplierX10: number;
  readonly clearPoints: number;
  readonly perfectClearBonus: number;
  readonly turnScore: number;
}

/**
 * Score for a normal piece placement. `comboLevelAfter` must already be the
 * post-increment combo level (comboLevel+1 if unitsCleared>0, else 0) —
 * reduce.ts owns that state transition; this module is pure arithmetic.
 */
export function scorePlacement(input: {
  readonly pieceCells: number;
  readonly unitsCleared: number;
  readonly comboLevelAfter: number;
  readonly isBoardEmptyAfter: boolean;
}): TurnScoreResult {
  const placementPoints = input.pieceCells;
  const clearBase = clearBaseScore(input.unitsCleared, PLACEMENT_CLEAR_PER_UNIT);
  const mult = input.unitsCleared > 0 ? comboMultiplierX10(input.comboLevelAfter) : 10;
  const clearPoints = Math.floor((clearBase * mult) / 10);
  const perfectClearBonus = input.isBoardEmptyAfter ? PERFECT_CLEAR_BONUS : 0;
  return {
    placementPoints,
    clearBase,
    comboMultiplierX10: mult,
    clearPoints,
    perfectClearBonus,
    turnScore: placementPoints + clearPoints + perfectClearBonus,
  };
}

/**
 * Score for a power-up clear (§7): half the per-unit base (9 vs 18), no
 * placement points (nothing was placed), and the combo level is read as-is —
 * the caller must NOT have incremented or reset it for this action.
 */
export function scorePowerupClear(input: {
  readonly unitsCleared: number;
  readonly comboLevel: number;
  readonly isBoardEmptyAfter: boolean;
}): TurnScoreResult {
  const clearBase = clearBaseScore(input.unitsCleared, POWERUP_CLEAR_PER_UNIT);
  const mult = input.unitsCleared > 0 ? comboMultiplierX10(input.comboLevel) : 10;
  const clearPoints = Math.floor((clearBase * mult) / 10);
  const perfectClearBonus = input.isBoardEmptyAfter ? PERFECT_CLEAR_BONUS : 0;
  return {
    placementPoints: 0,
    clearBase,
    comboMultiplierX10: mult,
    clearPoints,
    perfectClearBonus,
    turnScore: clearPoints + perfectClearBonus,
  };
}

export interface ComboState {
  readonly comboLevel: number;
  readonly comboGraceActive: boolean;
}

/**
 * Next combo state given how many units this placement cleared (§6 round 5).
 * A clearing placement bumps the level by the *number* of units cleared at
 * once — clearing 2 lines (or a line + a 3x3 block) simultaneously is a
 * harder move than clearing 1, so it's worth more combo, not the same flat
 * +1. A non-clearing placement doesn't reset the combo immediately: it gets
 * one grace placement first (`comboGraceActive` flips on — the UI reads this
 * as "about to expire") before a *second* consecutive non-clearing placement
 * actually zeroes it. Without the grace step, holding a combo across more
 * than one placement at a time is nearly impossible.
 */
export function nextCombo(current: ComboState, unitsCleared: number): ComboState {
  if (unitsCleared > 0) {
    return { comboLevel: current.comboLevel + unitsCleared, comboGraceActive: false };
  }
  if (current.comboLevel === 0 || current.comboGraceActive) {
    return { comboLevel: 0, comboGraceActive: false };
  }
  return { comboLevel: current.comboLevel, comboGraceActive: true };
}
