import { getPool } from "./connection.js";

/**
 * Storage layer for conversations, reports, and artifacts.
 * All functions are no-ops when DATABASE_URL is not configured,
 * allowing the app to run without a database for local dev.
 */

// ── Conversations ────────────────────────────────────────────────────────────

export async function createConversation({ query, domain, ticker, companyName }) {
  const pool = getPool();
  if (!pool) return null;

  const { rows } = await pool.query(
    `INSERT INTO conversations (query, domain, ticker, company_name, status)
     VALUES ($1, $2, $3, $4, 'running')
     RETURNING id, created_at`,
    [query, domain || null, ticker || null, companyName || null]
  );
  return rows[0];
}

export async function updateConversation(id, { domain, ticker, companyName, status, errorMessage }) {
  const pool = getPool();
  if (!pool) return;

  const fields = [];
  const values = [];
  let paramIndex = 1;

  if (domain !== undefined) {
    fields.push(`domain = $${paramIndex++}`);
    values.push(domain);
  }
  if (ticker !== undefined) {
    fields.push(`ticker = $${paramIndex++}`);
    values.push(ticker);
  }
  if (companyName !== undefined) {
    fields.push(`company_name = $${paramIndex++}`);
    values.push(companyName);
  }
  if (status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(status);
  }
  if (errorMessage !== undefined) {
    fields.push(`error_message = $${paramIndex++}`);
    values.push(errorMessage);
  }

  if (fields.length === 0) return;

  fields.push(`updated_at = NOW()`);
  values.push(id);

  await pool.query(
    `UPDATE conversations SET ${fields.join(", ")} WHERE id = $${paramIndex}`,
    values
  );
}

export async function getConversation(id) {
  const pool = getPool();
  if (!pool) return null;

  const { rows } = await pool.query(
    "SELECT * FROM conversations WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

// ── Reports ──────────────────────────────────────────────────────────────────

export async function saveReport(conversationId, report) {
  const pool = getPool();
  if (!pool) return null;

  const title = report.meta?.title || null;
  const rating = report.meta?.rating || null;
  const ticker = report.meta?.ticker || null;
  const overallCertainty = report.meta?.overallCertainty || null;
  const findingsCount = report.findings?.length || 0;

  const { rows } = await pool.query(
    `INSERT INTO reports (conversation_id, report_json, title, rating, ticker, overall_certainty, findings_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [conversationId, JSON.stringify(report), title, rating, ticker, overallCertainty, findingsCount]
  );
  return rows[0];
}

export async function getReport(id) {
  const pool = getPool();
  if (!pool) return null;

  const { rows } = await pool.query(
    `SELECT r.*, c.query, c.domain
     FROM reports r
     JOIN conversations c ON c.id = r.conversation_id
     WHERE r.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function getReportByConversation(conversationId) {
  const pool = getPool();
  if (!pool) return null;

  const { rows } = await pool.query(
    "SELECT * FROM reports WHERE conversation_id = $1",
    [conversationId]
  );
  return rows[0] || null;
}

export async function listReports({ limit = 20, offset = 0 } = {}) {
  const pool = getPool();
  if (!pool) return { reports: [], total: 0 };

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT r.id, r.title, r.rating, r.ticker, r.overall_certainty, r.findings_count,
              r.created_at, c.query, c.domain
       FROM reports r
       JOIN conversations c ON c.id = r.conversation_id
       WHERE c.status = 'completed'
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM reports r
       JOIN conversations c ON c.id = r.conversation_id
       WHERE c.status = 'completed'`
    ),
  ]);

  return { reports: rows, total: countRows[0]?.total || 0 };
}

export async function deleteReport(id) {
  const pool = getPool();
  if (!pool) return false;

  // Also deletes conversation and artifacts via CASCADE
  const { rows } = await pool.query(
    `DELETE FROM conversations WHERE id = (
       SELECT conversation_id FROM reports WHERE id = $1
     ) RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

// ── Artifacts ────────────────────────────────────────────────────────────────

export async function saveArtifact(conversationId, stage, data) {
  const pool = getPool();
  if (!pool) return null;

  const { rows } = await pool.query(
    `INSERT INTO artifacts (conversation_id, stage, artifact_json)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [conversationId, stage, JSON.stringify(data)]
  );
  return rows[0];
}

export async function getArtifacts(conversationId) {
  const pool = getPool();
  if (!pool) return [];

  const { rows } = await pool.query(
    `SELECT * FROM artifacts WHERE conversation_id = $1 ORDER BY created_at`,
    [conversationId]
  );
  return rows;
}
