import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Mock classify response (returned by /api/classify)
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
 * Smart fetch mock that routes requests to appropriate responses:
 * - /api/classify → classify JSON response
 * - /api/jobs (POST) → create job JSON response
 * - /api/jobs/:id/events (GET) → SSE response
 * - /api/reports/save → save JSON response
 * - /api/reports/:slug/job → 404 (no pre-existing job)
 */
function mockFetchForHomepage(sseResponse: ChunkedSseResponse) {
  return vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
    if (typeof url === "string" && url.includes("/api/classify")) {
      return Promise.resolve(createClassifyResponse());
    }
    if (typeof url === "string" && url.includes("/api/reports/save")) {
      return Promise.resolve(createJsonResponse({ slug: "nvda-test", version: 1, url: "/reports/nvda-test" }));
    }
    // Job creation endpoint (POST /api/jobs)
    if (typeof url === "string" && url === "/api/jobs" && opts?.method === "POST") {
      return Promise.resolve(createJsonResponse({ jobId: "job-test-123", slug: "nvda-test", status: "queued" }));
    }
    // Job events endpoint (GET /api/jobs/:id/events) → SSE stream
    if (typeof url === "string" && url.includes("/api/jobs/") && url.includes("/events")) {
      return Promise.resolve(sseResponse);
    }
    // Report job lookup (GET /api/reports/:slug/job) → 404
    if (typeof url === "string" && url.match(/\/api\/reports\/[^/]+\/job$/)) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "Not found" }) });
    }
    // Report load (GET /api/reports/:slug) → 404 for new reports
    if (typeof url === "string" && url.match(/\/api\/reports\/[a-z0-9-]+$/)) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "Not found" }) });
    }
    return Promise.resolve(sseResponse);
  });
}

// Helper: submit a query via the homepage QueryInput example chips
async function submitFromHomepage(user: ReturnType<typeof userEvent.setup>, queryText: string) {
  // Homepage shows QueryInput with example chip buttons
  const chip = screen.getByRole("button", { name: queryText });
  await user.click(chip);
}

describe("App SSE parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset URL that may have been changed by navigation
    window.history.pushState(null, "", "/");
  });

  it("renders a report when event and data are in the same chunk", async () => {
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
          `event: report\ndata: ${JSON.stringify(report)}\n\n`,
          "event: done\ndata: {\"success\":true}\n\n",
        ])
      )
    );

    render(<App />);
    const user = userEvent.setup();
    await submitFromHomepage(user, "Analyze NVIDIA (NVDA)");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("renders a report when event and data arrive in separate chunks", async () => {
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
    const user = userEvent.setup();
    await submitFromHomepage(user, "Analyze NVIDIA (NVDA)");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("renders a report when SSE data line is formatted as data:<json>", async () => {
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
          "event: report\n",
          `data:${JSON.stringify(report)}\n\n`,
        ])
      )
    );

    render(<App />);
    const user = userEvent.setup();
    await submitFromHomepage(user, "Analyze NVIDIA (NVDA)");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("renders a report when backend returns a plain JSON 200 body", async () => {
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
        createChunkedSseResponse([JSON.stringify(report)])
      )
    );

    render(<App />);
    const user = userEvent.setup();
    await submitFromHomepage(user, "Analyze NVIDIA (NVDA)");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("shows error message when stream contains progress then error", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchForHomepage(
        createChunkedSseResponse([
          "event: progress\n",
          'data: {"stage":"classifying","message":"Analyzing your query...","percent":5}\n\n',
          "event: error\n",
          'data: {"message":"Report generation failed. Please try a different query."}\n\n',
        ])
      )
    );

    render(<App />);
    const user = userEvent.setup();
    await submitFromHomepage(user, "Analyze NVIDIA (NVDA)");

    await waitFor(() => {
      const matches = screen.getAllByText("Report generation failed. Please try a different query.");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});
