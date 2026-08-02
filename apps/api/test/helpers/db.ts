import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../../src/env.js";
import { seedShopSkus } from "../../src/db/seedShop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrateTestDb(): Promise<void> {
  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: join(__dirname, "..", "..", "drizzle") });
  await seedShopSkus(db);
  await client.end();
}

export async function resetTestDb(): Promise<void> {
  const client = postgres(env.DATABASE_URL, { max: 1 });
  await client`TRUNCATE TABLE inventory_ledger, inventory_balance, purchases, daily_stats, user_achievements, runs, users RESTART IDENTITY CASCADE`;
  await client.end();
}
