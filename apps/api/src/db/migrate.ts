/**
 * Runs pending drizzle migrations, wrapped in a Postgres advisory lock so
 * that when multiple API replicas start concurrently (a fresh deploy scaling
 * up, say), only one of them actually runs the migration — the rest block on
 * the lock, see the schema is already current, and proceed (§18).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { env } from "../env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Arbitrary fixed 64-bit key, scoped to this app — any two processes calling
// pg_advisory_lock with the same key serialise against each other. Passed as
// a numeric string + explicit cast since postgres.js's tagged-template typing
// doesn't accept a raw bigint parameter.
const MIGRATION_LOCK_KEY = (0x4e4f4e45_54313233n).toString(); // "NONET123" as a rough mnemonic

async function main() {
  const client = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await client`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`;
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: join(__dirname, "..", "..", "drizzle") });
    console.log("migrations applied");
  } finally {
    await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
    await client.end();
  }
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
