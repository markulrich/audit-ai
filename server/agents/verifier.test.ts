import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type {
  Report,
  ReportMeta,
  DomainProfile,
  Finding,
  Section,
} from "../../shared/types";

// Mock the anthropic client before importing the module under test
vi.mock("../anthropic-client", (): { tracedCreate: Mock } => ({
  tracedCreate: vi.fn(),
}));

import { verify } from "./verifier";
import { tracedCreate } from "../anthropic-client";

const mockedTracedCreate = tracedCreate as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A draft report where meta may be absent or null (to test fallback paths). */
interface Draft {
  meta?: ReportMeta | null;
  sections: Section[];
  findings: Finding[];
}

interface MakeDraftOptions {
  includeMeta?: boolean;
  findings?: Finding[];
}

interface MakeVerifiedReportOptions {
  includeMeta?: boolean;
  metaOverallCertainty?: number | null;
}

/** Minimal domain profile required by verify() */
const domainProfile = {
  ticker: "TEST",
  companyName: "Test Corp",
} as DomainProfile;

/** Builds a minimal valid draft (the output of the synthesizer stage). */
function makeDraft({ includeMeta = true, findings }: MakeDraftOptions = {}): Draft {
  const defaultFindings: Finding[] = [
    {
      id: "f1",
      section: "investment_thesis",
      text: "Test Corp revenue grew 20% year-over-year",
      explanation: {
        title: "Revenue Growth",
        text: "Revenue increased significantly.",
        supportingEvidence: [
          { source: "SEC Filing", quote: "Revenue was $10B", url: "sec.gov" },
        ],
        contraryEvidence: [],
      },
    },
    {
      id: "f2",
      section: "investment_thesis",
      text: "Test Corp has 40% market share",
      explanation: {
        title: "Market Share",
        text: "Dominant position in the market.",
        supportingEvidence: [
          { source: "Gartner", quote: "40% share", url: "gartner.com" },
        ],
        contraryEvidence: [],
      },
    },
  ];

  const draft: Draft = {
    sections: [
      {
        id: "investment_thesis",
        title: "Investment Thesis",
        content: [
          { type: "finding", id: "f1" },
          { type: "text", value: ", and " },
          { type: "finding", id: "f2" },
          { type: "text", value: "." },
        ],
      },
    ],
    findings: findings ?? defaultFindings,
  };

  if (includeMeta) {
    draft.meta = {
      title: "Test Corp (TEST)",
      subtitle: "Equity Research",
    };
  }

  return draft;
}

/** Builds a full verified report (what the AI ideally returns). */
function makeVerifiedReport({ includeMeta = true, metaOverallCertainty = 80 }: MakeVerifiedReportOptions = {}): Draft {
  const report = makeDraft({ includeMeta });
  // Add certainty to each finding (verifier's job)
  report.findings = report.findings.map((f) => ({ ...f, certainty: 80 }));
  if (includeMeta && metaOverallCertainty !== null) {
    report.meta!.overallCertainty = metaOverallCertainty;
  }
  return report;
}

/** Makes tracedCreate return text as if the AI produced it. */
function mockAiResponse(text: string): void {
  mockedTracedCreate.mockResolvedValueOnce({
    response: { content: [{ type: "text", text }], stop_reason: "end_turn" },
    trace: {},
  });
}

/** Makes tracedCreate return an empty / missing content response. */
function mockEmptyResponse(): void {
  mockedTracedCreate.mockResolvedValueOnce({
    response: { content: [], stop_reason: "end_turn" },
    trace: {},
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("verifier agent", () => {
  // ── Happy path ──────────────────────────────────────────────────────────

  it("parses a clean JSON response from the AI", async () => {
    const expected = makeVerifiedReport();
    mockAiResponse(JSON.stringify(expected));

    const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, undefined);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].certainty).toBe(80);
    expect(result.meta.overallCertainty).toBe(80);
  });

  it("strips markdown fences before parsing", async () => {
    const expected = makeVerifiedReport();
    mockAiResponse("```json\n" + JSON.stringify(expected) + "\n```");

    const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, undefined);
    expect(result.findings).toHaveLength(2);
    expect(result.meta.overallCertainty).toBe(80);
  });

  // ── Bug #1 fix: handle missing meta in AI response ─────────────────────
  //
  // Previously, when the AI returned valid JSON but omitted "meta",
  // line 156 threw: report.meta.overallCertainty → TypeError
  // The TypeError cascaded through all fallback paths, silently
  // discarding the AI's verified certainty scores and returning
  // the draft with default certainty=60.
  //
  // After fix: meta is initialized if missing, AI's certainty scores
  // are preserved, and overallCertainty is computed.

  describe("handles missing meta in AI response (was Bug #1)", () => {
    it("preserves AI certainty scores and initializes meta when missing", async () => {
      const badReport = makeVerifiedReport({ includeMeta: false });
      delete badReport.meta;
      mockAiResponse(JSON.stringify(badReport));

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, undefined);

      // AI's certainty=80 should be preserved, not replaced by default 60
      expect(result.findings[0].certainty).toBe(80);
      expect(result.findings[1].certainty).toBe(80);
      // meta should be auto-initialized with computed overallCertainty
      expect(result.meta).toBeDefined();
      expect(result.meta.overallCertainty).toBe(80);
    });

    it("preserves AI certainty scores when meta is null", async () => {
      const badReport = makeVerifiedReport();
      badReport.meta = null;
      mockAiResponse(JSON.stringify(badReport));

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, undefined);

      expect(result.findings[0].certainty).toBe(80);
      expect(result.meta).toBeDefined();
      expect(result.meta.overallCertainty).toBe(80);
    });
  });

  // ── Bug #2 fix: handle missing draft.meta in fallback ───────────────────
  //
  // Previously, when the AI response failed to parse AND the original
  // draft had no meta, line 196 threw:
  //   draft.meta.overallCertainty = ... → TypeError
  // This caused verify() to reject entirely, crashing the pipeline.
  //
  // After fix: draft.meta is initialized if missing, and the function
  // gracefully returns the draft with default certainty scores.

  describe("handles missing draft.meta in last-resort fallback (was Bug #2)", () => {
    it("returns draft with defaults when AI response is empty and draft has no meta", async () => {
      mockEmptyResponse();

      const draftWithoutMeta = makeDraft({ includeMeta: false });
      delete draftWithoutMeta.meta;

      const { result } = await verify("test query", domainProfile, draftWithoutMeta as unknown as Report, undefined);

      // Should not throw — should return draft with default scores
      expect(result.findings[0].certainty).toBe(60);
      expect(result.meta).toBeDefined();
      expect(result.meta.overallCertainty).toBe(60);
    });

    it("returns draft with defaults when AI response is empty and draft.meta is null", async () => {
      mockEmptyResponse();

      const draftWithNullMeta = makeDraft();
      draftWithNullMeta.meta = null;

      const { result } = await verify("test query", domainProfile, draftWithNullMeta as unknown as Report, undefined);

      expect(result.findings[0].certainty).toBe(60);
      expect(result.meta).toBeDefined();
      expect(result.meta.overallCertainty).toBe(60);
    });

    it("returns draft with defaults when AI returns unparseable text and draft has no meta", async () => {
      mockAiResponse("I apologize, I cannot complete this verification...");

      const draftWithoutMeta = makeDraft({ includeMeta: false });
      delete draftWithoutMeta.meta;

      const { result } = await verify("test query", domainProfile, draftWithoutMeta as unknown as Report, undefined);

      expect(result.findings[0].certainty).toBe(60);
      expect(result.meta).toBeDefined();
    });
  });

  // ── Bug #3 fix: proper JSON extraction from AI commentary ──────────────
  //
  // Previously, the greedy regex /\{[\s\S]*\}/ matched from the first
  // "{" in commentary to the last "}", capturing invalid JSON.
  //
  // After fix: the code walks through each '{' and tries JSON.parse
  // from that offset, finding the actual report object.

  describe("extracts JSON from AI commentary (was Bug #3)", () => {
    it("extracts correct JSON when response has brace characters in commentary", async () => {
      const validReport = makeVerifiedReport();
      const aiResponse =
        "Here is the verified report {note: reviewed carefully}:\n" +
        JSON.stringify(validReport) +
        "\n\nAll findings verified {complete}";

      mockAiResponse(aiResponse);

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, undefined);

      // Should extract the actual JSON object and preserve certainty=80
      expect(result.findings[0].certainty).toBe(80);
      expect(result.meta.overallCertainty).toBe(80);
    });

    it("extracts JSON when preceded by plain text commentary", async () => {
      const validReport = makeVerifiedReport();
      const aiResponse =
        "After careful review, here is the verified report:\n" +
        JSON.stringify(validReport);

      mockAiResponse(aiResponse);

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, undefined);

      expect(result.findings[0].certainty).toBe(80);
    });
  });

  // ── cleanOrphanedRefs ───────────────────────────────────────────────────

  describe("cleanOrphanedRefs removes deleted findings from sections", () => {
    it("removes finding refs that no longer exist in findings array", async () => {
      const report = makeVerifiedReport();
      // Remove f2 from findings but leave its ref in the section content
      report.findings = report.findings.filter((f) => f.id !== "f2");
      mockAiResponse(JSON.stringify(report));

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, undefined);
      const contentIds = result.sections[0].content
        .filter((c) => c.type === "finding")
        .map((c) => (c as { type: "finding"; id: string }).id);

      expect(contentIds).toEqual(["f1"]);
      expect(contentIds).not.toContain("f2");
    });
  });

  // ── overallCertainty computation ────────────────────────────────────────

  describe("overallCertainty fallback computation", () => {
    it("computes overallCertainty when AI omits it from meta", async () => {
      const report = makeVerifiedReport({ metaOverallCertainty: null });
      delete report.meta!.overallCertainty;
      mockAiResponse(JSON.stringify(report));

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, undefined);
      expect(result.meta.overallCertainty).toBe(80); // mean of [80, 80]
    });
  });
});
