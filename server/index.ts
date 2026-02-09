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
import { runOrchestrator } from "./orchestrator";
import { saveReport, getReport, listReports, generateSlugFromProfile } from "./storage";
import { getHealthStatus } from "./health";
import { classifyDomain } from "./agents/classifier";
import { getReasoningConfig } from "./reasoning-levels";
import {
  createJob,
  getJob,
  getLatestJobForSlug,
  startJob,
  completeJob,
  failJob,
  cancelJob,
  isJobCancelled,
  createJobSendFn,
  subscribeToJob,
  addAttachmentToJob,
  removeAttachmentFromJob,
  updateWorkLog,
  listJobs,
  summarizeJob,
} from "./jobs";
import {
  validateUpload,
  uploadAttachment,
  deleteAttachment,
} from "./attachments";
import {
  isMachinesAvailable,
  createMachine,
  waitForMachineReady,
  trackMachine,
  getMachineForJob,
  destroyMachine,
} from "./machines";

import "./anthropic-client";

import type {
  PipelineError,
  SendFn,
  Report,
  ChatMessage,
  DomainProfile,
  TraceData,
  Attachment,
  ErrorInfo,
} from "../shared/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const MAX_QUERY_LENGTH = 5000;
const MAX_ATTACHMENTS_PER_REPORT = 10;

/** Safely serialize data for SSE (JSON.stringify + ensure no bare newlines break the protocol) */
function sseSerialize(data: unknown): string {
  const json = JSON.stringify(data);
  // SSE protocol: data lines are separated by \n, so we must ensure the JSON is on a single line
  // JSON.stringify already handles this but be safe against edge cases
  return json.replace(/\n/g, "\\n");
}

// Track concurrent uploads per slug to prevent abuse
const activeUploads = new Map<string, number>();

// Request timeout for non-SSE API endpoints (30 seconds)
const API_TIMEOUT_MS = 30_000;

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: "100kb" }));

// Raw body parsing for attachment uploads (up to 20MB)
app.use("/api/reports/:slug/attachments", express.raw({ type: "*/*", limit: "20mb" }));

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

  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return res.status(400).json({ error: "Query must be at least 3 characters" });
  }
  if ((query as string).length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: `Query too long (max ${MAX_QUERY_LENGTH} chars)` });
  }

  try {
    const config = getReasoningConfig(reasoningLevel ?? "x-light");

    // Add timeout to classify call to prevent indefinite hanging
    const classifierResult = await Promise.race([
      classifyDomain(query.trim(), undefined, config),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error("Classification timed out"), { status: 504 })), API_TIMEOUT_MS)
      ),
    ]);

    const domainProfile = classifierResult.result;
    const trace = classifierResult.trace;
    const slug = generateSlugFromProfile(domainProfile.ticker, domainProfile.companyName);

    res.json({ slug, domainProfile, trace });
  } catch (thrown: unknown) {
    const err = thrown as PipelineError;
    console.error("Classify error:", err);

    const message = err.keyMissing
      ? "ANTHROPIC_API_KEY is not set."
      : err.status === 504
      ? "Classification timed out. Please try again."
      : err.status === 401 || err.status === 403
      ? `API key rejected (HTTP ${err.status}).`
      : err.status === 429
      ? "Rate limit hit. Please wait and try again."
      : `Classification failed: ${err.message || "Unknown error"}`;

    res.status(err.status && err.status >= 400 ? err.status : 500).json({ error: message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// NEW: Job-based report generation (background processing with agent skills)
// ══════════════════════════════════════════════════════════════════════════════

// ── Create a new report job ──────────────────────────────────────────────────

app.post("/api/jobs", rateLimit, async (req: Request, res: Response) => {
  const {
    query,
    slug,
    reasoningLevel,
    conversationId,
    messageHistory,
    previousReport,
    domainProfile: reqDomainProfile,
    classifierTrace: reqClassifierTrace,
  } = req.body as {
    query: unknown;
    slug?: string;
    reasoningLevel?: string;
    conversationId?: string;
    messageHistory?: Array<{ role: string; content: string }>;
    previousReport?: Report | null;
    domainProfile?: DomainProfile;
    classifierTrace?: TraceData;
  };

  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return res.status(400).json({ error: "Query must be at least 3 characters" });
  }
  if ((query as string).length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: `Query too long (max ${MAX_QUERY_LENGTH} chars)` });
  }

  // Validate slug if provided
  if (slug && !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Invalid slug format — must be lowercase alphanumeric with dashes" });
  }

  // Validate reasoning level if provided
  const VALID_REASONING_LEVELS = ["x-light", "light", "heavy", "x-heavy"];
  if (reasoningLevel && !VALID_REASONING_LEVELS.includes(reasoningLevel)) {
    return res.status(400).json({ error: `Invalid reasoning level. Must be one of: ${VALID_REASONING_LEVELS.join(", ")}` });
  }

  // Use provided slug or generate one
  const reportSlug = slug || `report-${Date.now().toString(36)}`;

  const conversationContext = conversationId
    ? {
        conversationId,
        previousReport: previousReport || null,
        messageHistory: Array.isArray(messageHistory) ? messageHistory.slice(-10) : [],
      }
    : undefined;

  const preClassified = reqDomainProfile
    ? { domainProfile: reqDomainProfile, trace: reqClassifierTrace || {} }
    : undefined;

  // Create the job
  const job = createJob({
    slug: reportSlug,
    query: (query as string).trim(),
    reasoningLevel: reasoningLevel || "x-light",
    conversationContext,
  });

  // Start the job in the background (does NOT block the response)
  runJobInBackground(job.jobId, preClassified);

  res.status(201).json({
    jobId: job.jobId,
    slug: reportSlug,
    status: job.status,
  });
});

/**
 * Run a job in the background.
 *
 * Strategy:
 * 1. If FLY_API_TOKEN is set → spin up a dedicated Fly Machine (per-report isolation)
 * 2. Otherwise → run the agent orchestrator in-process (development mode)
 *
 * Machine-based execution:
 *   - Creates a new Fly Machine with the same Docker image
 *   - Passes JOB_ID and WORKER_MODE=true as env vars
 *   - The machine runs server/worker.ts which has a Claude tool_use agent loop
 *   - Progress is persisted to S3; the main server polls for updates
 *   - Machine auto-stops when the report is complete
 */
async function runJobInBackground(
  jobId: string,
  preClassified?: { domainProfile: DomainProfile; trace: TraceData }
): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;

  // Persist job state to S3 first (worker reads from S3)
  await startJob(jobId);

  // Try machine-based execution first
  if (isMachinesAvailable()) {
    try {
      await runJobOnMachine(jobId, job.slug);
      return;
    } catch (err) {
      console.warn(
        `[job ${jobId}] Machine creation failed, falling back to in-process:`,
        (err as Error).message
      );
      // Fall through to in-process execution
    }
  }

  // In-process execution (development mode or machine unavailable)
  await runJobInProcess(jobId, preClassified);
}

/** Spin up a Fly Machine for this job */
async function runJobOnMachine(jobId: string, slug: string): Promise<void> {
  console.log(`[job ${jobId}] Spinning up dedicated machine...`);

  const send = createJobSendFn(jobId);
  send("progress", {
    stage: "provisioning",
    message: "Spinning up a dedicated machine for your report...",
    percent: 1,
  });

  const machine = await createMachine({
    jobId,
    slug,
    env: {},
  });

  trackMachine(jobId, machine.machineId);

  send("progress", {
    stage: "provisioned",
    message: `Machine ${machine.machineId} created in ${machine.region}`,
    percent: 3,
    detail: `Dedicated compute allocated. Your report will keep running even if you close this tab.`,
  });

  // Wait for the machine to be ready
  try {
    await waitForMachineReady(machine.machineId, 60_000);

    send("progress", {
      stage: "machine_ready",
      message: "Machine ready — agent starting...",
      percent: 4,
    });

    // Start polling the machine's progress via S3
    // The worker writes to S3; we poll and relay to connected clients
    pollMachineProgress(jobId, machine.machineId);
  } catch (err) {
    console.error(`[job ${jobId}] Machine failed to start:`, (err as Error).message);
    await destroyMachine(machine.machineId);
    throw err;
  }
}

/** Poll a machine's progress from S3 and relay to connected clients */
async function pollMachineProgress(
  jobId: string,
  machineId: string
): Promise<void> {
  const send = createJobSendFn(jobId);
  let lastProgressCount = 0;
  let lastTraceCount = 0;

  const poll = async () => {
    try {
      const { getJobState } = await import("./storage");
      const jobState = await getJobState(jobId);
      if (!jobState) return false;

      // Relay new progress events
      if (jobState.progress && jobState.progress.length > lastProgressCount) {
        for (let i = lastProgressCount; i < jobState.progress.length; i++) {
          send("progress", jobState.progress[i]);
        }
        lastProgressCount = jobState.progress.length;
      }

      // Relay new trace events
      if (jobState.traceEvents && jobState.traceEvents.length > lastTraceCount) {
        for (let i = lastTraceCount; i < jobState.traceEvents.length; i++) {
          send("trace", jobState.traceEvents[i]);
        }
        lastTraceCount = jobState.traceEvents.length;
      }

      // Relay work log
      if (jobState.workLog) {
        send("work_log", jobState.workLog);
        updateWorkLog(jobId, jobState.workLog);
      }

      // Check if done
      if (jobState.status === "completed" && jobState.currentReport) {
        await completeJob(jobId, jobState.currentReport);
        await destroyMachine(machineId);
        return true; // Stop polling
      }
      if (jobState.status === "failed") {
        await failJob(jobId, jobState.error || { message: "Worker failed" });
        await destroyMachine(machineId);
        return true; // Stop polling
      }

      return false; // Keep polling
    } catch (err) {
      console.warn(`[job ${jobId}] Poll error:`, (err as Error).message);
      return false;
    }
  };

  // Poll every 3 seconds
  const interval = setInterval(async () => {
    const done = await poll();
    if (done) {
      clearInterval(interval);
    }
  }, 3000);

  // Safety: stop polling after 30 minutes
  setTimeout(() => {
    clearInterval(interval);
  }, 30 * 60 * 1000);
}

/** Run the job in-process using the agent orchestrator (no machine) */
async function runJobInProcess(
  jobId: string,
  preClassified?: { domainProfile: DomainProfile; trace: TraceData }
): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;

  const send = createJobSendFn(jobId);

  try {
    const report = await runOrchestrator({
      query: job.query,
      send,
      isAborted: () => isJobCancelled(jobId), // Check for user cancellation
      reasoningLevel: job.reasoningLevel,
      conversationContext: job.conversationContext,
      preClassified,
      attachments: job.attachments,
      onProgress: (workLog) => {
        updateWorkLog(jobId, workLog);
      },
    });

    await completeJob(jobId, report);

    // Auto-save the report to S3
    try {
      await saveReport(report, job.slug);
    } catch (err) {
      console.warn(`[job ${jobId}] Auto-save failed:`, (err as Error).message);
    }
  } catch (thrown) {
    const err = thrown as PipelineError;
    console.error(`[job ${jobId}] Failed:`, err);

    const safeMessage =
      err.keyMissing
        ? "ANTHROPIC_API_KEY is not set."
        : err.status === 401 || err.status === 403
        ? `API key rejected (HTTP ${err.status}).`
        : err.status === 429
        ? `Rate limit hit during ${err.stage || "pipeline"} stage.`
        : `Pipeline failed: ${err.message || "Unknown error"}`;

    await failJob(jobId, {
      message: safeMessage,
      detail: {
        message: err.message || "Unknown error",
        stage: err.stage || "unknown",
        status: err.status || null,
        type: err.constructor?.name || "Error",
      },
    });
  }
}

// ── Get job status ───────────────────────────────────────────────────────────

app.get("/api/jobs/:jobId", async (req: Request, res: Response) => {
  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(summarizeJob(job));
});

// ── Get full job state (including report, progress, work log) ────────────────

app.get("/api/jobs/:jobId/full", async (req: Request, res: Response) => {
  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  // Return full state (excluding internal fields)
  const { listenerCount, ...state } = job;
  res.json(state);
});

// ── SSE stream for a job (reconnectable) ─────────────────────────────────────

app.get("/api/jobs/:jobId/events", async (req: Request, res: Response) => {
  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });

  // Send current state first (replay for reconnecting clients)
  const replaySend = (event: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${sseSerialize(data)}\n\n`);
    }
  };

  // Replay accumulated progress
  for (const prog of job.progress) {
    replaySend("progress", prog);
  }
  for (const trace of job.traceEvents) {
    replaySend("trace", trace);
  }
  if (job.workLog.plan.length > 0) {
    replaySend("work_log", job.workLog);
  }
  if (job.currentReport) {
    replaySend("report", job.currentReport);
  }
  if (job.error) {
    replaySend("error", job.error);
  }
  if (job.status === "completed") {
    replaySend("done", { success: true });
  }
  if (job.status === "failed") {
    replaySend("job_status", { status: "failed" });
  }

  // If job is already done, end the stream
  if (job.status === "completed" || job.status === "failed") {
    res.end();
    return;
  }

  // Subscribe to live events
  const unsubscribe = subscribeToJob(job.jobId, (msg) => {
    if (!res.writableEnded) {
      res.write(`event: ${msg.event}\ndata: ${sseSerialize(msg.data)}\n\n`);
    }

    // Close stream when job completes
    if (msg.event === "done" || (msg.event === "job_status" && (msg.data as { status: string }).status === "failed")) {
      setTimeout(() => {
        if (!res.writableEnded) res.end();
      }, 100);
    }
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": heartbeat\n\n");
    }
  }, 15_000);

  // Cleanup on disconnect
  res.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ── List all jobs ────────────────────────────────────────────────────────────

app.get("/api/jobs", (_req: Request, res: Response) => {
  res.json({ jobs: listJobs() });
});

// ── Cancel a job ─────────────────────────────────────────────────────────────

app.post("/api/jobs/:jobId/cancel", async (req: Request, res: Response) => {
  const cancelled = await cancelJob(req.params.jobId);
  if (!cancelled) {
    return res.status(400).json({ error: "Job cannot be cancelled (not found or already complete)" });
  }

  // If there's a machine, destroy it
  const machineId = getMachineForJob(req.params.jobId);
  if (machineId) {
    destroyMachine(machineId).catch(() => {});
  }

  res.json({ success: true, message: "Job cancelled" });
});

// ── Get the latest job for a report slug ─────────────────────────────────────

app.get("/api/reports/:slug/job", (req: Request, res: Response) => {
  const job = getLatestJobForSlug(req.params.slug);
  if (!job) return res.status(404).json({ error: "No job found for this report" });
  res.json(summarizeJob(job));
});

// ══════════════════════════════════════════════════════════════════════════════
// NEW: Attachments API
// ══════════════════════════════════════════════════════════════════════════════

// ── Upload an attachment to a report ─────────────────────────────────────────

app.post("/api/reports/:slug/attachments", async (req: Request, res: Response) => {
  const slug = req.params.slug;

  // Validate slug format to prevent path traversal
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Invalid slug format" });
  }

  const filename = (req.headers["x-filename"] as string) || "upload";
  const mimeType = (req.headers["content-type"] as string) || "application/octet-stream";
  const buffer = req.body as Buffer;

  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ error: "No file data received" });
  }

  // Validate
  const validation = validateUpload(filename, mimeType, buffer.length);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Check attachment count limit
  const existingJob = getLatestJobForSlug(slug);
  if (existingJob && existingJob.attachments.length >= MAX_ATTACHMENTS_PER_REPORT) {
    return res.status(400).json({
      error: `Maximum ${MAX_ATTACHMENTS_PER_REPORT} attachments per report reached`,
    });
  }

  // Concurrent upload protection (max 3 simultaneous per slug)
  const concurrent = activeUploads.get(slug) || 0;
  if (concurrent >= 3) {
    return res.status(429).json({ error: "Too many concurrent uploads. Please wait." });
  }
  activeUploads.set(slug, concurrent + 1);

  try {
    const attachment = await uploadAttachment(slug, filename, mimeType, buffer);

    // If there's an active job for this slug, add the attachment to it
    const job = getLatestJobForSlug(slug);
    if (job && (job.status === "queued" || job.status === "running")) {
      await addAttachmentToJob(job.jobId, attachment);
    }

    res.status(201).json(attachment);
  } catch (err: unknown) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to upload attachment" });
  } finally {
    const current = activeUploads.get(slug) || 1;
    if (current <= 1) {
      activeUploads.delete(slug);
    } else {
      activeUploads.set(slug, current - 1);
    }
  }
});

// ── List attachments for a report ────────────────────────────────────────────

app.get("/api/reports/:slug/attachments", (req: Request, res: Response) => {
  const job = getLatestJobForSlug(req.params.slug);
  if (!job) return res.json({ attachments: [] });
  res.json({ attachments: job.attachments });
});

// ── Delete an attachment ─────────────────────────────────────────────────────

app.delete("/api/reports/:slug/attachments/:attachmentId", async (req: Request, res: Response) => {
  const job = getLatestJobForSlug(req.params.slug);
  if (!job) return res.status(404).json({ error: "No job found for this report" });

  const attachment = job.attachments.find((a) => a.id === req.params.attachmentId);
  if (!attachment) return res.status(404).json({ error: "Attachment not found" });

  try {
    await deleteAttachment(attachment.s3Key);
    await removeAttachmentFromJob(job.jobId, attachment.id);
    res.json({ success: true });
  } catch (err: unknown) {
    console.error("Delete attachment error:", err);
    res.status(500).json({ error: "Failed to delete attachment" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// LEGACY: Original SSE endpoints (kept for backward compatibility)
// ══════════════════════════════════════════════════════════════════════════════

// ── SSE endpoint: generate an explainable report ────────────────────────────

app.post("/api/generate", rateLimit, async (req: Request, res: Response) => {
  const { query, reasoningLevel } = req.body as { query: unknown; reasoningLevel?: string };

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

  let aborted = false;
  req.on("aborted", () => {
    aborted = true;
  });
  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  const send: SendFn = (event: string, data: unknown): void => {
    if (!aborted && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${sseSerialize(data)}\n\n`);
    }
  };

  const heartbeat = setInterval(() => {
    if (!aborted && !res.writableEnded) {
      res.write(": heartbeat\n\n");
    }
  }, 15_000);

  try {
    await runPipeline(query.trim(), send, () => aborted, reasoningLevel);
    if (!aborted) send("done", { success: true });
  } catch (thrown) {
    const err = thrown as PipelineError;
    console.error("Pipeline error:", err);
    if (!aborted) {
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

      const safeMessage =
        err.keyMissing
          ? "ANTHROPIC_API_KEY is not set. Configure it on the server to enable report generation."
          : err.status === 401 || err.status === 403
          ? `ANTHROPIC_API_KEY was rejected by the API (HTTP ${err.status}). Check that it is valid.`
          : err.status === 429
          ? `Anthropic API rate limit hit during ${err.stage || "pipeline"} stage: ${err.message || "Too many requests"}. Please wait a minute and try again.`
          : err.status && err.status >= 500
          ? `Upstream API error (HTTP ${err.status}). Please try again shortly.`
          : `Pipeline failed: ${err.message || "Unknown error"}`;

      send("error", { message: safeMessage, detail });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
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

  // Input validation
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return res.status(400).json({ error: "Query must be at least 3 characters" });
  }
  if ((query as string).length > MAX_QUERY_LENGTH) {
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

  let aborted = false;
  req.on("aborted", () => {
    aborted = true;
  });
  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  const send: SendFn = (event: string, data: unknown): void => {
    if (!aborted && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${sseSerialize(data)}\n\n`);
    }
  };

  const heartbeat = setInterval(() => {
    if (!aborted && !res.writableEnded) {
      res.write(": heartbeat\n\n");
    }
  }, 15_000);

  try {
    const conversationContext = {
      conversationId: conversationId || "unknown",
      previousReport: previousReport || null,
      messageHistory: Array.isArray(messageHistory)
        ? messageHistory.slice(-10)
        : [],
    };

    const preClassified = reqDomainProfile ? { domainProfile: reqDomainProfile, trace: reqClassifierTrace || {} } : undefined;
    await runPipeline(query.trim(), send, () => aborted, reasoningLevel, conversationContext, preClassified);
    if (!aborted) send("done", { success: true });
  } catch (thrown) {
    const err = thrown as PipelineError;
    console.error("Pipeline error:", err);
    if (!aborted) {
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

      const safeMessage =
        err.keyMissing
          ? "ANTHROPIC_API_KEY is not set. Configure it on the server to enable report generation."
          : err.status === 401 || err.status === 403
          ? `ANTHROPIC_API_KEY was rejected by the API (HTTP ${err.status}). Check that it is valid.`
          : err.status === 429
          ? `Rate limit hit during ${err.stage || "pipeline"} stage. Please wait a minute and try again.`
          : err.status && err.status >= 500
          ? `Upstream API error (HTTP ${err.status}). Please try again shortly.`
          : `Pipeline failed: ${err.message || "Unknown error"}`;

      send("error", { message: safeMessage, detail });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

// ── Save / retrieve reports ─────────────────────────────────────────────────

/** Validate a report payload before saving */
function validateReportPayload(report: unknown): { valid: boolean; error?: string } {
  if (!report || typeof report !== "object") {
    return { valid: false, error: "Report must be an object" };
  }

  const r = report as Record<string, unknown>;

  if (!("meta" in r) || !r.meta || typeof r.meta !== "object") {
    return { valid: false, error: "Report must have a meta object" };
  }

  if (!("sections" in r) || !Array.isArray(r.sections)) {
    return { valid: false, error: "Report must have a sections array" };
  }

  if (!("findings" in r) || !Array.isArray(r.findings)) {
    return { valid: false, error: "Report must have a findings array" };
  }

  // Sanity check: max 200 findings (prevents oversized payloads)
  if (r.findings.length > 200) {
    return { valid: false, error: "Report has too many findings (max 200)" };
  }

  // Sanity check: max 50 sections
  if (r.sections.length > 50) {
    return { valid: false, error: "Report has too many sections (max 50)" };
  }

  return { valid: true };
}

app.post("/api/reports/save", async (req: Request, res: Response) => {
  const { report, slug, messages } = req.body as { report: unknown; slug?: string; messages?: ChatMessage[] };

  const validation = validateReportPayload(report);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Validate slug if provided
  if (slug && !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Invalid slug format" });
  }

  try {
    const result = await saveReport(report as Report, slug || undefined, messages);
    res.json(result);
  } catch (thrown: unknown) {
    const err = thrown instanceof Error ? thrown : new Error(String(thrown));
    console.error("Save error:", err);
    res.status(500).json({ error: err.message || "Failed to save report" });
  }
});

// Keep old endpoint for backward compatibility
app.post("/api/reports/publish", async (req: Request, res: Response) => {
  const { report, slug, messages } = req.body as { report: unknown; slug?: string; messages?: ChatMessage[] };

  const validation = validateReportPayload(report);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  if (slug && !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Invalid slug format" });
  }

  try {
    const result = await saveReport(report as Report, slug || undefined, messages);
    res.json(result);
  } catch (thrown: unknown) {
    const err = thrown instanceof Error ? thrown : new Error(String(thrown));
    console.error("Save error:", err);
    res.status(500).json({ error: err.message || "Failed to save report" });
  }
});

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
