/**
 * Integration tests for the job lifecycle: creation → running → completion/failure
 * Tests the interplay between jobs.ts, broadcasting, and state management.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock storage (job persistence to S3)
vi.mock("./storage", () => ({
  putJobState: vi.fn().mockResolvedValue(undefined),
  getJobState: vi.fn().mockResolvedValue(null),
}));

import {
  createJob,
  getJob,
  cancelStaleJobs,
  getJobBySlug,
  getLatestJobForSlug,
  startJob,
  completeJob,
  failJob,
  cancelJob,
  isJobCancelled,
  createJobSendFn,
  subscribeToJob,
  broadcastJobEvent,
  addAttachmentToJob,
  removeAttachmentFromJob,
  updateWorkLog,
  listJobs,
  summarizeJob,
  cleanupOldJobs,
  countActiveJobs,
  _resetForTests,
} from "./jobs";
import type { Report, Attachment, AgentWorkLog } from "../shared/types";

describe("job lifecycle integration", () => {
  // Create a fresh job for each test
  let jobId: string;
  let slug: string;

  beforeEach(() => {
    _resetForTests(); // Clear all jobs between tests
    const job = createJob({
      slug: `test-slug-${Date.now()}`,
      query: "Analyze NVDA",
      reasoningLevel: "x-light",
    });
    jobId = job.jobId;
    slug = job.slug;
  });

  describe("full success lifecycle", () => {
    it("flows through queued → running → completed", async () => {
      // 1. Initially queued
      const job = await getJob(jobId);
      expect(job!.status).toBe("queued");

      // 2. Start the job
      await startJob(jobId);
      const running = await getJob(jobId);
      expect(running!.status).toBe("running");

      // 3. Complete the job
      const report: Report = {
        meta: { title: "NVIDIA Analysis", ticker: "NVDA" },
        sections: [],
        findings: [
          { id: "f1", section: "thesis", text: "Revenue grew 40%", certainty: 85, explanation: { title: "Revenue", text: "Grew", supportingEvidence: [], contraryEvidence: [] } },
        ],
      };
      await completeJob(jobId, report);

      const completed = await getJob(jobId);
      expect(completed!.status).toBe("completed");
      expect(completed!.currentReport).toEqual(report);
      expect(completed!.completedAt).toBeDefined();
    });
  });

  describe("full failure lifecycle", () => {
    it("flows through queued → running → failed", async () => {
      await startJob(jobId);
      await failJob(jobId, { message: "API key invalid", detail: { status: 401 } });

      const failed = await getJob(jobId);
      expect(failed!.status).toBe("failed");
      expect(failed!.error!.message).toBe("API key invalid");
      expect(failed!.completedAt).toBeDefined();
    });
  });

  describe("cancellation lifecycle", () => {
    it("can cancel a queued job", async () => {
      const cancelled = await cancelJob(jobId);
      expect(cancelled).toBe(true);
      expect(isJobCancelled(jobId)).toBe(true);

      const job = await getJob(jobId);
      expect(job!.status).toBe("failed");
      expect(job!.error!.message).toBe("Job cancelled by user");
    });

    it("can cancel a running job", async () => {
      await startJob(jobId);
      const cancelled = await cancelJob(jobId);
      expect(cancelled).toBe(true);
      expect(isJobCancelled(jobId)).toBe(true);
    });

    it("cannot cancel a completed job", async () => {
      await startJob(jobId);
      await completeJob(jobId, { meta: { title: "Done" }, sections: [], findings: [] });

      const cancelled = await cancelJob(jobId);
      expect(cancelled).toBe(false);
    });

    it("cannot cancel a failed job", async () => {
      await startJob(jobId);
      await failJob(jobId, { message: "Error" });

      const cancelled = await cancelJob(jobId);
      expect(cancelled).toBe(false);
    });
  });

  describe("SSE event accumulation and replay", () => {
    it("accumulates progress events for reconnection replay", async () => {
      const send = createJobSendFn(jobId);

      send("progress", { stage: "classifying", message: "Classifying domain...", percent: 5 });
      send("progress", { stage: "researching", message: "Gathering evidence...", percent: 30 });
      send("progress", { stage: "synthesizing", message: "Drafting report...", percent: 60 });

      const job = await getJob(jobId);
      expect(job!.progress).toHaveLength(3);
      expect(job!.progress[0].stage).toBe("classifying");
      expect(job!.progress[2].stage).toBe("synthesizing");
    });

    it("accumulates trace events for reconnection replay", async () => {
      const send = createJobSendFn(jobId);

      send("trace", { stage: "classifier", agent: "Classifier", trace: { prompt: "classify" } });
      send("trace", { stage: "researcher", agent: "Researcher", trace: { prompt: "research" } });

      const job = await getJob(jobId);
      expect(job!.traceEvents).toHaveLength(2);
    });

    it("stores the latest report for replay", async () => {
      const send = createJobSendFn(jobId);

      const report1 = { meta: { title: "Draft 1" }, sections: [], findings: [] };
      const report2 = { meta: { title: "Final Report" }, sections: [], findings: [] };

      send("report", report1);
      send("report", report2);

      const job = await getJob(jobId);
      // Should have the most recent report
      expect(job!.currentReport!.meta.title).toBe("Final Report");
    });

    it("stores error for replay", async () => {
      const send = createJobSendFn(jobId);
      send("error", { message: "Something broke", detail: { stage: "synthesis" } });

      const job = await getJob(jobId);
      expect(job!.error!.message).toBe("Something broke");
    });
  });

  describe("real-time event broadcasting", () => {
    it("delivers events to subscribers in real time", async () => {
      const received: Array<{ event: string; data: unknown }> = [];
      const unsubscribe = subscribeToJob(jobId, (msg) => received.push(msg));

      const send = createJobSendFn(jobId);
      send("progress", { stage: "test", message: "Hello", percent: 10 });
      send("trace", { stage: "test", agent: "Test" });

      expect(received).toHaveLength(2);
      expect(received[0].event).toBe("progress");
      expect(received[1].event).toBe("trace");

      unsubscribe();
    });

    it("does not deliver events after unsubscribe", async () => {
      const received: Array<{ event: string; data: unknown }> = [];
      const unsubscribe = subscribeToJob(jobId, (msg) => received.push(msg));

      const send = createJobSendFn(jobId);
      send("progress", { stage: "before", message: "Before", percent: 5 });

      unsubscribe();

      send("progress", { stage: "after", message: "After", percent: 10 });

      expect(received).toHaveLength(1);
      expect(received[0].event).toBe("progress");
    });

    it("supports multiple concurrent subscribers", async () => {
      const received1: string[] = [];
      const received2: string[] = [];

      const unsub1 = subscribeToJob(jobId, (msg) => received1.push(msg.event));
      const unsub2 = subscribeToJob(jobId, (msg) => received2.push(msg.event));

      const send = createJobSendFn(jobId);
      send("progress", { stage: "test", message: "Hi", percent: 5 });

      expect(received1).toEqual(["progress"]);
      expect(received2).toEqual(["progress"]);

      unsub1();
      unsub2();
    });

    it("broadcasts job_status and done events on completion", async () => {
      const events: string[] = [];
      subscribeToJob(jobId, (msg) => events.push(msg.event));

      await startJob(jobId);
      await completeJob(jobId, { meta: { title: "Done" }, sections: [], findings: [] });

      expect(events).toContain("job_status");
      expect(events).toContain("done");
    });

    it("broadcasts job_status and error events on failure", async () => {
      const events: Array<{ event: string; data: unknown }> = [];
      subscribeToJob(jobId, (msg) => events.push(msg));

      await startJob(jobId);
      await failJob(jobId, { message: "Failed hard" });

      const statusEvents = events.filter((e) => e.event === "job_status");
      // Should have at least two: running + failed
      const failedStatus = statusEvents.find((e) => (e.data as { status: string }).status === "failed");
      expect(failedStatus).toBeDefined();

      const errorEvent = events.find((e) => e.event === "error");
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.data as { message: string }).message).toBe("Failed hard");
    });
  });

  describe("attachment management during job", () => {
    it("adds attachments to a running job", async () => {
      await startJob(jobId);

      const attachment: Attachment = {
        id: "att-1",
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        s3Key: "reports/test/attachments/att-1.pdf",
        uploadedAt: new Date().toISOString(),
      };

      await addAttachmentToJob(jobId, attachment);

      const job = await getJob(jobId);
      expect(job!.attachments).toHaveLength(1);
      expect(job!.attachments[0].filename).toBe("report.pdf");
    });

    it("removes attachments from a running job", async () => {
      await startJob(jobId);

      const att1: Attachment = {
        id: "att-1", filename: "file1.txt", mimeType: "text/plain",
        sizeBytes: 100, s3Key: "k1", uploadedAt: "",
      };
      const att2: Attachment = {
        id: "att-2", filename: "file2.txt", mimeType: "text/plain",
        sizeBytes: 200, s3Key: "k2", uploadedAt: "",
      };

      await addAttachmentToJob(jobId, att1);
      await addAttachmentToJob(jobId, att2);

      const before = await getJob(jobId);
      expect(before!.attachments).toHaveLength(2);

      await removeAttachmentFromJob(jobId, "att-1");

      const after = await getJob(jobId);
      expect(after!.attachments).toHaveLength(1);
      expect(after!.attachments[0].id).toBe("att-2");
    });

    it("broadcasts attachment_added and attachment_removed events", async () => {
      const events: string[] = [];
      subscribeToJob(jobId, (msg) => events.push(msg.event));

      const attachment: Attachment = {
        id: "att-1", filename: "file.txt", mimeType: "text/plain",
        sizeBytes: 100, s3Key: "k1", uploadedAt: "",
      };

      await addAttachmentToJob(jobId, attachment);
      expect(events).toContain("attachment_added");

      await removeAttachmentFromJob(jobId, "att-1");
      expect(events).toContain("attachment_removed");
    });
  });

  describe("work log updates", () => {
    it("updates the work log and broadcasts", async () => {
      const events: Array<{ event: string; data: unknown }> = [];
      subscribeToJob(jobId, (msg) => events.push(msg));

      const workLog: AgentWorkLog = {
        plan: [{ skill: "classify", description: "Classify domain", input: {}, status: "completed" }],
        invocations: [],
        reasoning: ["Starting classification"],
      };

      updateWorkLog(jobId, workLog);

      const job = await getJob(jobId);
      expect(job!.workLog.plan).toHaveLength(1);
      expect(job!.workLog.reasoning).toEqual(["Starting classification"]);

      const wlEvent = events.find((e) => e.event === "work_log");
      expect(wlEvent).toBeDefined();
    });
  });

  describe("job summary and listing", () => {
    it("summarizeJob produces a lightweight summary", async () => {
      const send = createJobSendFn(jobId);
      send("progress", { stage: "test", message: "Progress", percent: 42 });

      const job = await getJob(jobId);
      const summary = summarizeJob(job!);

      expect(summary.jobId).toBe(jobId);
      expect(summary.slug).toBe(slug);
      expect(summary.status).toBe("queued");
      expect(summary.query).toBe("Analyze NVDA");
      expect(summary.progress).toBe(42);
      expect(summary.hasReport).toBe(false);
    });

    it("summary shows hasReport=true after report arrives", async () => {
      await startJob(jobId);
      await completeJob(jobId, { meta: { title: "Done" }, sections: [], findings: [] });

      const job = await getJob(jobId);
      const summary = summarizeJob(job!);

      expect(summary.hasReport).toBe(true);
      expect(summary.status).toBe("completed");
    });

    it("listJobs returns jobs sorted by creation time (newest first)", async () => {
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      const job2 = createJob({ slug: "newer-slug", query: "Test 2", reasoningLevel: "light" });

      const jobs = listJobs();
      // Newest job should be first
      expect(jobs[0].jobId).toBe(job2.jobId);
    });
  });

  describe("multi-job slug scenarios", () => {
    it("getJobBySlug returns the first matching job", () => {
      const found = getJobBySlug(slug);
      expect(found).not.toBeNull();
      expect(found!.jobId).toBe(jobId);
    });

    it("getLatestJobForSlug returns the most recently created job", async () => {
      // Create another job with the same slug but slightly later
      await new Promise((r) => setTimeout(r, 10));
      const job2 = createJob({ slug, query: "Second query", reasoningLevel: "x-light" });

      const latest = getLatestJobForSlug(slug);
      expect(latest).not.toBeNull();
      expect(latest!.jobId).toBe(job2.jobId);
      expect(latest!.query).toBe("Second query");
    });
  });

  describe("cleanup", () => {
    it("cleanupOldJobs removes completed jobs older than maxAge without listeners", async () => {
      await startJob(jobId);
      await completeJob(jobId, { meta: { title: "Old" }, sections: [], findings: [] });

      // Fake the updatedAt to be old
      const job = await getJob(jobId);
      (job as any).updatedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      cleanupOldJobs(24 * 60 * 60 * 1000);

      const cleaned = await getJob(jobId);
      // Job should have been cleaned from memory
      // getJob will try S3 which returns null in our mock
      expect(cleaned).toBeNull();
    });

    it("cleanupOldJobs preserves active jobs with listeners", async () => {
      await startJob(jobId);
      await completeJob(jobId, { meta: { title: "Old" }, sections: [], findings: [] });

      // Fake old timestamp
      const job = await getJob(jobId);
      (job as any).updatedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      // Add a listener — should prevent cleanup
      const unsub = subscribeToJob(jobId, () => {});

      cleanupOldJobs(24 * 60 * 60 * 1000);

      const preserved = await getJob(jobId);
      expect(preserved).not.toBeNull();

      unsub();
    });
  });

  describe("stale job auto-cancellation", () => {
    it("auto-cancels jobs that exceed max runtime", async () => {
      await startJob(jobId);

      // Fake the createdAt to be 31 minutes ago
      const job = await getJob(jobId);
      (job as any).createdAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();

      const cancelled = cancelStaleJobs();
      expect(cancelled).toBe(1);

      const staleJob = await getJob(jobId);
      expect(staleJob!.status).toBe("failed");
      expect(staleJob!.error!.message).toContain("timed out");
    });

    it("does not cancel jobs within max runtime", async () => {
      await startJob(jobId);

      // Job was just created, so it's within the time limit
      const cancelled = cancelStaleJobs();
      expect(cancelled).toBe(0);

      const freshJob = await getJob(jobId);
      expect(freshJob!.status).toBe("running");
    });

    it("does not cancel completed or failed jobs", async () => {
      await startJob(jobId);
      await completeJob(jobId, { meta: { title: "Done" }, sections: [], findings: [] });

      // Fake old createdAt
      const job = await getJob(jobId);
      (job as any).createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const cancelled = cancelStaleJobs();
      expect(cancelled).toBe(0);
    });
  });

  describe("memory safety — bounded event accumulation", () => {
    it("caps progress events to prevent unbounded memory growth", async () => {
      const send = createJobSendFn(jobId);

      // Emit more than MAX_PROGRESS_EVENTS (200) progress events
      for (let i = 0; i < 250; i++) {
        send("progress", { stage: `step_${i}`, message: `Step ${i}`, percent: i % 100 });
      }

      const job = await getJob(jobId);
      // Should be capped (first 10 + most recent 190 = 200)
      expect(job!.progress.length).toBeLessThanOrEqual(200);
      // First event should be preserved
      expect(job!.progress[0].stage).toBe("step_0");
    });

    it("caps trace events to prevent unbounded growth", async () => {
      const send = createJobSendFn(jobId);

      for (let i = 0; i < 60; i++) {
        send("trace", { stage: `trace_${i}`, agent: `Agent${i}`, trace: {} });
      }

      const job = await getJob(jobId);
      expect(job!.traceEvents.length).toBeLessThanOrEqual(50);
    });
  });

  describe("edge cases", () => {
    it("getJob returns null for unknown ID", async () => {
      const result = await getJob("nonexistent-job-id");
      expect(result).toBeNull();
    });

    it("cancelJob returns false for unknown ID", async () => {
      const result = await cancelJob("nonexistent-job-id");
      expect(result).toBe(false);
    });

    it("isJobCancelled returns true for unknown ID", () => {
      // Unknown job = treat as cancelled (safe default for orchestrator abort check)
      expect(isJobCancelled("nonexistent-job-id")).toBe(true);
    });

    it("createJobSendFn ignores events for deleted jobs", () => {
      const send = createJobSendFn("nonexistent-job-id");
      // Should not throw
      send("progress", { stage: "test", percent: 0 });
    });

    it("broadcastJobEvent is no-op for unknown job", () => {
      // Should not throw
      broadcastJobEvent("nonexistent-job-id", "test", {});
    });
  });

  describe("concurrent job limit", () => {
    it("countActiveJobs returns correct count", () => {
      // beforeEach creates 1 job (queued), so at least 1 active
      const count = countActiveJobs();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it("throws when concurrent limit is exceeded", async () => {
      // Complete all existing jobs first, then create max+1
      // First, complete the job from beforeEach
      await completeJob(jobId, {
        meta: { title: "T" } as Report["meta"],
        sections: [],
        findings: [],
      });

      // Create 10 jobs (the limit)
      const jobIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const j = createJob({
          slug: `limit-test-${i}`,
          query: `Query ${i}`,
          reasoningLevel: "x-light",
        });
        jobIds.push(j.jobId);
      }

      // The 11th should throw
      expect(() =>
        createJob({
          slug: "limit-test-overflow",
          query: "Query overflow",
          reasoningLevel: "x-light",
        })
      ).toThrow(/Too many concurrent jobs/);

      // Clean up — complete all created jobs
      for (const id of jobIds) {
        await completeJob(id, {
          meta: { title: "T" } as Report["meta"],
          sections: [],
          findings: [],
        });
      }
    });

    it("allows new jobs once active ones complete", async () => {
      // Complete the beforeEach job
      await completeJob(jobId, {
        meta: { title: "T" } as Report["meta"],
        sections: [],
        findings: [],
      });

      // Fill up to the limit
      const jobIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const j = createJob({
          slug: `fill-test-${i}`,
          query: `Q ${i}`,
          reasoningLevel: "x-light",
        });
        jobIds.push(j.jobId);
      }

      // Should fail
      expect(() =>
        createJob({ slug: "x", query: "Q", reasoningLevel: "x-light" })
      ).toThrow(/Too many/);

      // Complete one job
      await completeJob(jobIds[0], {
        meta: { title: "T" } as Report["meta"],
        sections: [],
        findings: [],
      });

      // Now should succeed
      const newJob = createJob({ slug: "after-complete", query: "Q", reasoningLevel: "x-light" });
      expect(newJob.jobId).toBeTruthy();

      // Clean up
      for (const id of [...jobIds.slice(1), newJob.jobId]) {
        await completeJob(id, {
          meta: { title: "T" } as Report["meta"],
          sections: [],
          findings: [],
        });
      }
    });

    it("failed jobs don't count toward the limit", async () => {
      await completeJob(jobId, {
        meta: { title: "T" } as Report["meta"],
        sections: [],
        findings: [],
      });

      const jobIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const j = createJob({
          slug: `fail-test-${i}`,
          query: `Q ${i}`,
          reasoningLevel: "x-light",
        });
        jobIds.push(j.jobId);
      }

      // Fail one job
      await failJob(jobIds[0], { message: "test error" });

      // Should now have room for one more
      const newJob = createJob({ slug: "after-fail", query: "Q", reasoningLevel: "x-light" });
      expect(newJob.jobId).toBeTruthy();

      // Clean up
      for (const id of [...jobIds.slice(1), newJob.jobId]) {
        await completeJob(id, {
          meta: { title: "T" } as Report["meta"],
          sections: [],
          findings: [],
        });
      }
    });
  });
});
