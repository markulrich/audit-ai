/**
 * Tests for shared validation logic.
 * Tests report payload validation, content array validation, finding validation,
 * section validation, cross-referencing, slug validation, and input sanitization.
 */
import { describe, it, expect } from "vitest";
import {
  validateContentItem,
  validateContentArray,
  validateFinding,
  validateSection,
  validateFindingRefs,
  validateReportPayload,
  isValidSlug,
  validateQuery,
  isValidReasoningLevel,
} from "../shared/validation";
import type { Section, Finding } from "../shared/types";

// ── Content Item Validation ─────────────────────────────────────────────────

describe("validateContentItem", () => {
  it("accepts a valid finding ref", () => {
    expect(validateContentItem({ type: "finding", id: "f1" })).toEqual({ valid: true });
  });

  it("accepts a valid text content", () => {
    expect(validateContentItem({ type: "text", value: "some text" })).toEqual({ valid: true });
  });

  it("accepts a valid break", () => {
    expect(validateContentItem({ type: "break" })).toEqual({ valid: true });
  });

  it("accepts text with empty string value", () => {
    expect(validateContentItem({ type: "text", value: "" })).toEqual({ valid: true });
  });

  it("rejects null", () => {
    expect(validateContentItem(null).valid).toBe(false);
  });

  it("rejects undefined", () => {
    expect(validateContentItem(undefined).valid).toBe(false);
  });

  it("rejects non-object", () => {
    expect(validateContentItem("finding").valid).toBe(false);
    expect(validateContentItem(42).valid).toBe(false);
  });

  it("rejects item without type", () => {
    const result = validateContentItem({ id: "f1" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("type");
  });

  it("rejects item with non-string type", () => {
    expect(validateContentItem({ type: 42 }).valid).toBe(false);
  });

  it("rejects unknown type", () => {
    const result = validateContentItem({ type: "image" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("image");
  });

  it("rejects finding ref with empty id", () => {
    const result = validateContentItem({ type: "finding", id: "" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("id");
  });

  it("rejects finding ref with non-string id", () => {
    const result = validateContentItem({ type: "finding", id: 42 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("id");
  });

  it("rejects finding ref without id", () => {
    const result = validateContentItem({ type: "finding" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("id");
  });

  it("rejects text without value", () => {
    const result = validateContentItem({ type: "text" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("value");
  });

  it("rejects text with non-string value", () => {
    const result = validateContentItem({ type: "text", value: 42 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("value");
  });
});

// ── Content Array Validation ────────────────────────────────────────────────

describe("validateContentArray", () => {
  it("accepts an empty array", () => {
    expect(validateContentArray([])).toEqual({ valid: true, errors: [] });
  });

  it("accepts a valid content array with all types", () => {
    const content = [
      { type: "finding", id: "f1" },
      { type: "text", value: ", which suggests " },
      { type: "finding", id: "f2" },
      { type: "text", value: "." },
      { type: "break" },
      { type: "finding", id: "f3" },
    ];
    expect(validateContentArray(content)).toEqual({ valid: true, errors: [] });
  });

  it("rejects non-array", () => {
    expect(validateContentArray("not array").valid).toBe(false);
    expect(validateContentArray(null).valid).toBe(false);
    expect(validateContentArray(42).valid).toBe(false);
  });

  it("reports all errors with indices", () => {
    const content = [
      { type: "finding", id: "f1" },
      { type: "text" }, // missing value
      { type: "unknown" }, // unknown type
      { type: "finding" }, // missing id
    ];
    const result = validateContentArray(content);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
    expect(result.errors[0]).toContain("content[1]");
    expect(result.errors[1]).toContain("content[2]");
    expect(result.errors[2]).toContain("content[3]");
  });

  it("accepts a single text item", () => {
    expect(validateContentArray([{ type: "text", value: "Hello" }])).toEqual({
      valid: true,
      errors: [],
    });
  });
});

// ── Finding Validation ──────────────────────────────────────────────────────

describe("validateFinding", () => {
  const validFinding = {
    id: "f1",
    section: "investment_thesis",
    text: "Revenue grew 30% YoY",
    certainty: 85,
    explanation: {
      title: "Revenue Growth",
      text: "The company reported strong revenue growth...",
      supportingEvidence: [{ source: "SEC Filing", quote: "Revenue was $30B", url: "https://sec.gov" }],
      contraryEvidence: [],
    },
  };

  it("accepts a valid finding", () => {
    const result = validateFinding(validFinding);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a finding without certainty", () => {
    const { certainty, ...noCertainty } = validFinding;
    expect(validateFinding(noCertainty).valid).toBe(true);
  });

  it("rejects null/non-object", () => {
    expect(validateFinding(null).valid).toBe(false);
    expect(validateFinding("string").valid).toBe(false);
    expect(validateFinding(42).valid).toBe(false);
  });

  it("rejects finding without id", () => {
    const { id, ...noId } = validFinding;
    const result = validateFinding(noId);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("rejects finding without section", () => {
    const { section, ...noSection } = validFinding;
    const result = validateFinding(noSection);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("section"))).toBe(true);
  });

  it("rejects finding without text", () => {
    const { text, ...noText } = validFinding;
    const result = validateFinding(noText);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("text"))).toBe(true);
  });

  it("rejects certainty below 0", () => {
    const result = validateFinding({ ...validFinding, certainty: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("certainty"))).toBe(true);
  });

  it("rejects certainty above 100", () => {
    const result = validateFinding({ ...validFinding, certainty: 101 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("certainty"))).toBe(true);
  });

  it("accepts certainty at boundaries (0 and 100)", () => {
    expect(validateFinding({ ...validFinding, certainty: 0 }).valid).toBe(true);
    expect(validateFinding({ ...validFinding, certainty: 100 }).valid).toBe(true);
  });

  it("rejects non-numeric certainty", () => {
    const result = validateFinding({ ...validFinding, certainty: "high" });
    expect(result.valid).toBe(false);
  });

  it("rejects finding without explanation", () => {
    const { explanation, ...noExp } = validFinding;
    const result = validateFinding(noExp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("explanation"))).toBe(true);
  });

  it("rejects explanation without title", () => {
    const result = validateFinding({
      ...validFinding,
      explanation: { ...validFinding.explanation, title: undefined },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("title"))).toBe(true);
  });

  it("rejects explanation without supportingEvidence", () => {
    const result = validateFinding({
      ...validFinding,
      explanation: { ...validFinding.explanation, supportingEvidence: undefined },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("supportingEvidence"))).toBe(true);
  });

  it("rejects explanation without contraryEvidence", () => {
    const result = validateFinding({
      ...validFinding,
      explanation: { ...validFinding.explanation, contraryEvidence: "none" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("contraryEvidence"))).toBe(true);
  });

  it("collects multiple errors at once", () => {
    const result = validateFinding({ certainty: 150 });
    expect(result.errors.length).toBeGreaterThanOrEqual(4); // id, section, text, certainty, explanation
  });
});

// ── Section Validation ──────────────────────────────────────────────────────

describe("validateSection", () => {
  const validSection = {
    id: "investment_thesis",
    title: "Investment Thesis",
    content: [
      { type: "finding", id: "f1" },
      { type: "text", value: " supports the thesis." },
    ],
  };

  it("accepts a valid section", () => {
    expect(validateSection(validSection).valid).toBe(true);
  });

  it("accepts a section with no content", () => {
    expect(validateSection({ id: "s1", title: "Title" }).valid).toBe(true);
  });

  it("accepts a section with empty content array", () => {
    expect(validateSection({ id: "s1", title: "Title", content: [] }).valid).toBe(true);
  });

  it("accepts valid layouts", () => {
    for (const layout of ["title", "content", "two-column", "stats", "bullets"]) {
      expect(validateSection({ ...validSection, layout }).valid).toBe(true);
    }
  });

  it("rejects invalid layout", () => {
    const result = validateSection({ ...validSection, layout: "grid" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("layout"))).toBe(true);
  });

  it("rejects null/non-object", () => {
    expect(validateSection(null).valid).toBe(false);
    expect(validateSection("section").valid).toBe(false);
  });

  it("rejects section without id", () => {
    const result = validateSection({ title: "T", content: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("rejects section without title", () => {
    const result = validateSection({ id: "s1", content: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("title"))).toBe(true);
  });

  it("reports content validation errors with section prefix", () => {
    const result = validateSection({
      id: "s1",
      title: "Title",
      content: [{ type: "finding" }], // missing id
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("section.content[0]"))).toBe(true);
  });
});

// ── Cross-Reference Validation ──────────────────────────────────────────────

describe("validateFindingRefs", () => {
  it("passes when all refs match findings", () => {
    const sections: Section[] = [
      {
        id: "s1",
        title: "Section 1",
        content: [
          { type: "finding", id: "f1" },
          { type: "text", value: " and " },
          { type: "finding", id: "f2" },
        ],
      },
    ];
    const findings: Finding[] = [
      { id: "f1", section: "s1", text: "Finding 1", explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } },
      { id: "f2", section: "s1", text: "Finding 2", explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } },
    ];

    const result = validateFindingRefs(sections, findings);
    expect(result.valid).toBe(true);
    expect(result.orphanedRefs).toEqual([]);
    expect(result.unusedFindings).toEqual([]);
  });

  it("detects orphaned refs (content refs to non-existent findings)", () => {
    const sections: Section[] = [
      {
        id: "s1",
        title: "Section 1",
        content: [{ type: "finding", id: "f1" }, { type: "finding", id: "f99" }],
      },
    ];
    const findings: Finding[] = [
      { id: "f1", section: "s1", text: "Finding 1", explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } },
    ];

    const result = validateFindingRefs(sections, findings);
    expect(result.valid).toBe(false);
    expect(result.orphanedRefs).toEqual(["f99"]);
  });

  it("detects unused findings (findings not referenced in any content)", () => {
    const sections: Section[] = [
      {
        id: "s1",
        title: "Section 1",
        content: [{ type: "finding", id: "f1" }],
      },
    ];
    const findings: Finding[] = [
      { id: "f1", section: "s1", text: "Finding 1", explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } },
      { id: "f2", section: "s1", text: "Finding 2", explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } },
      { id: "f3", section: "s2", text: "Finding 3", explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } },
    ];

    const result = validateFindingRefs(sections, findings);
    expect(result.valid).toBe(true); // orphaned refs is what makes it invalid
    expect(result.unusedFindings).toEqual(["f2", "f3"]);
  });

  it("handles empty sections and findings", () => {
    const result = validateFindingRefs([], []);
    expect(result.valid).toBe(true);
    expect(result.orphanedRefs).toEqual([]);
    expect(result.unusedFindings).toEqual([]);
  });

  it("handles sections with only text and break content", () => {
    const sections: Section[] = [
      {
        id: "s1",
        title: "Section 1",
        content: [{ type: "text", value: "intro" }, { type: "break" }, { type: "text", value: "more text" }],
      },
    ];
    const findings: Finding[] = [
      { id: "f1", section: "s1", text: "Finding 1", explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } },
    ];

    const result = validateFindingRefs(sections, findings);
    expect(result.valid).toBe(true);
    expect(result.unusedFindings).toEqual(["f1"]);
  });

  it("handles refs across multiple sections", () => {
    const sections: Section[] = [
      {
        id: "s1",
        title: "Section 1",
        content: [{ type: "finding", id: "f1" }],
      },
      {
        id: "s2",
        title: "Section 2",
        content: [{ type: "finding", id: "f2" }, { type: "finding", id: "f3" }],
      },
    ];
    const findings: Finding[] = [
      { id: "f1", section: "s1", text: "F1", explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } },
      { id: "f2", section: "s2", text: "F2", explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } },
      { id: "f3", section: "s2", text: "F3", explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } },
    ];

    const result = validateFindingRefs(sections, findings);
    expect(result.valid).toBe(true);
    expect(result.orphanedRefs).toEqual([]);
    expect(result.unusedFindings).toEqual([]);
  });
});

// ── Report Payload Validation ───────────────────────────────────────────────

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
    const result = validateReportPayload({ sections: [], findings: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("meta");
  });

  it("rejects report with null meta", () => {
    const result = validateReportPayload({ meta: null, sections: [], findings: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("meta");
  });

  it("rejects report without sections", () => {
    const result = validateReportPayload({ meta: {}, findings: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("sections");
  });

  it("rejects report with non-array sections", () => {
    const result = validateReportPayload({ meta: {}, sections: "not array", findings: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("sections");
  });

  it("rejects report without findings", () => {
    const result = validateReportPayload({ meta: {}, sections: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("findings");
  });

  it("rejects report with non-array findings", () => {
    const result = validateReportPayload({ meta: {}, sections: [], findings: {} });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("findings");
  });

  it("rejects report with too many findings (> 200)", () => {
    const findings = Array.from({ length: 201 }, (_, i) => ({ id: `f${i}`, text: `Finding ${i}` }));
    const result = validateReportPayload({ meta: {}, sections: [], findings });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too many findings");
  });

  it("accepts report with exactly 200 findings", () => {
    const findings = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, text: `Finding ${i}` }));
    expect(validateReportPayload({ meta: {}, sections: [], findings })).toEqual({ valid: true });
  });

  it("rejects report with too many sections (> 50)", () => {
    const sections = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, title: `Section ${i}` }));
    const result = validateReportPayload({ meta: {}, sections, findings: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too many sections");
  });

  it("accepts report with exactly 50 sections", () => {
    const sections = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, title: `Section ${i}` }));
    expect(validateReportPayload({ meta: {}, sections, findings: [] })).toEqual({ valid: true });
  });
});

// ── Slug Validation ─────────────────────────────────────────────────────────

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
    expect(isValidSlug("nvda_test")).toBe(false);
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

// ── Query Validation ────────────────────────────────────────────────────────

describe("query validation", () => {
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

  it("rejects queries longer than max length", () => {
    const long = "a".repeat(5001);
    expect(validateQuery(long).valid).toBe(false);
  });

  it("accepts query at max length", () => {
    const exact = "a".repeat(5000);
    expect(validateQuery(exact).valid).toBe(true);
  });
});

// ── Reasoning Level Validation ──────────────────────────────────────────────

describe("reasoning level validation", () => {
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
