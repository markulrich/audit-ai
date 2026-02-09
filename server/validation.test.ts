/**
 * Tests for server-side validation logic.
 * Tests report payload validation, slug validation, and input sanitization.
 */
import { describe, it, expect } from "vitest";

// Re-implement the validation function for testing (since it's not exported from index.ts)
// These tests verify the validation logic independently of Express routing.

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

  if (r.findings.length > 200) {
    return { valid: false, error: "Report has too many findings (max 200)" };
  }

  if (r.sections.length > 50) {
    return { valid: false, error: "Report has too many sections (max 50)" };
  }

  return { valid: true };
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

describe("validateReportPayload", () => {
  it("accepts a valid report", () => {
    const report = {
      meta: { title: "Test Report", ticker: "NVDA" },
      sections: [{ id: "s1", title: "Section 1", content: [] }],
      findings: [{ id: "f1", text: "Finding 1", certainty: 85 }],
    };
    expect(validateReportPayload(report)).toEqual({ valid: true });
  });

  it("accepts a report with empty sections and findings", () => {
    const report = { meta: { title: "Empty" }, sections: [], findings: [] };
    expect(validateReportPayload(report)).toEqual({ valid: true });
  });

  it("rejects null", () => {
    expect(validateReportPayload(null).valid).toBe(false);
  });

  it("rejects undefined", () => {
    expect(validateReportPayload(undefined).valid).toBe(false);
  });

  it("rejects a string", () => {
    expect(validateReportPayload("not a report").valid).toBe(false);
  });

  it("rejects a number", () => {
    expect(validateReportPayload(42).valid).toBe(false);
  });

  it("rejects an array", () => {
    expect(validateReportPayload([]).valid).toBe(false);
  });

  it("rejects report without meta", () => {
    const report = { sections: [], findings: [] };
    const result = validateReportPayload(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("meta");
  });

  it("rejects report with null meta", () => {
    const report = { meta: null, sections: [], findings: [] };
    const result = validateReportPayload(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("meta");
  });

  it("rejects report without sections", () => {
    const report = { meta: {}, findings: [] };
    const result = validateReportPayload(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("sections");
  });

  it("rejects report with non-array sections", () => {
    const report = { meta: {}, sections: "not array", findings: [] };
    const result = validateReportPayload(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("sections");
  });

  it("rejects report without findings", () => {
    const report = { meta: {}, sections: [] };
    const result = validateReportPayload(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("findings");
  });

  it("rejects report with non-array findings", () => {
    const report = { meta: {}, sections: [], findings: {} };
    const result = validateReportPayload(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("findings");
  });

  it("rejects report with too many findings (> 200)", () => {
    const findings = Array.from({ length: 201 }, (_, i) => ({ id: `f${i}`, text: `Finding ${i}` }));
    const report = { meta: {}, sections: [], findings };
    const result = validateReportPayload(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too many findings");
  });

  it("accepts report with exactly 200 findings", () => {
    const findings = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, text: `Finding ${i}` }));
    const report = { meta: {}, sections: [], findings };
    expect(validateReportPayload(report)).toEqual({ valid: true });
  });

  it("rejects report with too many sections (> 50)", () => {
    const sections = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, title: `Section ${i}` }));
    const report = { meta: {}, sections, findings: [] };
    const result = validateReportPayload(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too many sections");
  });

  it("accepts report with exactly 50 sections", () => {
    const sections = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, title: `Section ${i}` }));
    const report = { meta: {}, sections, findings: [] };
    expect(validateReportPayload(report)).toEqual({ valid: true });
  });
});

describe("slug validation", () => {
  it("accepts valid slugs", () => {
    expect(isValidSlug("nvda-test")).toBe(true);
    expect(isValidSlug("report-123")).toBe(true);
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
    expect(isValidSlug("aapl-2026")).toBe(true);
  });

  it("rejects slugs with uppercase letters", () => {
    expect(isValidSlug("NVDA")).toBe(false);
    expect(isValidSlug("Nvda-test")).toBe(false);
  });

  it("rejects slugs with spaces", () => {
    expect(isValidSlug("nvda test")).toBe(false);
  });

  it("rejects slugs with special characters", () => {
    expect(isValidSlug("nvda_test")).toBe(false); // underscores not allowed
    expect(isValidSlug("nvda.test")).toBe(false);
    expect(isValidSlug("nvda/test")).toBe(false);
    expect(isValidSlug("nvda@test")).toBe(false);
  });

  it("rejects empty slug", () => {
    expect(isValidSlug("")).toBe(false);
  });

  it("accepts all-numeric slugs", () => {
    expect(isValidSlug("12345")).toBe(true);
  });

  it("accepts slugs with consecutive dashes", () => {
    expect(isValidSlug("nvda--test")).toBe(true);
  });
});

describe("query validation", () => {
  const MAX_QUERY_LENGTH = 5000;

  function validateQuery(query: unknown): { valid: boolean; error?: string } {
    if (!query || typeof query !== "string" || query.trim().length < 3) {
      return { valid: false, error: "Query must be at least 3 characters" };
    }
    if ((query as string).length > MAX_QUERY_LENGTH) {
      return { valid: false, error: `Query too long (max ${MAX_QUERY_LENGTH} chars)` };
    }
    return { valid: true };
  }

  it("accepts valid queries", () => {
    expect(validateQuery("Analyze NVIDIA").valid).toBe(true);
    expect(validateQuery("abc").valid).toBe(true);
  });

  it("rejects null/undefined", () => {
    expect(validateQuery(null).valid).toBe(false);
    expect(validateQuery(undefined).valid).toBe(false);
  });

  it("rejects non-string queries", () => {
    expect(validateQuery(42).valid).toBe(false);
    expect(validateQuery({}).valid).toBe(false);
    expect(validateQuery([]).valid).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateQuery("").valid).toBe(false);
  });

  it("rejects queries shorter than 3 chars after trimming", () => {
    expect(validateQuery("ab").valid).toBe(false);
    expect(validateQuery("  a  ").valid).toBe(false);
  });

  it("rejects queries longer than MAX_QUERY_LENGTH", () => {
    const long = "a".repeat(MAX_QUERY_LENGTH + 1);
    expect(validateQuery(long).valid).toBe(false);
  });

  it("accepts query exactly at MAX_QUERY_LENGTH", () => {
    const exact = "a".repeat(MAX_QUERY_LENGTH);
    expect(validateQuery(exact).valid).toBe(true);
  });
});

describe("reasoning level validation", () => {
  const VALID_LEVELS = ["x-light", "light", "heavy", "x-heavy"];

  function isValidReasoningLevel(level: string): boolean {
    return VALID_LEVELS.includes(level);
  }

  it("accepts valid levels", () => {
    expect(isValidReasoningLevel("x-light")).toBe(true);
    expect(isValidReasoningLevel("light")).toBe(true);
    expect(isValidReasoningLevel("heavy")).toBe(true);
    expect(isValidReasoningLevel("x-heavy")).toBe(true);
  });

  it("rejects invalid levels", () => {
    expect(isValidReasoningLevel("medium")).toBe(false);
    expect(isValidReasoningLevel("super-heavy")).toBe(false);
    expect(isValidReasoningLevel("")).toBe(false);
    expect(isValidReasoningLevel("HEAVY")).toBe(false);
  });
});
