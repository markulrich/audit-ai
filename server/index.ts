process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err.message, err.stack);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  process.exit(1);
});

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runPipeline } from "./pipeline";
import { saveReport, getReport, listReports, generateSlugFromProfile } from "./storage";
import { getHealthStatus } from "./health";
import { classifyDomain } from "./agents/classifier";
import { getReasoningConfig } from "./reasoning-levels";

import "./anthropic-client";

import type { PipelineError, SendFn, Report, ChatMessage, DomainProfile, TraceData } from "../shared/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const MAX_QUERY_LENGTH = 5000;

// ── Middleware ───────────────────────────────────────────────────────────────

// Trust the first proxy (fly.io) so req.ip reflects the real client IP
app.set("trust proxy", 1);

app.use(express.json({ limit: "5mb" }));

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
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  next();
});

// Simple in-memory rate limiter (no extra dependency)
const rateLimitMap = new Map<string, { windowStart: number; count: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 min
const RATE_LIMIT_MAX = 10; // max requests per window

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    res.status(429).json({
      error: `Rate limit exceeded. Max ${RATE_LIMIT_MAX} reports per 15 minutes.`,
    });
    return;
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

// ── Health check endpoint ────────────────────────────────────────────────────

app.get("/api/health", async (_req: Request, res: Response) => {
  try {
    const health = await getHealthStatus();
    const statusCode = health.status === "healthy" ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (err: unknown) {
    console.error("Health check error:", err);
    res.status(500).json({ status: "unhealthy", error: "Health check failed" });
  }
});

// ── Classify endpoint: runs only the classifier and generates a slug ─────────

app.post("/api/classify", rateLimit, async (req: Request, res: Response) => {
  const { query, reasoningLevel } = req.body as { query: unknown; reasoningLevel?: string };

  const validated = validateQuery(query);
  if ("error" in validated) return res.status(400).json({ error: validated.error });

  try {
    const config = getReasoningConfig(reasoningLevel ?? "x-light");
    const classifierResult = await classifyDomain(validated.query, undefined, config);
    const domainProfile = classifierResult.result;
    const trace = classifierResult.trace;
    const slug = generateSlugFromProfile(domainProfile.ticker, domainProfile.companyName);

    res.json({ slug, domainProfile, trace });
  } catch (thrown: unknown) {
    const err = thrown as PipelineError;
    console.error("Classify error:", err);

    const message = err.keyMissing
      ? "ANTHROPIC_API_KEY is not set."
      : err.status === 401 || err.status === 403
      ? `API key rejected (HTTP ${err.status}).`
      : err.status === 429
      ? "Rate limit hit. Please wait and try again."
      : `Classification failed: ${err.message || "Unknown error"}`;

    res.status(err.status && err.status >= 400 ? err.status : 500).json({ error: message });
  }
});

// ── SSE helpers ─────────────────────────────────────────────────────────────

/** Set up an SSE connection with abort tracking and heartbeat. */
function initSSE(req: Request, res: Response): { send: SendFn; isAborted: () => boolean; cleanup: () => void } {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });

  let aborted = false;
  req.on("aborted", () => { aborted = true; });
  res.on("close", () => { if (!res.writableEnded) aborted = true; });

  const send: SendFn = (event: string, data: unknown): void => {
    if (!aborted && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const heartbeat = setInterval(() => {
    if (!aborted && !res.writableEnded) {
      res.write(": heartbeat\n\n");
    }
  }, 15_000);

  return {
    send,
    isAborted: () => aborted,
    cleanup: () => {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
}

/** Format a pipeline error into a safe user-facing message with debug detail. */
function formatPipelineError(err: PipelineError): { message: string; detail: object } {
  const detail = {
    message: err.message || "Unknown error",
    stage: err.stage || "unknown",
    status: err.status || null,
    type: err.constructor?.name || "Error",
    rawOutputPreview: err.rawOutput ? err.rawOutput.slice(0, 500) + (err.rawOutput.length > 500 ? "..." : "") : null,
    stopReason: err.agentTrace?.response?.stop_reason || null,
    tokenUsage: err.agentTrace?.response?.usage || null,
    durationMs: err.agentTrace?.timing?.durationMs || null,
  };

  const message =
    err.keyMissing
      ? "ANTHROPIC_API_KEY is not set. Configure it on the server to enable report generation."
      : err.status === 401 || err.status === 403
      ? `ANTHROPIC_API_KEY was rejected by the API (HTTP ${err.status}). Check that it is valid.`
      : err.status === 429
      ? `Anthropic API rate limit hit during ${err.stage || "pipeline"} stage. Please wait a minute and try again.`
      : err.status && err.status >= 500
      ? `Upstream API error (HTTP ${err.status}). Please try again shortly.`
      : `Pipeline failed: ${err.message || "Unknown error"}`;

  return { message, detail };
}

/** Validate a query from a request body. Returns { query } on success or { error } on failure. */
function validateQuery(query: unknown): { query: string } | { error: string } {
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return { error: "Query must be at least 3 characters" };
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return { error: `Query too long (max ${MAX_QUERY_LENGTH} chars)` };
  }
  return { query: query.trim() };
}

// ── SSE endpoint: generate an explainable report ────────────────────────────

app.post("/api/generate", rateLimit, async (req: Request, res: Response) => {
  const { query, reasoningLevel } = req.body as { query: unknown; reasoningLevel?: string };

  const validated = validateQuery(query);
  if ("error" in validated) return res.status(400).json({ error: validated.error });

  const { send, isAborted, cleanup } = initSSE(req, res);

  try {
    await runPipeline(validated.query, send, isAborted, reasoningLevel);
    if (!isAborted()) send("done", { success: true });
  } catch (thrown) {
    const err = thrown as PipelineError;
    console.error("Pipeline error:", err);
    if (!isAborted()) {
      const { message, detail } = formatPipelineError(err);
      send("error", { message, detail });
    }
  } finally {
    cleanup();
  }
});

// ── SSE endpoint: chat-based report generation ──────────────────────────────

app.post("/api/chat", rateLimit, async (req: Request, res: Response) => {
  const { query, conversationId, messageHistory, previousReport, reasoningLevel, domainProfile: reqDomainProfile, classifierTrace: reqClassifierTrace } = req.body as {
    query: unknown;
    conversationId?: string;
    messageHistory?: Array<{ role: string; content: string }>;
    previousReport?: Report | null;
    reasoningLevel?: string;
    domainProfile?: DomainProfile;
    classifierTrace?: TraceData;
  };

  const validated = validateQuery(query);
  if ("error" in validated) return res.status(400).json({ error: validated.error });

  const { send, isAborted, cleanup } = initSSE(req, res);

  try {
    const conversationContext = {
      conversationId: conversationId || "unknown",
      previousReport: previousReport || null,
      messageHistory: Array.isArray(messageHistory)
        ? messageHistory.slice(-10)
        : [],
    };

    const preClassified = reqDomainProfile ? { domainProfile: reqDomainProfile, trace: reqClassifierTrace || {} } : undefined;
    await runPipeline(validated.query, send, isAborted, reasoningLevel, conversationContext, preClassified);
    if (!isAborted()) send("done", { success: true });
  } catch (thrown) {
    const err = thrown as PipelineError;
    console.error("Pipeline error:", err);
    if (!isAborted()) {
      const { message, detail } = formatPipelineError(err);
      send("error", { message, detail });
    }
  } finally {
    cleanup();
  }
});

// ── Save / retrieve reports ─────────────────────────────────────────────────

async function handleSaveReport(req: Request, res: Response): Promise<void> {
  const { report, slug, messages } = req.body as { report: unknown; slug?: string; messages?: ChatMessage[] };

  if (!report || typeof report !== "object" || !("meta" in report) || !("sections" in report) || !Array.isArray((report as Record<string, unknown>).sections) || !Array.isArray((report as Record<string, unknown>).findings)) {
    res.status(400).json({ error: "Invalid report payload" });
    return;
  }

  try {
    const result = await saveReport(report as Report, slug || undefined, messages);
    res.json(result);
  } catch (thrown: unknown) {
    const err = thrown instanceof Error ? thrown : new Error(String(thrown));
    console.error("Save error:", err);
    res.status(500).json({ error: err.message || "Failed to save report" });
  }
}

app.post("/api/reports/save", handleSaveReport);
app.post("/api/reports/publish", handleSaveReport); // legacy alias

app.get("/api/reports", async (_req: Request, res: Response) => {
  try {
    const reports = await listReports();
    res.json({ reports });
  } catch (err: unknown) {
    console.error("List reports error:", err);
    res.status(500).json({ error: "Failed to list reports" });
  }
});

app.get("/api/reports/:slug", async (req: Request, res: Response) => {
  const slug = req.params.slug as string;
  const version = req.query.v ? parseInt(req.query.v as string, 10) : undefined;

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Invalid slug" });
  }

  try {
    const data = await getReport(slug, version);
    if (!data) return res.status(404).json({ error: "Report not found" });
    res.json(data);
  } catch (err: unknown) {
    console.error("Retrieve error:", err);
    res.status(500).json({ error: "Failed to retrieve report" });
  }
});

// SPA fallback for production
if (process.env.NODE_ENV === "production") {
  app.get("*", (req, res) => {
    res.sendFile(join(__dirname, "..", "dist", "index.html"));
  });
}

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`DoublyAI server running on http://0.0.0.0:${PORT}`);
}).on("error", (err: NodeJS.ErrnoException) => {
  console.error("LISTEN ERROR:", err.message, err.code);
  process.exit(1);
});
