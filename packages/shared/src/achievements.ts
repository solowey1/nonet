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
  | { readonly kind: "lifetime_score"; readonly threshold: number }
  | { readonly kind: "lifetime_runs"; readonly threshold: number }
  | { readonly kind: "run_pieces"; readonly threshold: number }
  | { readonly kind: "run_no_revive_score"; readonly threshold: number }
  | { readonly kind: "run_powerups_used"; readonly threshold: number }
  // `threshold` rather than "all of them" so the bar doesn't silently move
  // every time a theme is added (§19 round 9).
  | { readonly kind: "own_themes"; readonly threshold: number }
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
  /**
   * Secret achievements (§19 round 9) are listed but not described until
   * earned — the UI shows a locked placeholder instead of the name and
   * requirement. They still evaluate exactly like any other; "secret" is
   * purely a presentation flag, so nothing about the server logic branches
   * on it.
   */
  readonly secret?: boolean;
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
    // Round 9 raised the bar from x6 to x8, hence the renamed id: a player
    // who already holds `combo_x6` keeps that (now inert) row and re-earns
    // this one — which the retroactive lifetime check does automatically the
    // next time they open the app if their best combo already reaches 8.
    id: "combo_x8",
    repeatable: false,
    condition: { kind: "run_combo", threshold: 8 },
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
    // Counts *owned* themes, however they were obtained — a theme granted by
    // `first_5000`'s reward lands in the same inventory balance a purchase
    // does, so it counts here too (§19 round 9).
    id: "collector",
    repeatable: false,
    condition: { kind: "own_themes", threshold: 5 },
    reward: { kind: "inventory", items: { bomb: 5 } },
  },
  {
    id: "flawless_week",
    repeatable: true,
    condition: { kind: "weekly_perfect_clears", threshold: 5, days: 7 },
    reward: { kind: "inventory", items: { rocket: 3 } },
  },

  // --- Secret achievements (§19 round 9) ---------------------------------
  // Deliberately steep, and undescribed until earned, so they read as
  // discoveries rather than a checklist. Each one asks for something a
  // player would only hit by pushing well past ordinary play.
  {
    id: "secret_marathon",
    repeatable: false,
    secret: true,
    condition: { kind: "run_pieces", threshold: 500 },
    reward: { kind: "inventory", items: { rocket: 5, bomb: 5 } },
  },
  {
    id: "secret_purist",
    repeatable: false,
    secret: true,
    // 15k without touching a single power-up.
    condition: { kind: "run_pure_score", threshold: 15000 },
    reward: { kind: "inventory", items: { fill: 3 } },
  },
  {
    id: "secret_untouchable",
    repeatable: false,
    secret: true,
    condition: { kind: "run_combo", threshold: 20 },
    reward: { kind: "inventory", items: { fill: 2, bomb: 3 } },
  },
  {
    id: "secret_immaculate",
    repeatable: false,
    secret: true,
    condition: { kind: "run_perfect_clears", threshold: 5 },
    reward: { kind: "inventory", items: { fill: 3 } },
  },
  {
    id: "secret_demolition",
    repeatable: false,
    secret: true,
    condition: { kind: "run_units_cleared", threshold: 150 },
    reward: { kind: "inventory", items: { bomb: 5 } },
  },
  {
    id: "secret_high_roller",
    repeatable: false,
    secret: true,
    condition: { kind: "run_score", threshold: 50000 },
    reward: { kind: "inventory", items: { pencil: 10, eraser: 10 } },
  },
  {
    id: "secret_no_safety_net",
    repeatable: false,
    secret: true,
    // A big score with no revive bought or spent along the way.
    condition: { kind: "run_no_revive_score", threshold: 25000 },
    reward: { kind: "inventory", items: { revive: 3 } },
  },
  {
    id: "secret_toolmaster",
    repeatable: false,
    secret: true,
    condition: { kind: "run_powerups_used", threshold: 25 },
    reward: { kind: "inventory", items: { pencil: 10 } },
  },
  {
    id: "secret_centurion",
    repeatable: false,
    secret: true,
    condition: { kind: "lifetime_runs", threshold: 100 },
    reward: { kind: "inventory", items: { pencil: 10, eraser: 10, rocket: 5, bomb: 5, fill: 3 } },
  },
  {
    id: "secret_millionaire",
    repeatable: false,
    secret: true,
    condition: { kind: "lifetime_score", threshold: 1_000_000 },
    reward: { kind: "inventory", items: { revive: 10 } },
  },
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]["id"];
