/**
 * Job Manager — manages background report generation jobs.
 *
 * Each report gets a persistent job that runs independently of HTTP connections.
 * Jobs survive tab closes — the frontend can reconnect and pick up where it left off.
 *
 * Architecture:
 * - In-memory map of active jobs for fast access
 * - S3 persistence for job state (survives server restarts)
 * - SSE listener management for broadcasting progress to connected clients
 * - Jobs run the agent orchestrator, which uses skills to build reports
 */

import { EventEmitter } from "events";
import type {
  ReportJob,
  ReportJobSummary,
  JobStatus,
  ProgressEvent,
  TraceEvent,
  ErrorInfo,
  Report,
  DomainProfile,
  Attachment,
  AgentWorkLog,
  ConversationContext,
} from "../shared/types";
import { putJobState, getJobState } from "./storage";

// ── In-memory job store ──────────────────────────────────────────────────────

const jobs = new Map<string, ReportJob>();
const jobEmitters = new Map<string, EventEmitter>();

/** Generate a unique job ID */
export function generateJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a new report job */
export function createJob(params: {
  slug: string;
  query: string;
  reasoningLevel: string;
  attachments?: Attachment[];
  conversationContext?: ConversationContext;
}): ReportJob {
  const jobId = generateJobId();
  const now = new Date().toISOString();

  const job: ReportJob = {
    jobId,
    slug: params.slug,
    status: "queued",
    query: params.query,
    reasoningLevel: params.reasoningLevel,
    attachments: params.attachments || [],
    createdAt: now,
    updatedAt: now,
    progress: [],
    traceEvents: [],
    workLog: {
      plan: [],
      invocations: [],
      reasoning: [],
    },
    currentReport: null,
    domainProfile: null,
    conversationContext: params.conversationContext,
    error: null,
    listenerCount: 0,
  };

  jobs.set(jobId, job);
  jobEmitters.set(jobId, new EventEmitter());

  return job;
}

/** Get a job by ID (checks memory first, then S3) */
export async function getJob(jobId: string): Promise<ReportJob | null> {
  const memJob = jobs.get(jobId);
  if (memJob) return memJob;

  // Try loading from S3
  const persisted = await getJobState(jobId);
  if (persisted) {
    jobs.set(jobId, persisted);
    jobEmitters.set(jobId, new EventEmitter());
    return persisted;
  }

  return null;
}

/** Get a job by slug (searches memory) */
export function getJobBySlug(slug: string): ReportJob | null {
  for (const job of jobs.values()) {
    if (job.slug === slug) return job;
  }
  return null;
}

/** Get the most recent job for a slug */
export function getLatestJobForSlug(slug: string): ReportJob | null {
  let latest: ReportJob | null = null;
  for (const job of jobs.values()) {
    if (job.slug === slug) {
      if (!latest || job.createdAt > latest.createdAt) {
        latest = job;
      }
    }
  }
  return latest;
}

/** Update job state and persist */
export async function updateJob(
  jobId: string,
  updates: Partial<ReportJob>
): Promise<ReportJob | null> {
  const job = jobs.get(jobId);
  if (!job) return null;

  Object.assign(job, updates, { updatedAt: new Date().toISOString() });

  // Persist to S3 (fire-and-forget for non-critical updates)
  persistJob(job).catch((err) => {
    console.warn(`[jobs] Failed to persist job ${jobId}:`, err.message);
  });

  return job;
}

/** Persist job state to S3 */
async function persistJob(job: ReportJob): Promise<void> {
  try {
    await putJobState(job.jobId, job);
  } catch (err) {
    // Non-fatal — job continues in memory
    console.warn(`[jobs] S3 persist failed for ${job.jobId}:`, (err as Error).message);
  }
}

/** Broadcast an event to all listeners on a job */
export function broadcastJobEvent(
  jobId: string,
  event: string,
  data: unknown
): void {
  const emitter = jobEmitters.get(jobId);
  if (emitter) {
    emitter.emit("event", { event, data });
  }
}

/** Subscribe to job events (returns unsubscribe function) */
export function subscribeToJob(
  jobId: string,
  listener: (msg: { event: string; data: unknown }) => void
): () => void {
  let emitter = jobEmitters.get(jobId);
  if (!emitter) {
    emitter = new EventEmitter();
    jobEmitters.set(jobId, emitter);
  }

  const job = jobs.get(jobId);
  if (job) {
    job.listenerCount = (job.listenerCount || 0) + 1;
  }

  emitter.on("event", listener);

  return () => {
    emitter!.off("event", listener);
    if (job) {
      job.listenerCount = Math.max(0, (job.listenerCount || 1) - 1);
    }
  };
}

/** Create a SendFn that broadcasts to job listeners AND accumulates progress */
export function createJobSendFn(jobId: string): (event: string, data: unknown) => void {
  return (event: string, data: unknown) => {
    const job = jobs.get(jobId);
    if (!job) return;

    // Accumulate progress and trace events
    if (event === "progress") {
      job.progress.push(data as ProgressEvent);
    } else if (event === "trace") {
      job.traceEvents.push(data as TraceEvent);
    } else if (event === "report") {
      job.currentReport = data as Report;
    } else if (event === "error") {
      job.error = data as ErrorInfo;
    }

    job.updatedAt = new Date().toISOString();

    // Broadcast to all connected listeners
    broadcastJobEvent(jobId, event, data);
  };
}

/** Mark a job as running */
export async function startJob(jobId: string): Promise<void> {
  await updateJob(jobId, { status: "running" });
  broadcastJobEvent(jobId, "job_status", { status: "running" });
}

/** Mark a job as completed */
export async function completeJob(
  jobId: string,
  report: Report
): Promise<void> {
  await updateJob(jobId, {
    status: "completed",
    completedAt: new Date().toISOString(),
    currentReport: report,
  });
  broadcastJobEvent(jobId, "job_status", { status: "completed" });
  broadcastJobEvent(jobId, "done", { success: true });
}

/** Mark a job as failed */
export async function failJob(
  jobId: string,
  error: ErrorInfo
): Promise<void> {
  await updateJob(jobId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
  });
  broadcastJobEvent(jobId, "job_status", { status: "failed" });
  broadcastJobEvent(jobId, "error", error);
}

/** Add attachment metadata to a job */
export async function addAttachmentToJob(
  jobId: string,
  attachment: Attachment
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  job.attachments.push(attachment);
  await updateJob(jobId, { attachments: job.attachments });
  broadcastJobEvent(jobId, "attachment_added", attachment);
}

/** Remove attachment from a job */
export async function removeAttachmentFromJob(
  jobId: string,
  attachmentId: string
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  job.attachments = job.attachments.filter((a) => a.id !== attachmentId);
  await updateJob(jobId, { attachments: job.attachments });
  broadcastJobEvent(jobId, "attachment_removed", { id: attachmentId });
}

/** Update the agent work log */
export function updateWorkLog(
  jobId: string,
  workLog: Partial<AgentWorkLog>
): void {
  const job = jobs.get(jobId);
  if (!job) return;

  if (workLog.plan) job.workLog.plan = workLog.plan;
  if (workLog.invocations) job.workLog.invocations = workLog.invocations;
  if (workLog.reasoning) job.workLog.reasoning = workLog.reasoning;

  broadcastJobEvent(jobId, "work_log", job.workLog);
}

/** Get a summary of a job (lightweight, for listing) */
export function summarizeJob(job: ReportJob): ReportJobSummary {
  const lastProgress = job.progress[job.progress.length - 1];
  return {
    jobId: job.jobId,
    slug: job.slug,
    status: job.status,
    query: job.query,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    progress: lastProgress?.percent ?? 0,
    attachmentCount: job.attachments.length,
    hasReport: !!job.currentReport,
  };
}

/** List all jobs (from memory) */
export function listJobs(): ReportJobSummary[] {
  return Array.from(jobs.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(summarizeJob);
}

/** Clean up completed jobs older than maxAgeMs from memory (they remain in S3) */
export function cleanupOldJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
  const cutoff = Date.now() - maxAgeMs;
  for (const [jobId, job] of jobs) {
    if (
      (job.status === "completed" || job.status === "failed") &&
      new Date(job.updatedAt).getTime() < cutoff &&
      (job.listenerCount || 0) === 0
    ) {
      jobs.delete(jobId);
      jobEmitters.get(jobId)?.removeAllListeners();
      jobEmitters.delete(jobId);
    }
  }
}

/** Cancel a running or queued job */
export async function cancelJob(jobId: string): Promise<boolean> {
  const job = jobs.get(jobId);
  if (!job) return false;

  if (job.status !== "queued" && job.status !== "running") {
    return false; // Can only cancel active jobs
  }

  await updateJob(jobId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error: { message: "Job cancelled by user" },
  });

  broadcastJobEvent(jobId, "job_status", { status: "failed" });
  broadcastJobEvent(jobId, "error", { message: "Job cancelled by user" });

  return true;
}

/** Check if a job has been cancelled */
export function isJobCancelled(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return true;
  return job.status === "failed" && job.error?.message === "Job cancelled by user";
}

// Run cleanup every hour
setInterval(() => cleanupOldJobs(), 60 * 60 * 1000);
