import type { PowerupKind } from "@nonet/shared";

/**
 * Milestone drop table (§8). `nothing` scales up as items get plentiful so
 * drops keep feeling meaningful, and any item at `HARD_CAP` is pulled from
 * the pool entirely rather than left as an ever-shrinking sliver of
 * probability — a capped item should never drop again until spent, not
 * just "rarely."
 *
 * §8 doesn't pin down exact scaling numbers ("scale... as stock grows") —
 * these are a reasonable, simple interpretation and, per §20, exactly the
 * kind of constant to renegotiate once there's real playtest data.
 */
const BASE_WEIGHTS: Record<PowerupKind | "nothing", number> = {
  nothing: 30,
  pencil: 30,
  eraser: 21,
  rocket: 12,
  bomb: 6,
  fill: 1,
};

const DROPPABLE_ITEMS: readonly PowerupKind[] = ["pencil", "eraser", "rocket", "bomb", "fill"];
export const HARD_CAP = 15;
const STOCKED_THRESHOLD = 8;
const STOCKED_NOTHING_BONUS = 15;

export function rollDrop(currentInventory: Readonly<Record<string, number>>): PowerupKind | "nothing" {
  let nothingWeight = BASE_WEIGHTS.nothing;
  const pool: Array<{ item: PowerupKind; weight: number }> = [];

  for (const item of DROPPABLE_ITEMS) {
    const qty = currentInventory[item] ?? 0;
    if (qty >= HARD_CAP) continue; // fully stocked — never oversupply
    if (qty >= STOCKED_THRESHOLD) nothingWeight += STOCKED_NOTHING_BONUS;
    pool.push({ item, weight: BASE_WEIGHTS[item] });
  }

  const total = nothingWeight + pool.reduce((sum, p) => sum + p.weight, 0);
  let roll = Math.random() * total;
  for (const p of pool) {
    if (roll < p.weight) return p.item;
    roll -= p.weight;
  }
  return "nothing";
}
