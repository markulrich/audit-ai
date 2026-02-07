import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runPipeline } from "./pipeline.js";

// Validate API key at startup (exits if missing)
import "./anthropic-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const MAX_QUERY_LENGTH = 5000;

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

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });

  // Track client disconnect so we can abort the pipeline
  let aborted = false;
  req.on("close", () => {
    aborted = true;
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
    await runPipeline(query.trim(), send, () => aborted);
    if (!aborted) send("done", { success: true });
  } catch (err) {
    console.error("Pipeline error:", err);
    if (!aborted) {
      // Sanitize error message — never leak internals
      const safeMessage =
        err.status === 401 || err.status === 403
          ? "API authentication failed. Check your ANTHROPIC_API_KEY."
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

// SPA fallback for production
if (process.env.NODE_ENV === "production") {
  app.get("*", (req, res) => {
    res.sendFile(join(__dirname, "..", "dist", "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`DoublyAI server running on http://localhost:${PORT}`);
});
