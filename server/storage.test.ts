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

import { publishReport, getReport, listReports } from "./storage";

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
  });
});
