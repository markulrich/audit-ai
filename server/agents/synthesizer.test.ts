import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Report, DomainProfile, EvidenceItem } from "../../shared/types";

vi.mock("../anthropic-client", (): { tracedCreate: Mock } => ({
  tracedCreate: vi.fn(),
}));

import { synthesize } from "./synthesizer";
import { tracedCreate } from "../anthropic-client";

const mockedTracedCreate = tracedCreate as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const domainProfile = {
  ticker: "TEST",
  companyName: "Test Corp",
} as DomainProfile;

const evidence: EvidenceItem[] = [
  { source: "SEC Filing", quote: "Revenue was $10B", url: "sec.gov", category: "financial_data" },
];

function makeReport(): Report {
  return {
    meta: {
      title: "Test Corp (TEST)",
      subtitle: "Equity Research",
      rating: "Overweight",
      priceTarget: "$100",
      currentPrice: "$80",
      ticker: "TEST",
      exchange: "NASDAQ",
      sector: "Tech",
      keyStats: [],
    },
    sections: [
      {
        id: "investment_thesis",
        title: "Investment Thesis",
        content: [
          { type: "finding", id: "f1" },
          { type: "text", value: "." },
        ],
      },
    ],
    findings: [
      {
        id: "f1",
        section: "investment_thesis",
        text: "Test Corp revenue grew 20%",
        explanation: {
          title: "Revenue Growth",
          text: "Revenue increased.",
          supportingEvidence: [
            { source: "SEC Filing", quote: "Revenue was $10B", url: "sec.gov" },
          ],
          contraryEvidence: [],
        },
      },
    ],
  };
}

function mockAiResponse(text: string, stopReason: string = "end_turn"): void {
  mockedTracedCreate.mockResolvedValueOnce({
    response: { content: [{ type: "text", text }], stop_reason: stopReason },
    trace: {},
  });
}

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

describe("synthesizer agent", () => {
  it("parses clean JSON response", async () => {
    const expected = makeReport();
    mockAiResponse(JSON.stringify(expected));

    const { result } = await synthesize("test query", domainProfile, evidence, undefined);
    expect(result.findings).toHaveLength(1);
    expect(result.meta.title).toBe("Test Corp (TEST)");
  });

  it("strips markdown fences before parsing", async () => {
    const expected = makeReport();
    mockAiResponse("```json\n" + JSON.stringify(expected) + "\n```");

    const { result } = await synthesize("test query", domainProfile, evidence, undefined);
    expect(result.findings).toHaveLength(1);
  });

  it("throws on empty AI response", async () => {
    mockEmptyResponse();

    await expect(
      synthesize("test query", domainProfile, evidence, undefined)
    ).rejects.toThrow("Synthesis agent failed to produce valid report");
  });

  // ── Balanced-brace extraction (was greedy regex bug) ────────────────────

  describe("balanced-brace JSON extraction", () => {
    it("extracts JSON when AI wraps response in commentary with braces", async () => {
      const report = makeReport();
      const aiResponse =
        "Here is the report {note: see below}:\n" +
        JSON.stringify(report) +
        "\n\nDone {complete}";

      mockAiResponse(aiResponse);

      const { result } = await synthesize("test query", domainProfile, evidence, undefined);
      // Should extract the actual JSON, not fall through to error
      expect(result.meta.title).toBe("Test Corp (TEST)");
      expect(result.findings).toHaveLength(1);
    });

    it("extracts JSON when preceded by plain text", async () => {
      const report = makeReport();
      mockAiResponse("Here is the report:\n" + JSON.stringify(report));

      const { result } = await synthesize("test query", domainProfile, evidence, undefined);
      expect(result.findings).toHaveLength(1);
    });
  });

  // ── Truncated JSON repair ───────────────────────────────────────────────

  describe("truncated JSON repair (max_tokens)", () => {
    it("repairs truncated JSON when stop_reason is max_tokens", async () => {
      // Simulate a response truncated mid-way — meta is complete but findings array is cut
      const truncated = '{"meta":{"title":"Test Corp (TEST)","rating":"Overweight"},"sections":[],"findings":[{"id":"f1"';

      mockAiResponse(truncated, "max_tokens");

      // Should repair by closing the open brace, bracket, and outer brace
      const { result } = await synthesize("test query", domainProfile, evidence, undefined);
      expect(result.meta).toBeDefined();
      expect(result.meta.title).toBe("Test Corp (TEST)");
    });

    it("repairs even tiny truncated fragments when possible", async () => {
      // Even a tiny fragment can be repaired by closing open braces
      mockAiResponse('{"meta": {"tit', "max_tokens");

      // Repair closes the braces: {"meta": {}} — valid JSON
      const { result } = await synthesize("test query", domainProfile, evidence, undefined);
      expect(result.meta).toBeDefined();
    });
  });

  // ── Slide deck format ─────────────────────────────────────────────────
  describe("slide deck format", () => {
    it("parses slide deck JSON response", async () => {
      const slideDeckProfile = {
        ...domainProfile,
        domain: "pitch_deck",
        outputFormat: "slide_deck",
      } as DomainProfile;

      const slideReport: Report = {
        meta: {
          title: "TechStartup Pitch",
          subtitle: "Investor Presentation",
          outputFormat: "slide_deck",
          tagline: "AI-powered solutions",
          keyStats: [],
        },
        sections: [
          {
            id: "title_slide",
            title: "Title",
            layout: "title",
            content: [],
          },
          {
            id: "problem",
            title: "The Problem",
            layout: "content",
            content: [
              { type: "finding", id: "f1" },
            ],
            speakerNotes: "Key talking point about the problem.",
          },
        ],
        findings: [
          {
            id: "f1",
            section: "problem",
            text: "The market lacks an AI solution for legal research",
            explanation: {
              title: "Market Gap",
              text: "No existing product addresses this need.",
              supportingEvidence: [
                { source: "Industry Report", quote: "Legal tech is underserved", url: "general" },
              ],
              contraryEvidence: [],
            },
          },
        ],
      };

      mockAiResponse(JSON.stringify(slideReport));

      const { result } = await synthesize("pitch deck for AI legal tech", slideDeckProfile, evidence, undefined);
      expect(result.meta.outputFormat).toBe("slide_deck");
      expect(result.sections[0].layout).toBe("title");
      expect(result.sections[1].speakerNotes).toBe("Key talking point about the problem.");
      expect(result.findings).toHaveLength(1);
    });
  });
});
