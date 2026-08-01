/**
 * Data model (§11). Append-only `inventoryLedger` is the point: every item a
 * player holds must be explainable. `purchases.telegramPaymentChargeId` is
 * UNIQUE for free idempotency — Telegram can and does re-deliver webhook
 * updates.
 *
 * Only `users` and `runs` are actively written by Phase 3 (auth + run
 * lifecycle + leaderboards). `inventoryLedger`/`inventoryBalance`/
 * `purchases`/`dailyStats` exist now so the schema is a single, coherent
 * unit and migrations don't need a disruptive follow-up — they'll be wired
 * up by the economy work in later phases (§19 steps 4-5).
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

export const inventoryLedger = pgTable("inventory_ledger", {
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
});

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

export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: bigint("user_id", { mode: "bigint" })
    .notNull()
    .references(() => users.id),
  telegramPaymentChargeId: text("telegram_payment_charge_id").notNull(),
  sku: text("sku").notNull(),
  starsAmount: integer("stars_amount").notNull(),
  payload: text("payload").notNull(),
  status: purchaseStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("purchases_charge_id_unique").on(table.telegramPaymentChargeId)]);

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
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);
