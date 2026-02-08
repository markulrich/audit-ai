process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err.message, err.stack);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  process.exit(1);
});

import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runPipeline } from "./pipeline.js";
import { testConnection, closePool } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import {
  createConversation,
  updateConversation,
  listReports,
  getReport,
  deleteReport,
} from "./db/storage.js";

import "./anthropic-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const MAX_QUERY_LENGTH = 5000;

// Track whether database is available (set during startup)
let dbAvailable = false;

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: "100kb" }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
        ip: req.ip,
      })
    );
  });
  next();
});

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// Simple in-memory rate limiter (no extra dependency)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 min
const RATE_LIMIT_MAX = 10; // max requests per window

function rateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: `Rate limit exceeded. Max ${RATE_LIMIT_MAX} reports per 15 minutes.`,
    });
  }
  return next();
}

// Clean up stale entries every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(key);
  }
}, 30 * 60 * 1000);

// In production, serve the built React app
if (process.env.NODE_ENV === "production") {
  app.use(express.static(join(__dirname, "..", "dist")));
}

// ── SSE endpoint: generate an explainable report ────────────────────────────

app.post("/api/generate", rateLimit, async (req, res) => {
  const { query } = req.body;

  // Input validation
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return res.status(400).json({ error: "Query must be at least 3 characters" });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: `Query too long (max ${MAX_QUERY_LENGTH} chars)` });
  }

  // Create conversation record if DB is available
  let conversationId = null;
  if (dbAvailable) {
    try {
      const conv = await createConversation({ query: query.trim() });
      conversationId = conv?.id || null;
    } catch (err) {
      console.error("[DB] Failed to create conversation:", err.message);
      // Continue without persistence — don't block report generation
    }
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });

  // Track true client disconnects so we can abort the pipeline.
  // Do not rely on req.close for POST bodies; that can fire after request read.
  let aborted = false;
  req.on("aborted", () => {
    aborted = true;
  });
  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  const send = (event, data) => {
    if (!aborted && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Heartbeat to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    if (!aborted && !res.writableEnded) {
      res.write(": heartbeat\n\n");
    }
  }, 15_000);

  try {
    await runPipeline(query.trim(), send, () => aborted, conversationId);
    if (!aborted) send("done", { success: true });
  } catch (err) {
    console.error("Pipeline error:", err);

    // Mark conversation as failed
    if (conversationId) {
      updateConversation(conversationId, {
        status: "failed",
        errorMessage: err.message,
      }).catch((e) => console.error("[DB] Failed to update conversation:", e.message));
    }

    if (!aborted) {
      // Sanitize error message — never leak internals
      const safeMessage =
        err.keyMissing
          ? "ANTHROPIC_API_KEY is not set. Configure it on the server to enable report generation."
          : err.status === 401 || err.status === 403
          ? "ANTHROPIC_API_KEY is set but was rejected by the API. Check that it is valid."
          : err.status === 429
          ? "API rate limit hit. Please wait a minute and try again."
          : err.status >= 500
          ? "Upstream API error. Please try again shortly."
          : "Report generation failed. Please try a different query.";
      send("error", { message: safeMessage });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

// ── Report history API ──────────────────────────────────────────────────────

app.get("/api/reports", async (req, res) => {
  if (!dbAvailable) {
    return res.json({ reports: [], total: 0 });
  }

  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const result = await listReports({ limit, offset });
    res.json(result);
  } catch (err) {
    console.error("[API] Failed to list reports:", err.message);
    res.status(500).json({ error: "Failed to retrieve reports" });
  }
});

app.get("/api/reports/:id", async (req, res) => {
  if (!dbAvailable) {
    return res.status(404).json({ error: "Report not found" });
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid report ID" });
  }

  try {
    const report = await getReport(req.params.id);
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }
    res.json(report);
  } catch (err) {
    console.error("[API] Failed to get report:", err.message);
    res.status(500).json({ error: "Failed to retrieve report" });
  }
});

app.delete("/api/reports/:id", async (req, res) => {
  if (!dbAvailable) {
    return res.status(404).json({ error: "Report not found" });
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid report ID" });
  }

  try {
    const deleted = await deleteReport(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Report not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[API] Failed to delete report:", err.message);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

// Health check endpoint
app.get("/api/health", async (req, res) => {
  res.json({
    status: "ok",
    database: dbAvailable ? "connected" : "unavailable",
  });
});

// SPA fallback for production
if (process.env.NODE_ENV === "production") {
  app.get("*", (req, res) => {
    res.sendFile(join(__dirname, "..", "dist", "index.html"));
  });
}

// ── Startup ─────────────────────────────────────────────────────────────────

async function start() {
  // Initialize database (non-blocking — app works without it)
  if (process.env.DATABASE_URL) {
    try {
      const connected = await testConnection();
      if (connected) {
        await runMigrations();
        dbAvailable = true;
        console.log("[DB] PostgreSQL connected and migrations applied");
      } else {
        console.warn("[DB] Could not connect to PostgreSQL — running without persistence");
      }
    } catch (err) {
      console.warn("[DB] Database initialization failed:", err.message);
      console.warn("[DB] Running without persistence");
    }
  } else {
    console.log("[DB] DATABASE_URL not set — running without persistence");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`DoublyAI server running on http://0.0.0.0:${PORT}`);
  }).on("error", (err) => {
    console.error("LISTEN ERROR:", err.message, err.code);
    process.exit(1);
  });
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[SHUTDOWN] SIGTERM received, closing pool...");
  await closePool();
  process.exit(0);
});

start();
