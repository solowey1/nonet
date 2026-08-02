import type { Action, PowerupKind } from "@nonet/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { db as dbClient } from "../db/client.js";
import { inventoryBalance, inventoryLedger, purchases } from "../db/schema.js";

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
 * replay verification untouched. `revive` actions get the same treatment,
 * checked against `purchases` instead of `inventoryLedger` (a revive isn't
 * an inventory item — see reduce.ts's `reduceRevive`).
 */
export async function validateConsumeTokens(db: Executor, userId: bigint, runId: string, actions: readonly Action[]): Promise<boolean> {
  const powerupActions = actions.filter((a): a is Extract<Action, { type: "powerup" }> => a.type === "powerup");
  const reviveActions = actions.filter((a): a is Extract<Action, { type: "revive" }> => a.type === "revive");
  if (powerupActions.length === 0 && reviveActions.length === 0) return true;

  const powerupTokens = powerupActions.map((a) => a.consumeToken);
  const reviveTokens = reviveActions.map((a) => a.consumeToken);
  if (new Set(powerupTokens).size !== powerupTokens.length) return false;
  if (new Set(reviveTokens).size !== reviveTokens.length) return false;

  let powerupsOk = true;
  if (powerupActions.length > 0) {
    let ids: bigint[];
    try {
      ids = powerupTokens.map((t) => {
        if (!/^\d+$/.test(t)) throw new Error("not a plain integer");
        return BigInt(t);
      });
    } catch {
      powerupsOk = false;
      ids = [];
    }
    if (powerupsOk) {
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
      powerupsOk = powerupActions.every((action) => itemById.get(action.consumeToken) === action.kind);
    }
  }
  if (!powerupsOk) return false;

  if (reviveActions.length > 0) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (reviveTokens.some((t) => !uuidPattern.test(t))) return false; // fabricated/malformed token — never a valid purchase id

    const rows = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          inArray(purchases.id, reviveTokens),
          eq(purchases.userId, userId),
          eq(purchases.runId, runId),
          eq(purchases.sku, "revive"),
          eq(purchases.status, "paid"),
        ),
      );
    const validIds = new Set(rows.map((r) => r.id));
    if (!reviveActions.every((action) => validIds.has(action.consumeToken))) return false;
  }

  return true;
}
