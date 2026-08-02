/**
 * Achievements catalogue (§19 round 4). One source of truth shared by
 * apps/api (evaluates conditions + grants rewards) and apps/web (renders
 * progress) — same pattern as themes.ts. Display text is deliberately NOT
 * here: every achievement is rendered through i18n
 * (`achievements.names.<id>` / `achievements.descriptions.<id>`), matching
 * how every other piece of shop/theme copy in the app already works.
 *
 * Condition kinds fall into two families:
 *  - `run_*` — checked against the single run that was just finished.
 *  - everything else — checked against server-side aggregates (lifetime
 *    totals, a rolling 7-day window, or the existing daily-login streak).
 * `days` on the streak/window kinds doubles as the repeat cadence for
 * repeatable achievements (e.g. a 7-day condition can be earned again every
 * further 7 days), mirroring the existing daily-gift streak-bonus pattern.
 */

export type AchievementCondition =
  | { readonly kind: "run_score"; readonly threshold: number }
  | { readonly kind: "run_combo"; readonly threshold: number }
  | { readonly kind: "run_units_cleared"; readonly threshold: number }
  | { readonly kind: "run_perfect_clears"; readonly threshold: number }
  | { readonly kind: "run_pure_score"; readonly threshold: number }
  | { readonly kind: "lifetime_pieces"; readonly threshold: number }
  | { readonly kind: "own_all_themes" }
  | { readonly kind: "login_streak"; readonly days: number }
  | { readonly kind: "daily_score_streak"; readonly threshold: number; readonly days: number }
  | { readonly kind: "weekly_total_score"; readonly threshold: number; readonly days: number }
  | { readonly kind: "weekly_perfect_clears"; readonly threshold: number; readonly days: number };

export type AchievementReward =
  | { readonly kind: "inventory"; readonly items: Readonly<Record<string, number>> }
  | {
      readonly kind: "unlock_theme_or_inventory";
      readonly themeId: string;
      readonly fallbackItems: Readonly<Record<string, number>>;
    };

export interface AchievementDef {
  readonly id: string;
  readonly repeatable: boolean;
  readonly condition: AchievementCondition;
  readonly reward: AchievementReward;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // The one mandatory achievement (§19 round 4): the first run that ever
  // crosses 5000 points unlocks Monochrome for free — or, if it's already
  // owned, 3 bombs instead, so the reward is never wasted on a duplicate.
  {
    id: "first_5000",
    repeatable: false,
    condition: { kind: "run_score", threshold: 5000 },
    reward: { kind: "unlock_theme_or_inventory", themeId: "monochrome", fallbackItems: { bomb: 3 } },
  },

  // The 3 repeatable examples the user gave verbatim.
  {
    id: "daily_login_week",
    repeatable: true,
    condition: { kind: "login_streak", days: 7 },
    reward: { kind: "inventory", items: { pencil: 2, eraser: 2 } },
  },
  {
    id: "daily_score_week",
    repeatable: true,
    condition: { kind: "daily_score_streak", threshold: 1000, days: 7 },
    reward: { kind: "inventory", items: { rocket: 2, bomb: 1 } },
  },
  {
    id: "weekly_50000",
    repeatable: true,
    condition: { kind: "weekly_total_score", threshold: 50000, days: 7 },
    reward: { kind: "inventory", items: { bomb: 3, fill: 1 } },
  },

  // 10 invented achievements.
  {
    id: "first_line_clear",
    repeatable: false,
    condition: { kind: "run_units_cleared", threshold: 1 },
    reward: { kind: "inventory", items: { pencil: 3 } },
  },
  {
    id: "first_perfect_clear",
    repeatable: false,
    condition: { kind: "run_perfect_clears", threshold: 1 },
    reward: { kind: "inventory", items: { eraser: 3 } },
  },
  {
    id: "combo_x3",
    repeatable: false,
    condition: { kind: "run_combo", threshold: 3 },
    reward: { kind: "inventory", items: { rocket: 2 } },
  },
  {
    id: "combo_x6",
    repeatable: false,
    condition: { kind: "run_combo", threshold: 6 },
    reward: { kind: "inventory", items: { fill: 1 } },
  },
  {
    id: "century_builder",
    repeatable: false,
    condition: { kind: "lifetime_pieces", threshold: 100 },
    reward: { kind: "inventory", items: { pencil: 5 } },
  },
  {
    id: "veteran_builder",
    repeatable: false,
    condition: { kind: "lifetime_pieces", threshold: 1000 },
    reward: { kind: "inventory", items: { pencil: 5, eraser: 5, rocket: 3, bomb: 3, fill: 1 } },
  },
  {
    id: "high_roller",
    repeatable: false,
    condition: { kind: "run_score", threshold: 20000 },
    reward: { kind: "inventory", items: { bomb: 3 } },
  },
  {
    id: "clean_sweep",
    repeatable: false,
    condition: { kind: "run_pure_score", threshold: 3000 },
    reward: { kind: "inventory", items: { eraser: 5 } },
  },
  {
    id: "collector",
    repeatable: false,
    condition: { kind: "own_all_themes" },
    reward: { kind: "inventory", items: { bomb: 5 } },
  },
  {
    id: "flawless_week",
    repeatable: true,
    condition: { kind: "weekly_perfect_clears", threshold: 5, days: 7 },
    reward: { kind: "inventory", items: { rocket: 3 } },
  },
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]["id"];
