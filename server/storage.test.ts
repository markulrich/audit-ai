import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdir, rm, writeFile } from "fs/promises";
import { publishReport, getReport, listReports } from "./storage";
import type { Report } from "../shared/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", ".data");

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
  // Clean up test data before and after each test
  beforeEach(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
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

    it("skips orphan directories without meta.json", async () => {
      // Create an orphan slug directory with no meta.json
      const orphanDir = join(DATA_DIR, "reports", "reports", "orphan-slug");
      await mkdir(orphanDir, { recursive: true });
      await writeFile(join(orphanDir, "stale.txt"), "not json");

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
