import { page } from "vitest/browser";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

interface ChunkedSseResponse {
  ok: boolean;
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value: Uint8Array | undefined }>;
    };
  };
}

function createChunkedSseResponse(chunks: string[]): ChunkedSseResponse {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read(): Promise<{ done: boolean; value: Uint8Array | undefined }> {
            if (index < chunks.length) {
              const value = encoder.encode(chunks[index]);
              index += 1;
              return { done: false, value };
            }
            return { done: true, value: undefined };
          },
        };
      },
    },
  };
}

interface ReportMeta {
  title: string;
  subtitle: string;
  date: string;
  ticker: string;
  exchange: string;
  sector: string;
  keyStats: unknown[];
}

interface Report {
  meta: ReportMeta;
  sections: unknown[];
  findings: unknown[];
}

// Mock JSON response helper
function createJsonResponse(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(data),
    body: null,
  };
}

// Mock classify response
function createClassifyResponse() {
  return createJsonResponse({
    slug: "nvda-test",
    domainProfile: {
      domain: "equity_research",
      domainLabel: "Equity Research",
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      focusAreas: ["financials"],
      timeframe: "current",
      sourceHierarchy: [],
      certaintyRubric: "factual_verification",
      evidenceStyle: "quantitative",
      contraryThreshold: "any_contradiction_lowers_score",
      toneTemplate: "investment_bank_equity_research",
      sections: [],
      reportMeta: { ratingOptions: [] },
    },
    trace: {},
  });
}

/**
 * Smart fetch mock that routes requests:
 * - /api/classify → classify JSON response
 * - /api/reports/save → save JSON response
 * - everything else → SSE response
 */
function mockFetchForHomepage(sseResponse: ChunkedSseResponse) {
  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/classify")) {
      return Promise.resolve(createClassifyResponse());
    }
    if (typeof url === "string" && url.includes("/api/reports/save")) {
      return Promise.resolve(createJsonResponse({ slug: "nvda-test", version: 1, url: "/reports/nvda-test" }));
    }
    return Promise.resolve(sseResponse);
  });
}

describe("App browser streaming regression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset URL that may have been changed by classify → navigate flow
    window.history.pushState(null, "", "/");
  });

  it("renders report when SSE event and data arrive in separate chunks", async () => {
    const report: Report = {
      meta: {
        title: "NVIDIA (NVDA)",
        subtitle: "Equity Research",
        date: "February 7, 2026",
        ticker: "NVDA",
        exchange: "NASDAQ",
        sector: "Semiconductors",
        keyStats: [],
      },
      sections: [],
      findings: [],
    };

    vi.stubGlobal(
      "fetch",
      mockFetchForHomepage(
        createChunkedSseResponse([
          "event: progress\n",
          'data: {"stage":"classifying","message":"Analyzing your query...","percent":5}\n\n',
          "event: report\n",
          `data: ${JSON.stringify(report)}\n\n`,
          "event: done\n",
          'data: {"success":true}\n\n',
        ])
      )
    );

    render(<App />);

    await page.getByRole("button", { name: "Analyze NVIDIA (NVDA)" }).click();

    await waitFor(() => {
      expect(page.getByRole("heading", { name: "NVIDIA (NVDA)" }).query()).not.toBeNull();
    });

    expect(page.getByText("Generation Failed").query()).toBeNull();
  });
});
