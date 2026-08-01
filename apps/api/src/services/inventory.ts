import type { Action, PowerupKind } from "@nonet/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { db as dbClient } from "../db/client.js";
import { inventoryBalance, inventoryLedger } from "../db/schema.js";

type Executor = typeof dbClient;

/**
 * Starter kit granted once, the first time a user is ever seen (§20:
 * "a scoring or drop-rate constant needs changing for playability reasons —
 * propose the new number"). §8's real earning loop — milestone drops and
 * the daily gift — is step-5 economy work; without it there'd be nothing to
 * consume and no way to exercise the targeting UI or the consume-at-use
 * flow this step is actually about, so this is a deliberately small,
 * clearly-labelled stand-in rather than a real drop-rate decision.
 */
export const WELCOME_GIFT: ReadonlyArray<{ item: PowerupKind; qty: number }> = [
  { item: "pencil", qty: 3 },
  { item: "eraser", qty: 3 },
  { item: "rocket", qty: 2 },
  { item: "bomb", qty: 1 },
  { item: "fill", qty: 1 },
];

export async function grantWelcomeGift(db: Executor, userId: bigint): Promise<void> {
  for (const { item, qty } of WELCOME_GIFT) {
    await db.insert(inventoryLedger).values({ userId, item, delta: qty, reason: "gift", ref: "welcome" });
  }
  for (const { item, qty } of WELCOME_GIFT) {
    await db
      .insert(inventoryBalance)
      .values({ userId, item, qty })
      .onConflictDoUpdate({
        target: [inventoryBalance.userId, inventoryBalance.item],
        set: { qty: sql`${inventoryBalance.qty} + ${qty}` },
      });
  }
}

/**
 * Every power-up action in a finished run's log must carry a `consumeToken`
 * that really was issued — by `/api/inventory/consume` — for *this* run and
 * *that* item, and no token may cover more than one action. This is what
 * makes "consumed at use time" actually enforceable server-side: the engine's
 * own replay has no concept of inventory, so a tampered log that adds extra
 * power-up actions (or replays one token twice) would otherwise sail through
 * replay verification untouched.
 */
export async function validateConsumeTokens(db: Executor, userId: bigint, runId: string, actions: readonly Action[]): Promise<boolean> {
  const powerupActions = actions.filter((a): a is Extract<Action, { type: "powerup" }> => a.type === "powerup");
  if (powerupActions.length === 0) return true;

  const tokens = powerupActions.map((a) => a.consumeToken);
  if (new Set(tokens).size !== tokens.length) return false; // one token claimed by 2+ actions

  let ids: bigint[];
  try {
    ids = tokens.map((t) => {
      if (!/^\d+$/.test(t)) throw new Error("not a plain integer");
      return BigInt(t);
    });
  } catch {
    return false;
  }

  const rows = await db
    .select({ id: inventoryLedger.id, item: inventoryLedger.item })
    .from(inventoryLedger)
    .where(
      and(
        inArray(inventoryLedger.id, ids),
        eq(inventoryLedger.userId, userId),
        eq(inventoryLedger.runId, runId),
        eq(inventoryLedger.reason, "use"),
      ),
    );

  const itemById = new Map(rows.map((r) => [r.id.toString(), r.item]));
  return powerupActions.every((action) => itemById.get(action.consumeToken) === action.kind);
}
