import type { PowerupKind } from "@nonet/shared";
import { and, eq, sql } from "drizzle-orm";
import type { db as dbClient } from "../db/client.js";
import { dailyStats, inventoryBalance, inventoryLedger } from "../db/schema.js";

type Executor = typeof dbClient;

const DAILY_ITEMS: readonly PowerupKind[] = ["pencil", "eraser", "rocket", "bomb", "fill"];
const DAILY_WEIGHTS: Record<PowerupKind, number> = { pencil: 40, eraser: 28, rocket: 18, bomb: 10, fill: 4 };
/** Every Nth consecutive day gets a second item on top of the regular gift — an exact cadence §20 invites revisiting. */
const STREAK_BONUS_EVERY_DAYS = 7;

function rollDailyItem(): PowerupKind {
  const total = DAILY_ITEMS.reduce((sum, item) => sum + DAILY_WEIGHTS[item], 0);
  let roll = Math.random() * total;
  for (const item of DAILY_ITEMS) {
    if (roll < DAILY_WEIGHTS[item]) return item;
    roll -= DAILY_WEIGHTS[item];
  }
  return DAILY_ITEMS[DAILY_ITEMS.length - 1] as PowerupKind;
}

async function grantOne(db: Executor, userId: bigint, item: PowerupKind, ref: string): Promise<void> {
  await db.insert(inventoryLedger).values({ userId, item, delta: 1, reason: "gift", ref });
  await db
    .insert(inventoryBalance)
    .values({ userId, item, qty: 1 })
    .onConflictDoUpdate({
      target: [inventoryBalance.userId, inventoryBalance.item],
      set: { qty: sql`${inventoryBalance.qty} + 1` },
    });
}

export interface DailyGiftResult {
  readonly granted: boolean;
  readonly items: readonly PowerupKind[];
  readonly streak: number;
}

/**
 * §8: "a daily first-run gift and a consecutive-days streak bonus." Always
 * gives a real item (unlike the milestone drop table, a daily login gift
 * that says "you got nothing" reads as broken, not as suspenseful). Race-safe
 * against two concurrent session calls on the same day: today's `dailyStats`
 * row is claimed atomically via `onConflictDoNothing` *before* anything is
 * granted, so only the request that actually inserts the row grants items.
 */
export async function grantDailyGiftIfNeeded(db: Executor, userId: bigint): Promise<DailyGiftResult> {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [yesterdayRow] = await db
    .select({ streak: dailyStats.streak })
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.day, yesterday)));
  const streak = (yesterdayRow?.streak ?? 0) + 1;

  const claimed = await db
    .insert(dailyStats)
    .values({ userId, day: today, runs: 0, bestScore: 0, streak })
    .onConflictDoNothing({ target: [dailyStats.userId, dailyStats.day] })
    .returning({ streak: dailyStats.streak });

  const claimedRow = claimed[0];
  if (!claimedRow) {
    const [existing] = await db
      .select({ streak: dailyStats.streak })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), eq(dailyStats.day, today)));
    return { granted: false, items: [], streak: existing?.streak ?? streak };
  }

  const items: PowerupKind[] = [rollDailyItem()];
  await grantOne(db, userId, items[0] as PowerupKind, `daily-${today}`);

  if (streak % STREAK_BONUS_EVERY_DAYS === 0) {
    const bonus = rollDailyItem();
    items.push(bonus);
    await grantOne(db, userId, bonus, `streak-${today}`);
  }

  return { granted: true, items, streak: claimedRow.streak };
}
