/**
 * Seeds the starting SKU table (§8). Idempotent (upsert on `sku`) so it's
 * safe to run on every deploy — the whole point of a DB-backed shop table is
 * that these rows can then be edited directly without a deploy; this just
 * bootstraps sensible starting values.
 *
 * The array order below IS the shop's display order: each row's index is
 * written to `sortOrder` and `GET /api/shop` sorts by it. Without that the
 * shop rendered in whatever order Postgres happened to return rows, which is
 * not a guarantee at all (§19 round 8).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { notInArray } from "drizzle-orm";
import { PREMIUM_THEMES, themeInventoryKey } from "@nonet/shared";
import { shopSkus } from "./schema.js";

const THEME_SKUS = PREMIUM_THEMES.map((theme) => ({
  // Sku id and the granted inventory item are the same string here — themes
  // are a one-time unlock (qty just needs to end up >= 1), not a consumable
  // draw-down like the powerup SKUs below, so there's no need for them to differ.
  sku: themeInventoryKey(theme.id),
  title: theme.title,
  description: theme.description,
  starsAmount: theme.starsAmount,
  contents: { [themeInventoryKey(theme.id)]: 1 },
}));

const STARTING_SKUS = [
  // Bundles first — they're the best value per item, so they lead (§19 round 8).
  {
    sku: "toolbox",
    title: "Toolbox",
    description: "5 pencil, 5 eraser, 5 rocket, 5 bomb, 5 fill, 5 revive",
    starsAmount: 249,
    contents: { pencil: 5, eraser: 5, rocket: 5, bomb: 5, fill: 5, revive: 5 },
  },
  {
    sku: "toolcrate",
    title: "Tool Crate",
    description: "10 of every power-up, plus 10 revives",
    starsAmount: 449,
    contents: { pencil: 10, eraser: 10, rocket: 10, bomb: 10, fill: 10, revive: 10 },
  },
  { sku: "pencil_5", title: "5 Pencils", description: "5 x pencil", starsAmount: 15, contents: { pencil: 5 } },
  { sku: "eraser_5", title: "5 Erasers", description: "5 x eraser", starsAmount: 30, contents: { eraser: 5 } },
  { sku: "rocket_3", title: "3 Rockets", description: "3 x rocket", starsAmount: 45, contents: { rocket: 3 } },
  { sku: "bomb_3", title: "3 Bombs", description: "3 x bomb", starsAmount: 60, contents: { bomb: 3 } },
  { sku: "fill_3", title: "3 Fills", description: "3 x fill", starsAmount: 90, contents: { fill: 3 } },
  // Bulk-stockable revive tiers, spendable for free at game over. A single
  // revive is deliberately NOT sold here — buying one at a time stays the
  // game-over screen's own impulse purchase (the bare "revive" SKU below).
  { sku: "revive_3", title: "3 Revives", description: "3 x revive (stock up)", starsAmount: 79, contents: { revive: 3 } },
  { sku: "revive_10", title: "10 Revives", description: "10 x revive (stock up)", starsAmount: 249, contents: { revive: 10 } },
  { sku: "revive_25", title: "25 Revives", description: "25 x revive (stock up)", starsAmount: 599, contents: { revive: 25 } },
  {
    // Never listed in the shop (the client filters this exact sku out) — it's
    // the game-over screen's pay-right-now-for-this-run purchase, validated
    // against the `purchases` table rather than credited to inventory.
    sku: "revive",
    title: "Revive",
    description: "Continue a dead run once",
    starsAmount: 30,
    contents: {},
  },
] as const;

export async function seedShopSkus(db: ReturnType<typeof drizzle>): Promise<void> {
  const rows = [...STARTING_SKUS, ...THEME_SKUS];

  for (const [index, row] of rows.entries()) {
    await db
      .insert(shopSkus)
      .values({ ...row, sortOrder: index })
      .onConflictDoUpdate({
        target: shopSkus.sku,
        set: {
          title: row.title,
          description: row.description,
          starsAmount: row.starsAmount,
          contents: row.contents,
          sortOrder: index,
          // Re-activate on re-seed: a SKU that was retired and later brought
          // back should return, not stay invisible because of the sweep below.
          active: true,
        },
      });
  }

  // Retire anything no longer in the catalogue. Upserting alone would leave
  // withdrawn SKUs (fill_1, revive_1/5/20 as of round 8) on sale forever,
  // since nothing ever deleted them. Deactivating rather than deleting keeps
  // historical `purchases` rows meaningful.
  await db
    .update(shopSkus)
    .set({ active: false })
    .where(notInArray(shopSkus.sku, rows.map((r) => r.sku)));
}
