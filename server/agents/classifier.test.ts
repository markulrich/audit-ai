import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock the anthropic client before importing the module under test
vi.mock("../anthropic-client", (): { tracedCreate: Mock; ANTHROPIC_MODEL: string } => ({
  tracedCreate: vi.fn(),
  ANTHROPIC_MODEL: "mock-model",
}));

import { classifyDomain } from "./classifier";
import { tracedCreate } from "../anthropic-client";

const mockedTracedCreate = tracedCreate as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Makes tracedCreate return text as if the AI produced it. */
function mockAiResponse(text: string): void {
  mockedTracedCreate.mockResolvedValueOnce({
    response: { content: [{ type: "text", text }], stop_reason: "end_turn" },
    trace: {},
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("classifier agent", () => {
  // ── Equity research detection ───────────────────────────────────────────

  it("detects equity research domain with written_report format", async () => {
    mockAiResponse(
      JSON.stringify({
        domain: "equity_research",
        outputFormat: "written_report",
        ticker: "NVDA",
        companyName: "NVIDIA",
      }),
    );

    const { result } = await classifyDomain("Analyze NVIDIA stock", undefined);

    expect(result.domain).toBe("equity_research");
    expect(result.outputFormat).toBe("written_report");
    expect(result.ticker).toBe("NVDA");
    expect(result.companyName).toBe("NVIDIA");
    expect(result.sections).toContain("investment_thesis");
  });

  // ── Pitch deck detection ────────────────────────────────────────────────

  it("detects pitch deck domain with slide_deck format", async () => {
    mockAiResponse(
      JSON.stringify({
        domain: "pitch_deck",
        outputFormat: "slide_deck",
        ticker: "",
        companyName: "TechStartup",
      }),
    );

    const { result } = await classifyDomain("Create a pitch deck for TechStartup", undefined);

    expect(result.domain).toBe("pitch_deck");
    expect(result.outputFormat).toBe("slide_deck");
    expect(result.sections).toContain("title_slide");
    expect(result.sections).toContain("the_ask");
  });

  // ── Format override ─────────────────────────────────────────────────────

  it("allows output format override independent of domain", async () => {
    mockAiResponse(
      JSON.stringify({
        domain: "equity_research",
        outputFormat: "slide_deck",
        ticker: "TSLA",
        companyName: "Tesla",
      }),
    );

    const { result } = await classifyDomain("Make a slide deck about Tesla financials", undefined);

    expect(result.domain).toBe("equity_research");
    expect(result.outputFormat).toBe("slide_deck");
    expect(result.ticker).toBe("TSLA");
    // Sections come from the domain (equity_research), not the output format
    expect(result.sections).toContain("investment_thesis");
  });

  // ── Fallback on parse error ─────────────────────────────────────────────

  it("falls back to equity_research + written_report on parse error", async () => {
    mockAiResponse("I'm sorry, I cannot classify this query properly.");

    const { result } = await classifyDomain("some weird query", undefined);

    expect(result.domain).toBe("equity_research");
    expect(result.outputFormat).toBe("written_report");
    expect(result.ticker).toBe("N/A");
    expect(result.companyName).toBe("some weird query");
  });

  // ── Fallback on unknown domain ──────────────────────────────────────────

  it("falls back to equity_research when AI returns an unknown domain", async () => {
    mockAiResponse(
      JSON.stringify({
        domain: "unknown_domain",
        outputFormat: "written_report",
        ticker: "X",
        companyName: "X",
      }),
    );

    const { result } = await classifyDomain("Analyze X", undefined);

    expect(result.domain).toBe("equity_research");
    expect(result.sections).toContain("investment_thesis");
  });
});
