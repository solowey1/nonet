/**
 * Achievements evaluation (§19 round 4). Two triggers call into this:
 *  - `/api/run/finish`, with the just-finished run's stats — covers every
 *    `run_*` condition plus the server-side aggregate ones (lifetime pieces,
 *    owns-all-themes, the daily/weekly windows).
 *  - `/api/session`, with the login streak `grantDailyGiftIfNeeded` already
 *    computed — covers `login_streak` only, since that's the one condition
 *    with nothing to do with a run.
 *
 * A repeatable achievement's `progress.lastAwardedDay` is the only piece of
 * state that isn't cheaply re-derivable from existing tables — it exists
 * purely to stop a *sustained* condition (a week-long streak that keeps
 * holding, a rolling-week sum that stays above threshold) from re-awarding
 * on every single evaluation; it re-arms once `condition.days` have passed
 * since the last award, deliberately mirroring dailyGift.ts's existing
 * `streak % STREAK_BONUS_EVERY_DAYS` cadence.
 */
import {
  ACHIEVEMENTS,
  PREMIUM_THEMES,
  themeInventoryKey,
  type AchievementCondition,
  type AchievementDef,
  type AchievementReward,
} from "@nonet/shared";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { db as dbClient } from "../db/client.js";
import { dailyStats, inventoryBalance, runs, userAchievements } from "../db/schema.js";
import { addDaysUTC, todayUTCDateString } from "../utils/dates.js";
import { grantItems } from "./inventory.js";

type Executor = typeof dbClient;

export interface RunAchievementContext {
  readonly score: number;
  readonly maxCombo: number;
  readonly unitsCleared: number;
  readonly perfectClears: number;
  readonly usedPowerups: boolean;
}

export interface UnlockedAchievement {
  readonly id: string;
  readonly reward: AchievementReward;
}

interface AchievementState {
  readonly timesCompleted: number;
  readonly lastCompletedAt: Date | null;
  readonly progress: { readonly lastAwardedDay?: string };
}

async function loadState(db: Executor, userId: bigint, achievementId: string): Promise<AchievementState> {
  const [row] = await db
    .select()
    .from(userAchievements)
    .where(and(eq(userAchievements.userId, userId), eq(userAchievements.achievementId, achievementId)));
  if (!row) return { timesCompleted: 0, lastCompletedAt: null, progress: {} };
  return { timesCompleted: row.timesCompleted, lastCompletedAt: row.lastCompletedAt, progress: (row.progress ?? {}) as AchievementState["progress"] };
}

async function recordCompletion(
  db: Executor,
  userId: bigint,
  achievementId: string,
  progress: AchievementState["progress"],
): Promise<void> {
  await db
    .insert(userAchievements)
    .values({ userId, achievementId, timesCompleted: 1, lastCompletedAt: new Date(), progress })
    .onConflictDoUpdate({
      target: [userAchievements.userId, userAchievements.achievementId],
      set: { timesCompleted: sql`${userAchievements.timesCompleted} + 1`, lastCompletedAt: new Date(), progress },
    });
}

async function grantReward(db: Executor, userId: bigint, reward: AchievementReward): Promise<void> {
  if (reward.kind === "inventory") {
    await grantItems(db, userId, reward.items, "gift");
    return;
  }
  const themeKey = themeInventoryKey(reward.themeId);
  const [existing] = await db
    .select({ qty: inventoryBalance.qty })
    .from(inventoryBalance)
    .where(and(eq(inventoryBalance.userId, userId), eq(inventoryBalance.item, themeKey)));
  if ((existing?.qty ?? 0) > 0) {
    await grantItems(db, userId, reward.fallbackItems, "gift");
  } else {
    await grantItems(db, userId, { [themeKey]: 1 }, "gift");
  }
}

async function getLifetimePieces(db: Executor, userId: bigint): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${runs.piecesPlaced}), 0)::int` })
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.verified, true)));
  return row?.total ?? 0;
}

/**
 * How many premium themes the player owns *however they got them* — this reads
 * `inventory_balance`, which is where a purchase and an achievement reward both
 * land (see `grantReward` above, and `first_5000`'s Monochrome unlock), so a
 * theme won for free counts exactly like a bought one (§19 round 9).
 */
async function ownedThemeCount(db: Executor, userId: bigint): Promise<number> {
  const keys = PREMIUM_THEMES.map((t) => themeInventoryKey(t.id));
  const rows = await db
    .select({ item: inventoryBalance.item, qty: inventoryBalance.qty })
    .from(inventoryBalance)
    .where(and(eq(inventoryBalance.userId, userId), inArray(inventoryBalance.item, keys)));
  return rows.filter((r) => r.qty > 0).length;
}

const DAILY_STREAK_LOOKBACK_CAP = 60;

/** How many of the calendar days ending today (no gaps) have `bestScore >= threshold`, capped at DAILY_STREAK_LOOKBACK_CAP. */
async function getDailyScoreStreakLength(db: Executor, userId: bigint, threshold: number): Promise<number> {
  const rows = await db
    .select({ day: dailyStats.day, bestScore: dailyStats.bestScore })
    .from(dailyStats)
    .where(eq(dailyStats.userId, userId))
    .orderBy(desc(dailyStats.day))
    .limit(DAILY_STREAK_LOOKBACK_CAP);
  const today = todayUTCDateString();
  let streak = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.day !== addDaysUTC(today, -i) || row.bestScore < threshold) break;
    streak++;
  }
  return streak;
}

/** True iff each of the last `days` calendar days (ending today, no gaps) has `bestScore >= threshold`. */
async function hasConsecutiveDailyScore(db: Executor, userId: bigint, threshold: number, days: number): Promise<boolean> {
  return (await getDailyScoreStreakLength(db, userId, threshold)) >= days;
}

async function rollingSum(db: Executor, userId: bigint, column: "totalScore" | "perfectClears", days: number): Promise<number> {
  const today = todayUTCDateString();
  const start = addDaysUTC(today, -(days - 1));
  const col = column === "totalScore" ? dailyStats.totalScore : dailyStats.perfectClears;
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${col}), 0)::int` })
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), gte(dailyStats.day, start), lte(dailyStats.day, today)));
  return row?.total ?? 0;
}

interface RunAggregates {
  readonly bestScore: number;
  readonly bestCombo: number;
  readonly bestUnitsCleared: number;
  readonly bestPerfectClears: number;
  readonly bestPureScore: number;
  readonly bestPieces: number;
  readonly bestNoReviveScore: number;
  readonly bestPowerupsUsed: number;
  readonly lifetimeScore: number;
  readonly runCount: number;
}

/**
 * Lifetime bests across every verified run — this is what makes `run_*`
 * conditions retroactive: a player who already scored 20000 before an
 * achievement existed (or before their most recent run) still has that run
 * sitting in `runs`, so the very next evaluation (a new run finishing, or
 * just opening the app — see `evaluateLifetimeAchievements`) sees it and
 * unlocks immediately, without needing a fresh run that re-hits the same bar.
 */
async function getRunAggregates(db: Executor, userId: bigint): Promise<RunAggregates> {
  const [row] = await db
    .select({
      bestScore: sql<number>`coalesce(max(${runs.score}), 0)::int`,
      bestCombo: sql<number>`coalesce(max(${runs.maxCombo}), 0)::int`,
      bestUnitsCleared: sql<number>`coalesce(max(${runs.unitsCleared}), 0)::int`,
      bestPerfectClears: sql<number>`coalesce(max(${runs.perfectClears}), 0)::int`,
      bestPureScore: sql<number>`coalesce(max(${runs.score}) filter (where not ${runs.usedPowerups}), 0)::int`,
      bestPieces: sql<number>`coalesce(max(${runs.piecesPlaced}), 0)::int`,
      bestNoReviveScore: sql<number>`coalesce(max(${runs.score}) filter (where not ${runs.revived}), 0)::int`,
      bestPowerupsUsed: sql<number>`coalesce(max(${runs.powerupsUsed}), 0)::int`,
      lifetimeScore: sql<number>`coalesce(sum(${runs.score}), 0)::bigint`,
      runCount: sql<number>`count(*)::int`,
    })
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.verified, true)));
  return {
    bestScore: row?.bestScore ?? 0,
    bestCombo: row?.bestCombo ?? 0,
    bestUnitsCleared: row?.bestUnitsCleared ?? 0,
    bestPerfectClears: row?.bestPerfectClears ?? 0,
    bestPureScore: row?.bestPureScore ?? 0,
    bestPieces: row?.bestPieces ?? 0,
    bestNoReviveScore: row?.bestNoReviveScore ?? 0,
    bestPowerupsUsed: row?.bestPowerupsUsed ?? 0,
    // `sum()` over bigint comes back as a string from postgres.js — Number() it
    // here so every consumer sees a plain number like the other aggregates.
    lifetimeScore: Number(row?.lifetimeScore ?? 0),
    runCount: row?.runCount ?? 0,
  };
}

async function checkCondition(
  db: Executor,
  userId: bigint,
  condition: AchievementCondition,
  agg: RunAggregates,
): Promise<boolean> {
  switch (condition.kind) {
    case "run_score":
      return agg.bestScore >= condition.threshold;
    case "run_combo":
      return agg.bestCombo >= condition.threshold;
    case "run_units_cleared":
      return agg.bestUnitsCleared >= condition.threshold;
    case "run_perfect_clears":
      return agg.bestPerfectClears >= condition.threshold;
    case "run_pure_score":
      return agg.bestPureScore >= condition.threshold;
    case "run_pieces":
      return agg.bestPieces >= condition.threshold;
    case "run_no_revive_score":
      return agg.bestNoReviveScore >= condition.threshold;
    case "run_powerups_used":
      return agg.bestPowerupsUsed >= condition.threshold;
    case "lifetime_pieces":
      return (await getLifetimePieces(db, userId)) >= condition.threshold;
    case "lifetime_score":
      return agg.lifetimeScore >= condition.threshold;
    case "lifetime_runs":
      return agg.runCount >= condition.threshold;
    case "own_themes":
      return (await ownedThemeCount(db, userId)) >= condition.threshold;
    case "daily_score_streak":
      return hasConsecutiveDailyScore(db, userId, condition.threshold, condition.days);
    case "weekly_total_score":
      return (await rollingSum(db, userId, "totalScore", condition.days)) >= condition.threshold;
    case "weekly_perfect_clears":
      return (await rollingSum(db, userId, "perfectClears", condition.days)) >= condition.threshold;
    case "login_streak":
      return false; // evaluated separately by evaluateLoginAchievements
  }
}

/** Upserts today's cumulative row — must run before any daily/weekly-window condition is checked. */
async function updateDailyStatsForRun(db: Executor, userId: bigint, run: RunAchievementContext): Promise<void> {
  const today = todayUTCDateString();
  await db
    .insert(dailyStats)
    .values({ userId, day: today, runs: 1, bestScore: run.score, streak: 0, totalScore: run.score, perfectClears: run.perfectClears })
    .onConflictDoUpdate({
      target: [dailyStats.userId, dailyStats.day],
      set: {
        runs: sql`${dailyStats.runs} + 1`,
        bestScore: sql`GREATEST(${dailyStats.bestScore}, ${run.score})`,
        totalScore: sql`${dailyStats.totalScore} + ${run.score}`,
        perfectClears: sql`${dailyStats.perfectClears} + ${run.perfectClears}`,
      },
    });
}

function dayGatePasses(def: AchievementDef, state: AchievementState, today: string): boolean {
  if (!def.repeatable) return state.timesCompleted === 0;
  const days = "days" in def.condition ? def.condition.days : 7;
  const last = state.progress.lastAwardedDay;
  return !last || Math.abs(new Date(today).getTime() - new Date(last).getTime()) / 86_400_000 >= days;
}

async function evaluateNonLoginAchievements(db: Executor, userId: bigint, agg: RunAggregates): Promise<UnlockedAchievement[]> {
  const today = todayUTCDateString();
  const unlocked: UnlockedAchievement[] = [];

  for (const def of ACHIEVEMENTS) {
    if (def.condition.kind === "login_streak") continue;
    const state = await loadState(db, userId, def.id);
    if (!dayGatePasses(def, state, today)) continue;
    if (!(await checkCondition(db, userId, def.condition, agg))) continue;

    await grantReward(db, userId, def.reward);
    await recordCompletion(db, userId, def.id, def.repeatable ? { lastAwardedDay: today } : state.progress);
    unlocked.push({ id: def.id, reward: def.reward });
  }

  return unlocked;
}

export async function evaluateRunAchievements(
  db: Executor,
  userId: bigint,
  run: RunAchievementContext,
): Promise<UnlockedAchievement[]> {
  await updateDailyStatsForRun(db, userId, run);
  const agg = await getRunAggregates(db, userId);
  return evaluateNonLoginAchievements(db, userId, agg);
}

/**
 * Catches up every non-login-streak achievement from scratch, using only
 * already-persisted aggregates — no run context needed. Called from
 * `/api/session` so a player who qualified for something (before the
 * achievement existed, or on a run finished before this evaluation logic
 * changed) gets it the moment they next open the app, not only the next time
 * they happen to finish a fresh run.
 */
export async function evaluateLifetimeAchievements(db: Executor, userId: bigint): Promise<UnlockedAchievement[]> {
  const agg = await getRunAggregates(db, userId);
  return evaluateNonLoginAchievements(db, userId, agg);
}

export async function evaluateLoginAchievements(db: Executor, userId: bigint, loginStreak: number): Promise<UnlockedAchievement[]> {
  if (loginStreak <= 0) return [];
  const today = todayUTCDateString();
  const unlocked: UnlockedAchievement[] = [];

  for (const def of ACHIEVEMENTS) {
    if (def.condition.kind !== "login_streak") continue;
    const state = await loadState(db, userId, def.id);
    if (!dayGatePasses(def, state, today)) continue;
    if (loginStreak % def.condition.days !== 0) continue;

    await grantReward(db, userId, def.reward);
    await recordCompletion(db, userId, def.id, { lastAwardedDay: today });
    unlocked.push({ id: def.id, reward: def.reward });
  }

  return unlocked;
}

export interface AchievementSnapshotEntry {
  readonly id: string;
  readonly repeatable: boolean;
  readonly secret: boolean;
  readonly unlocked: boolean;
  readonly timesCompleted: number;
  readonly lastCompletedAt: string | null;
  readonly progress: { readonly current: number; readonly target: number };
}

/** Live progress for every catalogue achievement, for GET /api/achievements — recomputed on read, nothing cached beyond `timesCompleted`/`lastCompletedAt`. */
export async function getAchievementsSnapshot(db: Executor, userId: bigint): Promise<AchievementSnapshotEntry[]> {
  const runAgg = await getRunAggregates(db, userId);

  const today = todayUTCDateString();
  const [todayRow] = await db.select({ streak: dailyStats.streak }).from(dailyStats).where(and(eq(dailyStats.userId, userId), eq(dailyStats.day, today)));
  const loginStreak = todayRow?.streak ?? 0;

  const lifetimePieces = await getLifetimePieces(db, userId);
  const ownedThemes = await ownedThemeCount(db, userId);

  const entries: AchievementSnapshotEntry[] = [];
  for (const def of ACHIEVEMENTS) {
    const state = await loadState(db, userId, def.id);
    let current = 0;
    let target = 1;
    switch (def.condition.kind) {
      case "run_score":
        current = runAgg.bestScore;
        target = def.condition.threshold;
        break;
      case "run_combo":
        current = runAgg.bestCombo;
        target = def.condition.threshold;
        break;
      case "run_units_cleared":
        current = runAgg.bestUnitsCleared;
        target = def.condition.threshold;
        break;
      case "run_perfect_clears":
        current = runAgg.bestPerfectClears;
        target = def.condition.threshold;
        break;
      case "run_pure_score":
        current = runAgg.bestPureScore;
        target = def.condition.threshold;
        break;
      case "run_pieces":
        current = runAgg.bestPieces;
        target = def.condition.threshold;
        break;
      case "run_no_revive_score":
        current = runAgg.bestNoReviveScore;
        target = def.condition.threshold;
        break;
      case "run_powerups_used":
        current = runAgg.bestPowerupsUsed;
        target = def.condition.threshold;
        break;
      case "lifetime_pieces":
        current = lifetimePieces;
        target = def.condition.threshold;
        break;
      case "lifetime_score":
        current = runAgg.lifetimeScore;
        target = def.condition.threshold;
        break;
      case "lifetime_runs":
        current = runAgg.runCount;
        target = def.condition.threshold;
        break;
      case "own_themes":
        current = ownedThemes;
        target = def.condition.threshold;
        break;
      case "login_streak":
        current = loginStreak;
        target = def.condition.days;
        break;
      case "daily_score_streak":
        current = await getDailyScoreStreakLength(db, userId, def.condition.threshold);
        target = def.condition.days;
        break;
      case "weekly_total_score":
        current = await rollingSum(db, userId, "totalScore", def.condition.days);
        target = def.condition.threshold;
        break;
      case "weekly_perfect_clears":
        current = await rollingSum(db, userId, "perfectClears", def.condition.days);
        target = def.condition.threshold;
        break;
    }
    entries.push({
      id: def.id,
      repeatable: def.repeatable,
      secret: def.secret === true,
      unlocked: state.timesCompleted > 0,
      timesCompleted: state.timesCompleted,
      lastCompletedAt: state.lastCompletedAt ? state.lastCompletedAt.toISOString() : null,
      progress: { current: Math.min(current, target), target },
    });
  }
  return entries;
}
