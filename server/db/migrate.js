import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getPool } from "./connection.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

/**
 * Run all pending SQL migrations in order.
 * Each migration is tracked in the `migrations` table.
 * Safe to call on every startup — already-applied migrations are skipped.
 */
export async function runMigrations() {
  const pool = getPool();
  if (!pool) {
    console.log("[DB] DATABASE_URL not set — skipping migrations");
    return false;
  }

  const client = await pool.connect();
  try {
    // Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get already-applied migrations
    const { rows: applied } = await client.query(
      "SELECT name FROM migrations ORDER BY id"
    );
    const appliedSet = new Set(applied.map((r) => r.name));

    // Read migration files sorted by name
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`[DB] Applying migration: ${file}`);

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO migrations (name) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        count++;
        console.log(`[DB] Applied: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[DB] Migration failed: ${file}`, err.message);
        throw err;
      }
    }

    if (count === 0) {
      console.log("[DB] All migrations already applied");
    } else {
      console.log(`[DB] Applied ${count} migration(s)`);
    }

    return true;
  } finally {
    client.release();
  }
}
