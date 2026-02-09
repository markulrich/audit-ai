import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import type { Report } from "../shared/types";

// In-memory S3 mock — keyed by "Bucket/Key"
let store: Map<string, string>;

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    input: { Bucket: string; Key: string; Body: string };
    constructor(input: { Bucket: string; Key: string; Body: string }) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    input: { Bucket: string; Key: string };
    constructor(input: { Bucket: string; Key: string }) {
      this.input = input;
    }
  }
  class ListObjectsV2Command {
    input: { Bucket: string; Prefix: string; Delimiter: string; ContinuationToken?: string };
    constructor(input: { Bucket: string; Prefix: string; Delimiter: string; ContinuationToken?: string }) {
      this.input = input;
    }
  }
  class S3Client {
    async send(command: PutObjectCommand | GetObjectCommand | ListObjectsV2Command) {
      if (command instanceof PutObjectCommand) {
        const { Bucket, Key, Body } = command.input;
        store.set(`${Bucket}/${Key}`, Body);
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const { Bucket, Key } = command.input;
        const data = store.get(`${Bucket}/${Key}`);
        if (!data) {
          const err = new Error("NoSuchKey") as Error & { name: string; $metadata: { httpStatusCode: number } };
          err.name = "NoSuchKey";
          err.$metadata = { httpStatusCode: 404 };
          throw err;
        }
        return {
          Body: {
            transformToString: async () => data,
          },
        };
      }
      if (command instanceof ListObjectsV2Command) {
        const { Bucket, Prefix, Delimiter } = command.input;
        const prefixes = new Set<string>();
        for (const key of store.keys()) {
          const objectKey = key.replace(`${Bucket}/`, "");
          if (!objectKey.startsWith(Prefix)) continue;
          const rest = objectKey.slice(Prefix.length);
          const delimIdx = rest.indexOf(Delimiter);
          if (delimIdx >= 0) {
            prefixes.add(Prefix + rest.slice(0, delimIdx + 1));
          }
        }
        return {
          CommonPrefixes: [...prefixes].map((p) => ({ Prefix: p })),
          NextContinuationToken: undefined,
        };
      }
      throw new Error("Unknown command");
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command };
});

import { publishReport, getReport, listReports, generateSlug, putJobState, getJobState } from "./storage";

function makeReport(overrides?: Partial<Report["meta"]>): Report {
  return {
    meta: {
      title: "Test Corp (TEST)",
      subtitle: "Equity Research",
      ticker: "TEST",
      ...overrides,
    },
    sections: [],
    findings: [],
  };
}

describe("storage", () => {
  beforeEach(() => {
    store = new Map();
  });

  describe("listReports", () => {
    it("returns empty array when no reports have been published", async () => {
      const result = await listReports();
      expect(result).toEqual([]);
    });

    it("lists published reports sorted by updatedAt descending", async () => {
      const report1 = makeReport({ title: "First Report", ticker: "AAA" });
      const report2 = makeReport({ title: "Second Report", ticker: "BBB" });

      const pub1 = await publishReport(report1);
      // Small delay so updatedAt differs
      await new Promise((r) => setTimeout(r, 50));
      const pub2 = await publishReport(report2);

      const list = await listReports();

      expect(list).toHaveLength(2);
      // Most recently updated first
      expect(list[0].slug).toBe(pub2.slug);
      expect(list[1].slug).toBe(pub1.slug);
      expect(list[0].title).toBe("Second Report");
      expect(list[1].title).toBe("First Report");
    });

    it("includes correct metadata fields", async () => {
      const report = makeReport({ title: "NVIDIA Analysis", ticker: "NVDA" });
      await publishReport(report);

      const list = await listReports();
      expect(list).toHaveLength(1);

      const meta = list[0];
      expect(meta.slug).toMatch(/^nvda-[a-z0-9]+$/);
      expect(meta.title).toBe("NVIDIA Analysis");
      expect(meta.ticker).toBe("NVDA");
      expect(meta.currentVersion).toBe(1);
      expect(meta.createdAt).toBeDefined();
      expect(meta.updatedAt).toBeDefined();
    });

    it("reflects updated version after re-publishing", async () => {
      const report = makeReport({ title: "Version Test", ticker: "VER" });
      const pub = await publishReport(report);

      // Re-publish to same slug
      await publishReport(report, pub.slug);

      const list = await listReports();
      expect(list).toHaveLength(1);
      expect(list[0].currentVersion).toBe(2);
    });

    it("skips prefixes without meta.json", async () => {
      // Manually insert an orphan prefix with no meta.json
      store.set("undefined/reports/orphan-slug/v1.json", JSON.stringify({ version: 1 }));

      // Also publish a real report
      const report = makeReport({ title: "Real Report", ticker: "REAL" });
      await publishReport(report);

      const list = await listReports();
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe("Real Report");
    });
  });

  describe("publishReport and getReport roundtrip", () => {
    it("publishes and retrieves a report", async () => {
      const report = makeReport({ title: "Roundtrip Test", ticker: "RT" });
      const pub = await publishReport(report);

      expect(pub.slug).toBeDefined();
      expect(pub.version).toBe(1);
      expect(pub.url).toBe(`/reports/${pub.slug}`);

      const retrieved = await getReport(pub.slug);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.report.meta.title).toBe("Roundtrip Test");
      expect(retrieved!.version).toBe(1);
    });

    it("returns null for non-existent slug", async () => {
      const result = await getReport("nonexistent-slug");
      expect(result).toBeNull();
    });

    it("retrieves a specific version", async () => {
      const report1 = makeReport({ title: "V1 Report" });
      const pub = await publishReport(report1);

      const report2 = makeReport({ title: "V2 Report" });
      await publishReport(report2, pub.slug);

      // Get v1 specifically
      const v1 = await getReport(pub.slug, 1);
      expect(v1).not.toBeNull();
      expect(v1!.report.meta.title).toBe("V1 Report");
      expect(v1!.version).toBe(1);

      // Get v2 specifically
      const v2 = await getReport(pub.slug, 2);
      expect(v2).not.toBeNull();
      expect(v2!.report.meta.title).toBe("V2 Report");
      expect(v2!.version).toBe(2);

      // Get latest (no version)
      const latest = await getReport(pub.slug);
      expect(latest!.report.meta.title).toBe("V2 Report");
      expect(latest!.currentVersion).toBe(2);
    });

    it("stores and retrieves messages with report", async () => {
      const report = makeReport({ title: "With Messages" });
      const messages = [
        { id: "msg-1", role: "user" as const, content: "Analyze NVDA", timestamp: Date.now() },
        { id: "msg-2", role: "assistant" as const, content: "Report generated.", timestamp: Date.now() },
      ];

      const pub = await publishReport(report, undefined, messages);
      const retrieved = await getReport(pub.slug);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.messages).toBeDefined();
      expect(retrieved!.messages!).toHaveLength(2);
      expect(retrieved!.messages![0].content).toBe("Analyze NVDA");
    });
  });

  describe("putJobState and getJobState", () => {
    it("persists and retrieves job state", async () => {
      const job = {
        jobId: "job-persist-test",
        slug: "test-slug",
        status: "running" as const,
        query: "Analyze NVDA",
        reasoningLevel: "x-light",
        attachments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: [{ stage: "classifying", message: "Analyzing...", percent: 5 }],
        traceEvents: [],
        workLog: { plan: [], invocations: [], reasoning: [] },
        currentReport: null,
        domainProfile: null,
        error: null,
        listenerCount: 3, // Should be excluded from persistence
      };

      await putJobState("job-persist-test", job as any);
      const retrieved = await getJobState("job-persist-test");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.jobId).toBe("job-persist-test");
      expect(retrieved!.status).toBe("running");
      expect(retrieved!.progress).toHaveLength(1);
      // listenerCount should NOT be persisted
      expect((retrieved as any).listenerCount).toBeUndefined();
    });

    it("returns null for non-existent job", async () => {
      const result = await getJobState("nonexistent-job");
      expect(result).toBeNull();
    });
  });

  describe("generateSlug", () => {
    it("generates slug from ticker", () => {
      const slug = generateSlug({ ticker: "AAPL", title: "Apple Inc" } as Report["meta"]);
      expect(slug).toMatch(/^aapl-[a-z0-9]+$/);
    });

    it("generates slug from title when no ticker", () => {
      const slug = generateSlug({ title: "Market Analysis Report" } as Report["meta"]);
      expect(slug).toMatch(/^market-analysis-report-[a-z0-9]+$/);
    });

    it("handles special characters in slug", () => {
      const slug = generateSlug({ ticker: "BRK.B", title: "Berkshire Hathaway" } as Report["meta"]);
      expect(slug).toMatch(/^brk-b-[a-z0-9]+$/);
    });

    it("truncates long slugs", () => {
      const slug = generateSlug({ title: "A Very Long Report Title That Should Be Truncated For Good Measure" } as Report["meta"]);
      // Base should be max 30 chars + dash + 4 char suffix
      expect(slug.length).toBeLessThanOrEqual(36);
    });
  });
});
