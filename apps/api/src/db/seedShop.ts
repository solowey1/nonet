/**
 * Seeds the starting SKU table (§8). Idempotent (upsert on `sku`) so it's
 * safe to run on every deploy — the whole point of a DB-backed shop table is
 * that these rows can then be edited directly without a deploy; this just
 * bootstraps sensible starting values.
 */
import { drizzle } from "drizzle-orm/postgres-js";
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
  { sku: "pencil_5", title: "5 Pencils", description: "5 x pencil", starsAmount: 25, contents: { pencil: 5 } },
  { sku: "eraser_5", title: "5 Erasers", description: "5 x eraser", starsAmount: 40, contents: { eraser: 5 } },
  { sku: "rocket_3", title: "3 Rockets", description: "3 x rocket", starsAmount: 45, contents: { rocket: 3 } },
  { sku: "bomb_3", title: "3 Bombs", description: "3 x bomb", starsAmount: 60, contents: { bomb: 3 } },
  { sku: "fill_1", title: "1 Fill", description: "1 x fill", starsAmount: 50, contents: { fill: 1 } },
  {
    sku: "toolbox",
    title: "Toolbox",
    description: "5 pencil, 5 eraser, 3 rocket, 3 bomb, 1 fill",
    starsAmount: 150,
    contents: { pencil: 5, eraser: 5, rocket: 3, bomb: 3, fill: 1 },
  },
  {
    sku: "revive",
    title: "Revive",
    description: "Continue a dead run once",
    starsAmount: 30,
    contents: {}, // not an inventory grant — see the invoice/payment handlers
  },
] as const;

export async function seedShopSkus(db: ReturnType<typeof drizzle>): Promise<void> {
  for (const row of [...STARTING_SKUS, ...THEME_SKUS]) {
    await db
      .insert(shopSkus)
      .values(row)
      .onConflictDoUpdate({
        target: shopSkus.sku,
        set: { title: row.title, description: row.description, starsAmount: row.starsAmount, contents: row.contents },
      });
  }
}
