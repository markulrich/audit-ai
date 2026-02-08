import pg from "pg";

const { Pool } = pg;

let pool = null;

/**
 * Returns a singleton connection pool.
 * Requires DATABASE_URL environment variable.
 * If DATABASE_URL is not set, returns null (database features disabled).
 */
export function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Fly Postgres uses internal DNS; SSL not required on internal network
    ssl: connectionString.includes("localhost") || connectionString.includes(".internal")
      ? false
      : { rejectUnauthorized: false },
  });

  pool.on("error", (err) => {
    console.error("[DB] Unexpected pool error:", err.message);
  });

  return pool;
}

/**
 * Test database connectivity. Returns true if connection succeeds.
 */
export async function testConnection() {
  const p = getPool();
  if (!p) return false;

  try {
    const result = await p.query("SELECT 1 AS ok");
    return result.rows[0]?.ok === 1;
  } catch (err) {
    console.error("[DB] Connection test failed:", err.message);
    return false;
  }
}

/**
 * Gracefully close the pool (for clean shutdown).
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
