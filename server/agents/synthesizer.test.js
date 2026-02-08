import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../anthropic-client.js", () => ({
  createMessage: vi.fn(),
}));

import { synthesize } from "./synthesizer.js";
import { createMessage } from "../anthropic-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const domainProfile = {
  ticker: "TEST",
  companyName: "Test Corp",
};

const evidence = [
  { source: "SEC Filing", quote: "Revenue was $10B", url: "sec.gov", category: "financial_data" },
];

function makeReport() {
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

function mockAiResponse(text, stopReason = "end_turn") {
  createMessage.mockResolvedValueOnce({
    content: [{ text }],
    stop_reason: stopReason,
  });
}

function mockEmptyResponse() {
  createMessage.mockResolvedValueOnce({ content: [] });
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

    const result = await synthesize("test query", domainProfile, evidence);
    expect(result.findings).toHaveLength(1);
    expect(result.meta.title).toBe("Test Corp (TEST)");
  });

  it("strips markdown fences before parsing", async () => {
    const expected = makeReport();
    mockAiResponse("```json\n" + JSON.stringify(expected) + "\n```");

    const result = await synthesize("test query", domainProfile, evidence);
    expect(result.findings).toHaveLength(1);
  });

  it("throws on empty AI response", async () => {
    mockEmptyResponse();

    await expect(
      synthesize("test query", domainProfile, evidence)
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

      const result = await synthesize("test query", domainProfile, evidence);
      // Should extract the actual JSON, not fall through to error
      expect(result.meta.title).toBe("Test Corp (TEST)");
      expect(result.findings).toHaveLength(1);
    });

    it("extracts JSON when preceded by plain text", async () => {
      const report = makeReport();
      mockAiResponse("Here is the report:\n" + JSON.stringify(report));

      const result = await synthesize("test query", domainProfile, evidence);
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
      const result = await synthesize("test query", domainProfile, evidence);
      expect(result.meta).toBeDefined();
      expect(result.meta.title).toBe("Test Corp (TEST)");
    });

    it("repairs even tiny truncated fragments when possible", async () => {
      // Even a tiny fragment can be repaired by closing open braces
      mockAiResponse('{"meta": {"tit', "max_tokens");

      // Repair closes the braces: {"meta": {}} — valid JSON
      const result = await synthesize("test query", domainProfile, evidence);
      expect(result.meta).toBeDefined();
    });
  });
});
