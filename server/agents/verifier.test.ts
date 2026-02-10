import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type {
  Report,
  ReportMeta,
  DomainProfile,
  Finding,
  EvidenceItem,
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
  outputFormat: "written_report",
} as DomainProfile;

/** Slide deck domain profile */
const slideDeckProfile = {
  ticker: "TEST",
  companyName: "Test Corp",
  outputFormat: "slide_deck",
} as DomainProfile;

/** Minimal evidence array for tests */
const testEvidence: EvidenceItem[] = [
  { source: "SEC Filing", quote: "Revenue was $10B", url: "https://sec.gov/filing/123", category: "financial_data", authority: "official_filing" },
  { source: "Gartner", quote: "40% market share", url: "https://gartner.com/report/456", category: "market_data", authority: "industry_report" },
];

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
  vi.clearAllMocks();
});

describe("verifier agent", () => {
  // ── Happy path ──────────────────────────────────────────────────────────

  it("parses a clean JSON response from the AI", async () => {
    const expected = makeVerifiedReport();
    mockAiResponse(JSON.stringify(expected));

    const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, testEvidence, undefined);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].certainty).toBe(80);
    expect(result.meta.overallCertainty).toBe(80);
  });

  it("strips markdown fences before parsing", async () => {
    const expected = makeVerifiedReport();
    mockAiResponse("```json\n" + JSON.stringify(expected) + "\n```");

    const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, testEvidence, undefined);
    expect(result.findings).toHaveLength(2);
    expect(result.meta.overallCertainty).toBe(80);
  });

  // ── Bug #1 fix: handle missing meta in AI response ─────────────────────

  describe("handles missing meta in AI response (was Bug #1)", () => {
    it("preserves AI certainty scores and initializes meta when missing", async () => {
      const badReport = makeVerifiedReport({ includeMeta: false });
      delete badReport.meta;
      mockAiResponse(JSON.stringify(badReport));

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, testEvidence, undefined);

      expect(result.findings[0].certainty).toBe(80);
      expect(result.findings[1].certainty).toBe(80);
      expect(result.meta).toBeDefined();
      expect(result.meta.overallCertainty).toBe(80);
    });

    it("preserves AI certainty scores when meta is null", async () => {
      const badReport = makeVerifiedReport();
      badReport.meta = null;
      mockAiResponse(JSON.stringify(badReport));

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, testEvidence, undefined);

      expect(result.findings[0].certainty).toBe(80);
      expect(result.meta).toBeDefined();
      expect(result.meta.overallCertainty).toBe(80);
    });
  });

  // ── Bug #2 fix: handle missing draft.meta in fallback ───────────────────

  describe("handles missing draft.meta in last-resort fallback (was Bug #2)", () => {
    it("returns draft with defaults when AI response is empty and draft has no meta", async () => {
      mockEmptyResponse();

      const draftWithoutMeta = makeDraft({ includeMeta: false });
      delete draftWithoutMeta.meta;

      const { result } = await verify("test query", domainProfile, draftWithoutMeta as unknown as Report, testEvidence, undefined);

      expect(result.findings[0].certainty).toBe(60);
      expect(result.meta).toBeDefined();
      expect(result.meta.overallCertainty).toBe(60);
    });

    it("returns draft with defaults when AI response is empty and draft.meta is null", async () => {
      mockEmptyResponse();

      const draftWithNullMeta = makeDraft();
      draftWithNullMeta.meta = null;

      const { result } = await verify("test query", domainProfile, draftWithNullMeta as unknown as Report, testEvidence, undefined);

      expect(result.findings[0].certainty).toBe(60);
      expect(result.meta).toBeDefined();
      expect(result.meta.overallCertainty).toBe(60);
    });

    it("returns draft with defaults when AI returns unparseable text and draft has no meta", async () => {
      mockAiResponse("I apologize, I cannot complete this verification...");

      const draftWithoutMeta = makeDraft({ includeMeta: false });
      delete draftWithoutMeta.meta;

      const { result } = await verify("test query", domainProfile, draftWithoutMeta as unknown as Report, testEvidence, undefined);

      expect(result.findings[0].certainty).toBe(60);
      expect(result.meta).toBeDefined();
    });
  });

  // ── Bug #3 fix: proper JSON extraction from AI commentary ──────────────

  describe("extracts JSON from AI commentary (was Bug #3)", () => {
    it("extracts correct JSON when response has brace characters in commentary", async () => {
      const validReport = makeVerifiedReport();
      const aiResponse =
        "Here is the verified report {note: reviewed carefully}:\n" +
        JSON.stringify(validReport) +
        "\n\nAll findings verified {complete}";

      mockAiResponse(aiResponse);

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, testEvidence, undefined);

      expect(result.findings[0].certainty).toBe(80);
      expect(result.meta.overallCertainty).toBe(80);
    });

    it("extracts JSON when preceded by plain text commentary", async () => {
      const validReport = makeVerifiedReport();
      const aiResponse =
        "After careful review, here is the verified report:\n" +
        JSON.stringify(validReport);

      mockAiResponse(aiResponse);

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, testEvidence, undefined);

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

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, testEvidence, undefined);
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

      const { result } = await verify("test query", domainProfile, makeDraft() as unknown as Report, testEvidence, undefined);
      expect(result.meta.overallCertainty).toBe(80); // mean of [80, 80]
    });
  });

  // ── Slide deck field preservation ───────────────────────────────────────

  describe("slide deck field preservation", () => {
    function makeSlideProfile(): DomainProfile {
      return { ticker: "TEST", companyName: "Test Corp", outputFormat: "slide_deck", domain: "pitch_deck", domainLabel: "Pitch Deck", defaultOutputFormat: "slide_deck", sourceHierarchy: [], certaintyRubric: "", evidenceStyle: "", contraryThreshold: "", toneTemplate: "", sections: [], reportMeta: { ratingOptions: [] }, focusAreas: [], timeframe: "current" } as DomainProfile;
    }

    it("preserves slide-specific fields (layout, speakerNotes) through verification", async () => {
      const report = makeVerifiedReport();
      report.sections[0] = {
        ...report.sections[0],
        layout: "content" as const,
        subtitle: "Key Thesis Points",
        speakerNotes: "Discuss the main investment thesis here.",
      };
      mockAiResponse(JSON.stringify(report));

      const { result } = await verify("test query", makeSlideProfile(), makeDraft() as unknown as Report, testEvidence, undefined);
      expect(result.sections[0].layout).toBe("content");
      expect(result.sections[0].subtitle).toBe("Key Thesis Points");
      expect(result.sections[0].speakerNotes).toBe("Discuss the main investment thesis here.");
    });

    it("includes slide deck instruction in prompt when outputFormat is slide_deck", async () => {
      const report = makeVerifiedReport();
      mockAiResponse(JSON.stringify(report));

      await verify("test query", makeSlideProfile(), makeDraft() as unknown as Report, testEvidence, undefined);

      const callArgs = mockedTracedCreate.mock.calls[0][0];
      expect(callArgs.system).toContain("slide deck");
      expect(callArgs.system).toContain("layout");
      expect(callArgs.system).toContain("speakerNotes");
    });
  });

  // ── cleanOrphanedRefs: title_slide preservation ─────────────────────────

  describe("cleanOrphanedRefs preserves title_slide", () => {
    it("preserves title_slide sections with no findings", async () => {
      const slideProfile = { ticker: "TEST", companyName: "Test Corp", outputFormat: "slide_deck", domain: "pitch_deck", domainLabel: "Pitch Deck", defaultOutputFormat: "slide_deck", sourceHierarchy: [], certaintyRubric: "", evidenceStyle: "", contraryThreshold: "", toneTemplate: "", sections: [], reportMeta: { ratingOptions: [] }, focusAreas: [], timeframe: "current" } as DomainProfile;
      const report = makeVerifiedReport();
      report.sections.unshift({
        id: "title_slide",
        title: "Company Name",
        layout: "title" as const,
        content: [
          { type: "text" as const, value: "A brief description of the company" },
        ],
      });
      mockAiResponse(JSON.stringify(report));

      const { result } = await verify("test query", slideProfile, makeDraft() as unknown as Report, testEvidence, undefined);
      const titleSlide = result.sections.find((s) => s.id === "title_slide");
      expect(titleSlide).toBeDefined();
      expect(titleSlide!.content[0].type).toBe("text");
    });
  });

  // ── Evidence-aware verification ────────────────────────────────────────

  describe("evidence-aware verification", () => {
    it("passes raw evidence to the verifier prompt", async () => {
      const report = makeVerifiedReport();
      mockAiResponse(JSON.stringify(report));

      await verify("test query", domainProfile, makeDraft() as unknown as Report, testEvidence, undefined);

      const callArgs = mockedTracedCreate.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain("RAW EVIDENCE");
      expect(callArgs.messages[0].content).toContain("SEC Filing");
      expect(callArgs.messages[0].content).toContain("Gartner");
    });

    it("includes evidence count in prompt", async () => {
      const report = makeVerifiedReport();
      mockAiResponse(JSON.stringify(report));

      await verify("test query", domainProfile, makeDraft() as unknown as Report, testEvidence, undefined);

      const callArgs = mockedTracedCreate.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain(`RAW EVIDENCE (${testEvidence.length} items`);
    });

    it("handles empty evidence array gracefully", async () => {
      const report = makeVerifiedReport();
      mockAiResponse(JSON.stringify(report));

      await verify("test query", domainProfile, makeDraft() as unknown as Report, [], undefined);

      const callArgs = mockedTracedCreate.mock.calls[0][0];
      // No evidence section when array is empty
      expect(callArgs.messages[0].content).not.toContain("RAW EVIDENCE");
    });

    it("falls back to draft findings when verifier returns 0 findings", async () => {
      const report = makeDraft();
      report.findings = [];
      mockAiResponse(JSON.stringify(report));

      const draft = makeDraft() as unknown as Report;
      const { result } = await verify("test query", domainProfile, draft, testEvidence, undefined);
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0].certainty).toBe(15);
    });
  });
});
