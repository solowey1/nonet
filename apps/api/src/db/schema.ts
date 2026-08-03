/**
 * Data model (§11, plus `shopSkus` for §8's data-driven SKU table). Append-only
 * `inventoryLedger` is the point: every item a player holds must be
 * explainable. `purchases.telegramPaymentChargeId` is UNIQUE for free
 * idempotency — Telegram can and does re-deliver webhook updates.
 *
 * As of Phase 5 (economy), every table here is live: `shopSkus` backs the
 * shop, `purchases`/`inventoryLedger` record the Stars flow, `dailyStats`
 * backs the daily gift/streak.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const inventoryLedgerReason = pgEnum("inventory_ledger_reason", [
  "purchase",
  "drop",
  "use",
  "refund",
  "gift",
  "admin",
]);

export const purchaseStatus = pgEnum("purchase_status", ["pending", "paid", "refunded"]);

export const users = pgTable("users", {
  id: bigint("id", { mode: "bigint" }).primaryKey(), // Telegram user id
  username: text("username"),
  firstName: text("first_name"),
  photoUrl: text("photo_url"),
  languageCode: text("language_code"),
  isPremium: boolean("is_premium").notNull().default(false),
  referredBy: bigint("referred_by", { mode: "bigint" }),
  tonAddress: text("ton_address"), // §14: nullable, Gram/TON Connect payouts (Phase 2 stub, unused for now)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  fraudScore: integer("fraud_score").notNull().default(0),
});

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    seed: text("seed").notNull(), // 128-bit seed, stored hex-encoded
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    score: integer("score").notNull().default(0),
    unitsCleared: integer("units_cleared").notNull().default(0),
    maxCombo: integer("max_combo").notNull().default(0),
    piecesPlaced: integer("pieces_placed").notNull().default(0),
    perfectClears: integer("perfect_clears").notNull().default(0),
    usedPowerups: boolean("used_powerups").notNull().default(false),
    revived: boolean("revived").notNull().default(false),
    verified: boolean("verified").notNull().default(false),
    actions: jsonb("actions").notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [
    index("runs_leaderboard_idx").on(table.verified, table.usedPowerups, table.endedAt.desc(), table.score.desc()),
    index("runs_daily_leaderboard_idx")
      .on(table.verified, table.endedAt.desc(), table.score.desc())
      .where(sql`${table.endedAt} is not null`),
  ],
);

export const inventoryLedger = pgTable(
  "inventory_ledger",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    item: text("item").notNull(),
    delta: integer("delta").notNull(),
    reason: inventoryLedgerReason("reason").notNull(),
    ref: text("ref"),
    runId: uuid("run_id").references(() => runs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Makes milestone-drop grants idempotent: a repeat POST /api/run/milestone
    // for the same (run, "milestone-N") ref can't insert twice (§8).
    uniqueIndex("inventory_ledger_run_ref_unique")
      .on(table.runId, table.ref)
      .where(sql`${table.ref} is not null`),
  ],
);

export const inventoryBalance = pgTable(
  "inventory_balance",
  {
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    item: text("item").notNull(),
    qty: integer("qty").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.item] }), check("inventory_balance_qty_check", sql`${table.qty} >= 0`)],
);

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    // Nullable: §13's own flow persists a 'pending' row *before* payment
    // happens, when no charge id exists yet — Postgres's UNIQUE constraint
    // already treats NULL as distinct from NULL, so this doesn't weaken the
    // idempotency guarantee once a real charge id is set (see DECISIONS.md).
    telegramPaymentChargeId: text("telegram_payment_charge_id"),
    sku: text("sku").notNull(),
    starsAmount: integer("stars_amount").notNull(),
    payload: text("payload").notNull(),
    status: purchaseStatus("status").notNull().default("pending"),
    // Which run a 'revive' purchase is for — null for every other SKU.
    runId: uuid("run_id").references(() => runs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("purchases_charge_id_unique").on(table.telegramPaymentChargeId),
    uniqueIndex("purchases_payload_unique").on(table.payload),
  ],
);

export const shopSkus = pgTable("shop_skus", {
  sku: text("sku").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  starsAmount: integer("stars_amount").notNull(),
  // e.g. {"pencil": 5} for pencil_5, {} for revive (not an inventory grant —
  // see the invoice handler). Kept data-driven per §8: "put them in a DB
  // table, not in code, so they can change without a deploy."
  contents: jsonb("contents").notNull().default(sql`'{}'::jsonb`),
  active: boolean("active").notNull().default(true),
  // Display order in the shop (§19 round 8). Without it the list came back in
  // whatever order Postgres felt like, which is not a guarantee — and the
  // catalogue's order is a merchandising decision, so it belongs in the same
  // editable-without-a-deploy table as the prices.
  sortOrder: integer("sort_order").notNull().default(0),
});

export const dailyStats = pgTable(
  "daily_stats",
  {
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    runs: integer("runs").notNull().default(0),
    bestScore: integer("best_score").notNull().default(0),
    streak: integer("streak").notNull().default(0),
    // Both added for achievements (§19 round 4) — the daily-score-streak and
    // rolling-week conditions need the day's *cumulative* score and perfect
    // clears, not just the best single run `bestScore` already tracked.
    totalScore: integer("total_score").notNull().default(0),
    perfectClears: integer("perfect_clears").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

export const userAchievements = pgTable(
  "user_achievements",
  {
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    achievementId: text("achievement_id").notNull(),
    // 0 for never earned; capped at 1 for one-time achievements, uncapped
    // for repeatable ones (§19 round 4).
    timesCompleted: integer("times_completed").notNull().default(0),
    lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
    // Condition-specific bookkeeping that can't be cheaply re-derived on
    // every check — currently just `{ lastAwardedDay }`, the day-gate that
    // stops a sustained repeatable condition (a week-long streak that keeps
    // holding) from re-awarding on every single evaluation.
    progress: jsonb("progress").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.achievementId] })],
);
