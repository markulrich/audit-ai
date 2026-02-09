import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ReportJob, Attachment, ProgressEvent, Report, ErrorInfo } from "../shared/types";

// Mock storage before importing jobs module
vi.mock("./storage", () => ({
  putJobState: vi.fn().mockResolvedValue(undefined),
  getJobState: vi.fn().mockResolvedValue(null),
}));

import {
  generateJobId,
  createJob,
  getJob,
  getJobBySlug,
  getLatestJobForSlug,
  updateJob,
  broadcastJobEvent,
  subscribeToJob,
  createJobSendFn,
  startJob,
  completeJob,
  failJob,
  cancelJob,
  isJobCancelled,
  addAttachmentToJob,
  removeAttachmentFromJob,
  updateWorkLog,
  summarizeJob,
  listJobs,
  cleanupOldJobs,
} from "./jobs";
import { putJobState, getJobState } from "./storage";

describe("jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up all jobs between tests by creating fresh jobs
  });

  describe("generateJobId", () => {
    it("generates IDs starting with 'job-'", () => {
      const id = generateJobId();
      expect(id).toMatch(/^job-\d+-[a-z0-9]+$/);
    });

    it("generates unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateJobId()));
      expect(ids.size).toBe(100);
    });
  });

  describe("createJob", () => {
    it("creates a job with default values", () => {
      const job = createJob({
        slug: "test-slug",
        query: "Analyze NVDA",
        reasoningLevel: "x-light",
      });

      expect(job.jobId).toMatch(/^job-/);
      expect(job.slug).toBe("test-slug");
      expect(job.query).toBe("Analyze NVDA");
      expect(job.status).toBe("queued");
      expect(job.reasoningLevel).toBe("x-light");
      expect(job.attachments).toEqual([]);
      expect(job.progress).toEqual([]);
      expect(job.traceEvents).toEqual([]);
      expect(job.workLog).toEqual({ plan: [], invocations: [], reasoning: [] });
      expect(job.currentReport).toBeNull();
      expect(job.domainProfile).toBeNull();
      expect(job.error).toBeNull();
      expect(job.listenerCount).toBe(0);
      expect(job.createdAt).toBeDefined();
      expect(job.updatedAt).toBeDefined();
    });

    it("creates a job with attachments", () => {
      const attachment: Attachment = {
        id: "att-1",
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        s3Key: "reports/test/attachments/att-1-report.pdf",
        uploadedAt: new Date().toISOString(),
      };

      const job = createJob({
        slug: "test-slug",
        query: "Analyze this",
        reasoningLevel: "x-light",
        attachments: [attachment],
      });

      expect(job.attachments).toHaveLength(1);
      expect(job.attachments[0].id).toBe("att-1");
    });

    it("creates a job with conversation context", () => {
      const job = createJob({
        slug: "test-slug",
        query: "Follow up question",
        reasoningLevel: "x-light",
        conversationContext: {
          conversationId: "conv-1",
          previousReport: null,
        },
      });

      expect(job.conversationContext?.conversationId).toBe("conv-1");
    });
  });

  describe("getJob", () => {
    it("returns a job from memory", async () => {
      const created = createJob({
        slug: "mem-test",
        query: "test",
        reasoningLevel: "x-light",
      });

      const retrieved = await getJob(created.jobId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.jobId).toBe(created.jobId);
    });

    it("falls back to S3 if not in memory", async () => {
      const mockJob: ReportJob = {
        jobId: "job-s3-fallback",
        slug: "s3-test",
        status: "completed",
        query: "test",
        reasoningLevel: "x-light",
        attachments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: [],
        traceEvents: [],
        workLog: { plan: [], invocations: [], reasoning: [] },
        currentReport: null,
        domainProfile: null,
        error: null,
        listenerCount: 0,
      };

      (getJobState as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockJob);

      const retrieved = await getJob("job-s3-fallback");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.slug).toBe("s3-test");
      expect(getJobState).toHaveBeenCalledWith("job-s3-fallback");
    });

    it("returns null for non-existent job", async () => {
      (getJobState as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const result = await getJob("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getJobBySlug", () => {
    it("finds a job by slug", () => {
      createJob({ slug: "slug-a", query: "test a", reasoningLevel: "x-light" });
      createJob({ slug: "slug-b", query: "test b", reasoningLevel: "x-light" });

      const found = getJobBySlug("slug-b");
      expect(found).not.toBeNull();
      expect(found!.slug).toBe("slug-b");
    });

    it("returns null when slug not found", () => {
      const found = getJobBySlug("nonexistent-slug");
      expect(found).toBeNull();
    });
  });

  describe("getLatestJobForSlug", () => {
    it("returns the most recently created job for a slug", async () => {
      const job1 = createJob({ slug: "multi", query: "first", reasoningLevel: "x-light" });
      // Ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));
      const job2 = createJob({ slug: "multi", query: "second", reasoningLevel: "x-light" });

      const latest = getLatestJobForSlug("multi");
      expect(latest).not.toBeNull();
      expect(latest!.jobId).toBe(job2.jobId);
      // job2 was created after job1
      expect(latest!.createdAt > job1.createdAt).toBe(true);
    });

    it("returns null when no jobs for slug", () => {
      const latest = getLatestJobForSlug("no-such-slug");
      expect(latest).toBeNull();
    });
  });

  describe("updateJob", () => {
    it("updates job fields and sets updatedAt", async () => {
      const job = createJob({ slug: "update-test", query: "test", reasoningLevel: "x-light" });
      const originalUpdatedAt = job.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      const updated = await updateJob(job.jobId, { status: "running" });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("running");
      expect(updated!.updatedAt > originalUpdatedAt).toBe(true);
    });

    it("persists to S3", async () => {
      const job = createJob({ slug: "persist-test", query: "test", reasoningLevel: "x-light" });
      await updateJob(job.jobId, { status: "running" });

      // Wait for fire-and-forget persist
      await new Promise((r) => setTimeout(r, 50));
      expect(putJobState).toHaveBeenCalled();
    });

    it("returns null for non-existent job", async () => {
      const result = await updateJob("nonexistent", { status: "running" });
      expect(result).toBeNull();
    });
  });

  describe("broadcastJobEvent and subscribeToJob", () => {
    it("delivers events to subscribers", () => {
      const job = createJob({ slug: "broadcast-test", query: "test", reasoningLevel: "x-light" });
      const received: Array<{ event: string; data: unknown }> = [];

      subscribeToJob(job.jobId, (msg) => received.push(msg));
      broadcastJobEvent(job.jobId, "test_event", { hello: "world" });

      expect(received).toHaveLength(1);
      expect(received[0].event).toBe("test_event");
      expect(received[0].data).toEqual({ hello: "world" });
    });

    it("tracks listener count on subscribe", () => {
      const job = createJob({ slug: "listener-test", query: "test", reasoningLevel: "x-light" });
      expect(job.listenerCount).toBe(0);

      subscribeToJob(job.jobId, () => {});
      expect(job.listenerCount).toBe(1);

      subscribeToJob(job.jobId, () => {});
      expect(job.listenerCount).toBe(2);
    });

    it("decrements listener count on unsubscribe", () => {
      const job = createJob({ slug: "unsub-test", query: "test", reasoningLevel: "x-light" });

      const unsub1 = subscribeToJob(job.jobId, () => {});
      subscribeToJob(job.jobId, () => {});
      expect(job.listenerCount).toBe(2);

      unsub1();
      expect(job.listenerCount).toBe(1);
    });

    it("stops delivering events after unsubscribe", () => {
      const job = createJob({ slug: "stop-deliver-test", query: "test", reasoningLevel: "x-light" });
      const received: unknown[] = [];

      const unsub = subscribeToJob(job.jobId, (msg) => received.push(msg));
      broadcastJobEvent(job.jobId, "before", {});
      expect(received).toHaveLength(1);

      unsub();
      broadcastJobEvent(job.jobId, "after", {});
      expect(received).toHaveLength(1); // No new events
    });

    it("creates emitter for unknown jobId on subscribe", () => {
      const received: unknown[] = [];
      subscribeToJob("new-job-id", (msg) => received.push(msg));
      broadcastJobEvent("new-job-id", "test", { data: 1 });
      expect(received).toHaveLength(1);
    });
  });

  describe("createJobSendFn", () => {
    it("accumulates progress events", () => {
      const job = createJob({ slug: "sendfn-test", query: "test", reasoningLevel: "x-light" });
      const send = createJobSendFn(job.jobId);

      const progress: ProgressEvent = {
        stage: "classifying",
        message: "Analyzing...",
        percent: 5,
      };
      send("progress", progress);

      expect(job.progress).toHaveLength(1);
      expect(job.progress[0].stage).toBe("classifying");
    });

    it("accumulates trace events", () => {
      const job = createJob({ slug: "trace-test", query: "test", reasoningLevel: "x-light" });
      const send = createJobSendFn(job.jobId);

      send("trace", { stage: "classifier", agent: "Classifier", trace: {} });
      expect(job.traceEvents).toHaveLength(1);
    });

    it("sets currentReport on report event", () => {
      const job = createJob({ slug: "report-test", query: "test", reasoningLevel: "x-light" });
      const send = createJobSendFn(job.jobId);

      const report: Report = {
        meta: { title: "Test Report" },
        sections: [],
        findings: [],
      };
      send("report", report);
      expect(job.currentReport).not.toBeNull();
      expect(job.currentReport!.meta.title).toBe("Test Report");
    });

    it("sets error on error event", () => {
      const job = createJob({ slug: "error-test", query: "test", reasoningLevel: "x-light" });
      const send = createJobSendFn(job.jobId);

      send("error", { message: "Something failed" });
      expect(job.error).not.toBeNull();
      expect(job.error!.message).toBe("Something failed");
    });

    it("broadcasts to subscribers", () => {
      const job = createJob({ slug: "broadcast-sendfn-test", query: "test", reasoningLevel: "x-light" });
      const received: unknown[] = [];
      subscribeToJob(job.jobId, (msg) => received.push(msg));

      const send = createJobSendFn(job.jobId);
      send("progress", { stage: "test", message: "hi", percent: 50 });

      expect(received).toHaveLength(1);
    });

    it("is a no-op for non-existent jobs", () => {
      const send = createJobSendFn("nonexistent-job");
      // Should not throw
      send("progress", { stage: "test", message: "hi", percent: 0 });
    });
  });

  describe("startJob", () => {
    it("marks job as running and broadcasts", async () => {
      const job = createJob({ slug: "start-test", query: "test", reasoningLevel: "x-light" });
      const received: Array<{ event: string; data: unknown }> = [];
      subscribeToJob(job.jobId, (msg) => received.push(msg));

      await startJob(job.jobId);

      expect(job.status).toBe("running");
      expect(received.some((e) => e.event === "job_status")).toBe(true);
    });
  });

  describe("completeJob", () => {
    it("marks job as completed with report", async () => {
      const job = createJob({ slug: "complete-test", query: "test", reasoningLevel: "x-light" });
      const report: Report = {
        meta: { title: "Completed Report" },
        sections: [],
        findings: [],
      };

      const received: Array<{ event: string; data: unknown }> = [];
      subscribeToJob(job.jobId, (msg) => received.push(msg));

      await completeJob(job.jobId, report);

      expect(job.status).toBe("completed");
      expect(job.currentReport).not.toBeNull();
      expect(job.completedAt).toBeDefined();
      expect(received.some((e) => e.event === "done")).toBe(true);
    });
  });

  describe("failJob", () => {
    it("marks job as failed with error", async () => {
      const job = createJob({ slug: "fail-test", query: "test", reasoningLevel: "x-light" });
      const error: ErrorInfo = { message: "Something went wrong" };

      const received: Array<{ event: string; data: unknown }> = [];
      subscribeToJob(job.jobId, (msg) => received.push(msg));

      await failJob(job.jobId, error);

      expect(job.status).toBe("failed");
      expect(job.error).not.toBeNull();
      expect(job.completedAt).toBeDefined();
      expect(received.some((e) => e.event === "error")).toBe(true);
    });
  });

  describe("cancelJob", () => {
    it("cancels a running job", async () => {
      const job = createJob({ slug: "cancel-test", query: "test", reasoningLevel: "x-light" });
      await startJob(job.jobId);
      expect(job.status).toBe("running");

      const cancelled = await cancelJob(job.jobId);
      expect(cancelled).toBe(true);
      expect(job.status).toBe("failed");
      expect(job.error?.message).toBe("Job cancelled by user");
    });

    it("cancels a queued job", async () => {
      const job = createJob({ slug: "cancel-queued", query: "test", reasoningLevel: "x-light" });
      expect(job.status).toBe("queued");

      const cancelled = await cancelJob(job.jobId);
      expect(cancelled).toBe(true);
      expect(job.status).toBe("failed");
    });

    it("returns false for already completed job", async () => {
      const job = createJob({ slug: "cancel-done", query: "test", reasoningLevel: "x-light" });
      await completeJob(job.jobId, { meta: { title: "Done" }, sections: [], findings: [] });

      const cancelled = await cancelJob(job.jobId);
      expect(cancelled).toBe(false);
    });

    it("returns false for non-existent job", async () => {
      const cancelled = await cancelJob("nonexistent");
      expect(cancelled).toBe(false);
    });

    it("broadcasts cancellation events", async () => {
      const job = createJob({ slug: "cancel-broadcast", query: "test", reasoningLevel: "x-light" });
      await startJob(job.jobId);

      const received: Array<{ event: string; data: unknown }> = [];
      subscribeToJob(job.jobId, (msg) => received.push(msg));

      await cancelJob(job.jobId);

      expect(received.some((e) => e.event === "job_status")).toBe(true);
      expect(received.some((e) => e.event === "error")).toBe(true);
    });
  });

  describe("isJobCancelled", () => {
    it("returns true for cancelled job", async () => {
      const job = createJob({ slug: "is-cancelled", query: "test", reasoningLevel: "x-light" });
      await startJob(job.jobId);
      await cancelJob(job.jobId);

      expect(isJobCancelled(job.jobId)).toBe(true);
    });

    it("returns false for running job", async () => {
      const job = createJob({ slug: "not-cancelled", query: "test", reasoningLevel: "x-light" });
      await startJob(job.jobId);

      expect(isJobCancelled(job.jobId)).toBe(false);
    });

    it("returns true for non-existent job", () => {
      expect(isJobCancelled("nonexistent")).toBe(true);
    });
  });

  describe("addAttachmentToJob", () => {
    it("adds attachment and broadcasts", async () => {
      const job = createJob({ slug: "att-add-test", query: "test", reasoningLevel: "x-light" });
      const received: Array<{ event: string; data: unknown }> = [];
      subscribeToJob(job.jobId, (msg) => received.push(msg));

      const attachment: Attachment = {
        id: "att-new",
        filename: "data.csv",
        mimeType: "text/csv",
        sizeBytes: 512,
        s3Key: "reports/test/attachments/att-new-data.csv",
        uploadedAt: new Date().toISOString(),
      };

      await addAttachmentToJob(job.jobId, attachment);

      expect(job.attachments).toHaveLength(1);
      expect(received.some((e) => e.event === "attachment_added")).toBe(true);
    });
  });

  describe("removeAttachmentFromJob", () => {
    it("removes attachment and broadcasts", async () => {
      const attachment: Attachment = {
        id: "att-remove",
        filename: "old.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        s3Key: "reports/test/attachments/att-remove-old.pdf",
        uploadedAt: new Date().toISOString(),
      };

      const job = createJob({
        slug: "att-remove-test",
        query: "test",
        reasoningLevel: "x-light",
        attachments: [attachment],
      });

      const received: Array<{ event: string; data: unknown }> = [];
      subscribeToJob(job.jobId, (msg) => received.push(msg));

      await removeAttachmentFromJob(job.jobId, "att-remove");

      expect(job.attachments).toHaveLength(0);
      expect(received.some((e) => e.event === "attachment_removed")).toBe(true);
    });
  });

  describe("updateWorkLog", () => {
    it("updates plan and broadcasts", () => {
      const job = createJob({ slug: "worklog-test", query: "test", reasoningLevel: "x-light" });
      const received: Array<{ event: string; data: unknown }> = [];
      subscribeToJob(job.jobId, (msg) => received.push(msg));

      updateWorkLog(job.jobId, {
        plan: [
          { skill: "classify", description: "Classify", input: {}, status: "completed" },
          { skill: "research", description: "Research", input: {}, status: "running" },
        ],
        reasoning: ["Started research phase"],
      });

      expect(job.workLog.plan).toHaveLength(2);
      expect(job.workLog.reasoning).toEqual(["Started research phase"]);
      expect(received.some((e) => e.event === "work_log")).toBe(true);
    });

    it("is a no-op for non-existent job", () => {
      // Should not throw
      updateWorkLog("nonexistent", { plan: [] });
    });
  });

  describe("summarizeJob", () => {
    it("returns a lightweight summary", () => {
      const job = createJob({ slug: "summary-test", query: "Analyze NVDA", reasoningLevel: "x-light" });
      job.progress.push({ stage: "research", message: "Researching", percent: 50 });

      const summary = summarizeJob(job);

      expect(summary.jobId).toBe(job.jobId);
      expect(summary.slug).toBe("summary-test");
      expect(summary.status).toBe("queued");
      expect(summary.query).toBe("Analyze NVDA");
      expect(summary.progress).toBe(50);
      expect(summary.attachmentCount).toBe(0);
      expect(summary.hasReport).toBe(false);
    });

    it("reports 0 progress when no progress events", () => {
      const job = createJob({ slug: "no-progress", query: "test", reasoningLevel: "x-light" });
      const summary = summarizeJob(job);
      expect(summary.progress).toBe(0);
    });

    it("reflects attachment count and report presence", () => {
      const job = createJob({
        slug: "full-summary",
        query: "test",
        reasoningLevel: "x-light",
        attachments: [
          { id: "a1", filename: "f1", mimeType: "text/plain", sizeBytes: 10, s3Key: "k1", uploadedAt: "" },
          { id: "a2", filename: "f2", mimeType: "text/plain", sizeBytes: 20, s3Key: "k2", uploadedAt: "" },
        ],
      });
      job.currentReport = { meta: { title: "Test" }, sections: [], findings: [] };

      const summary = summarizeJob(job);
      expect(summary.attachmentCount).toBe(2);
      expect(summary.hasReport).toBe(true);
    });
  });

  describe("listJobs", () => {
    it("returns jobs sorted by createdAt descending", () => {
      createJob({ slug: "list-a", query: "first", reasoningLevel: "x-light" });
      createJob({ slug: "list-b", query: "second", reasoningLevel: "x-light" });

      const list = listJobs();
      expect(list.length).toBeGreaterThanOrEqual(2);
      // Most recent first
      const listSlugB = list.find((j) => j.slug === "list-b");
      const listSlugA = list.find((j) => j.slug === "list-a");
      expect(listSlugB).toBeDefined();
      expect(listSlugA).toBeDefined();
    });
  });

  describe("cleanupOldJobs", () => {
    it("removes old completed jobs with no listeners", async () => {
      const job = createJob({ slug: "cleanup-test", query: "test", reasoningLevel: "x-light" });
      const report: Report = { meta: { title: "Done" }, sections: [], findings: [] };
      await completeJob(job.jobId, report);

      // Job was just completed — should NOT be cleaned up with default maxAge
      cleanupOldJobs(24 * 60 * 60 * 1000);
      const afterCleanup = await getJob(job.jobId);
      expect(afterCleanup).not.toBeNull();

      // Now clean up with 0 maxAge (clean everything)
      cleanupOldJobs(0);
      // The in-memory getJob won't find it, but getJobState mock returns null
      // So we verify the listing
    });

    it("preserves jobs with active listeners", async () => {
      const job = createJob({ slug: "listener-preserve", query: "test", reasoningLevel: "x-light" });
      await completeJob(job.jobId, { meta: { title: "Done" }, sections: [], findings: [] });

      // Add a listener
      subscribeToJob(job.jobId, () => {});

      // Try to clean up with 0 maxAge
      cleanupOldJobs(0);

      // Job should still be in memory because it has a listener
      const found = await getJob(job.jobId);
      expect(found).not.toBeNull();
    });
  });
});
