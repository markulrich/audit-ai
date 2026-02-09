import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { DomainProfile } from "../../shared/types";

vi.mock("../anthropic-client", (): { tracedCreate: Mock; ANTHROPIC_MODEL: string } => ({
  tracedCreate: vi.fn(),
  ANTHROPIC_MODEL: "claude-haiku-4-5",
}));

import { classifyDomain } from "./classifier";
import { tracedCreate } from "../anthropic-client";

const mockedTracedCreate = tracedCreate as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAiResponse(text: string): void {
  mockedTracedCreate.mockResolvedValueOnce({
    response: { content: [{ type: "text", text }], stop_reason: "end_turn" },
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
  vi.clearAllMocks();
});

describe("classifier agent", () => {
  it("classifies equity query as equity_research + written_report", async () => {
    mockAiResponse(JSON.stringify({
      domain: "equity_research",
      outputFormat: "written_report",
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      focusAreas: ["financials", "competition"],
      timeframe: "current",
    }));

    const { result } = await classifyDomain("Analyze NVIDIA", undefined);
    expect(result.domain).toBe("equity_research");
    expect(result.outputFormat).toBe("written_report");
    expect(result.ticker).toBe("NVDA");
    expect(result.companyName).toBe("NVIDIA Corporation");
  });

  it("classifies pitch deck query as pitch_deck + slide_deck", async () => {
    mockAiResponse(JSON.stringify({
      domain: "pitch_deck",
      outputFormat: "slide_deck",
      ticker: "N/A",
      companyName: "AI Legal Tech Startup",
      focusAreas: ["market_opportunity", "competition"],
      timeframe: "current",
    }));

    const { result } = await classifyDomain("Pitch deck for an AI legal startup", undefined);
    expect(result.domain).toBe("pitch_deck");
    expect(result.outputFormat).toBe("slide_deck");
    expect(result.defaultOutputFormat).toBe("slide_deck");
    expect(result.sections).toContain("title_slide");
    expect(result.sections).toContain("the_ask");
  });

  it("detects format override: slide deck about equity topic", async () => {
    mockAiResponse(JSON.stringify({
      domain: "equity_research",
      outputFormat: "slide_deck",
      ticker: "TSLA",
      companyName: "Tesla Inc",
      focusAreas: ["financials"],
      timeframe: "current",
    }));

    const { result } = await classifyDomain("Slide deck about Tesla's financials", undefined);
    expect(result.domain).toBe("equity_research");
    expect(result.outputFormat).toBe("slide_deck");
    // Should use equity_research sections, not pitch_deck sections
    expect(result.sections).toContain("investment_thesis");
    expect(result.sections).not.toContain("title_slide");
  });

  it("falls back to equity_research + written_report on parse failure", async () => {
    mockAiResponse("Sorry, I cannot classify this query.");

    const { result } = await classifyDomain("gibberish input", undefined);
    expect(result.domain).toBe("equity_research");
    expect(result.outputFormat).toBe("written_report");
    expect(result.ticker).toBe("N/A");
  });

  it("falls back to equity_research for unknown domain", async () => {
    mockAiResponse(JSON.stringify({
      domain: "unknown_domain",
      outputFormat: "written_report",
      ticker: "TEST",
      companyName: "Test Corp",
    }));

    const { result } = await classifyDomain("some query", undefined);
    expect(result.domain).toBe("equity_research");
  });

  it("falls back to default outputFormat when invalid format provided", async () => {
    mockAiResponse(JSON.stringify({
      domain: "equity_research",
      outputFormat: "invalid_format",
      ticker: "TEST",
      companyName: "Test Corp",
    }));

    const { result } = await classifyDomain("some query", undefined);
    expect(result.outputFormat).toBe("written_report");
  });

  it("falls back to default on empty response", async () => {
    mockEmptyResponse();

    const { result } = await classifyDomain("some query", undefined);
    expect(result.domain).toBe("equity_research");
    expect(result.outputFormat).toBe("written_report");
  });

  it("strips markdown fences from response", async () => {
    mockAiResponse("```json\n" + JSON.stringify({
      domain: "pitch_deck",
      outputFormat: "slide_deck",
      ticker: "N/A",
      companyName: "Startup",
    }) + "\n```");

    const { result } = await classifyDomain("pitch deck for a startup", undefined);
    expect(result.domain).toBe("pitch_deck");
    expect(result.outputFormat).toBe("slide_deck");
  });
});
