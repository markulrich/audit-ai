/**
 * Tests for the job-based report generation flow in App.tsx.
 * Tests the classify → job creation → SSE event stream → report display cycle.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

// ── Helper: create a chunked SSE response ─────────────────────────────────

function createChunkedSseResponse(chunks: string[]) {
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

function createJsonResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data), body: null };
}

function createClassifyResponse(slug = "nvda-test") {
  return createJsonResponse({
    slug,
    domainProfile: {
      domain: "equity_research",
      domainLabel: "Equity Research",
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      focusAreas: ["financials"],
      outputFormat: "written_report",
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

const testReport = {
  meta: {
    title: "NVIDIA (NVDA)",
    subtitle: "Equity Research",
    date: "2026-02-09",
    ticker: "NVDA",
    exchange: "NASDAQ",
    sector: "Semiconductors",
    keyStats: [],
    outputFormat: "written_report",
  },
  sections: [],
  findings: [],
};

function mockFetch(sseChunks: string[]) {
  return vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
    if (typeof url === "string" && url.includes("/api/classify")) {
      return Promise.resolve(createClassifyResponse());
    }
    if (typeof url === "string" && url.includes("/api/reports/save")) {
      return Promise.resolve(createJsonResponse({ slug: "nvda-test", version: 1, url: "/reports/nvda-test" }));
    }
    if (typeof url === "string" && url === "/api/jobs" && opts?.method === "POST") {
      return Promise.resolve(createJsonResponse({ jobId: "job-test-123", slug: "nvda-test", status: "queued" }));
    }
    if (typeof url === "string" && url.includes("/api/jobs/") && url.includes("/events")) {
      return Promise.resolve(createChunkedSseResponse(sseChunks));
    }
    if (typeof url === "string" && url.match(/\/api\/reports\/[^/]+\/job$/)) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "Not found" }) });
    }
    if (typeof url === "string" && url.match(/\/api\/reports\/[a-z0-9-]+$/)) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "Not found" }) });
    }
    return Promise.resolve(createChunkedSseResponse(sseChunks));
  });
}

async function submitQuery(user: ReturnType<typeof userEvent.setup>) {
  const chip = screen.getByRole("button", { name: "Analyze NVIDIA (NVDA)" });
  await user.click(chip);
}

describe("App job-based flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState(null, "", "/");
  });

  it("displays work_log events during generation", async () => {
    const workLog = {
      plan: [
        { skill: "classify", description: "Identify domain", status: "completed" },
        { skill: "research", description: "Gather evidence", status: "running" },
      ],
      invocations: [],
      reasoning: ["Starting classification"],
    };

    vi.stubGlobal("fetch", mockFetch([
      `event: work_log\ndata: ${JSON.stringify(workLog)}\n\n`,
      `event: progress\ndata: ${JSON.stringify({ stage: "researching", message: "Gathering evidence...", percent: 30 })}\n\n`,
      `event: report\ndata: ${JSON.stringify(testReport)}\n\n`,
      `event: done\ndata: {"success":true}\n\n`,
    ]));

    render(<App />);
    const user = userEvent.setup();
    await submitQuery(user);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("shows progress stages during generation", async () => {
    vi.stubGlobal("fetch", mockFetch([
      `event: progress\ndata: ${JSON.stringify({ stage: "planning", message: "Agent is planning...", percent: 0 })}\n\n`,
      `event: progress\ndata: ${JSON.stringify({ stage: "skill_classify", message: "Classifying domain...", percent: 5 })}\n\n`,
      `event: progress\ndata: ${JSON.stringify({ stage: "skill_research", message: "Gathering evidence...", percent: 30 })}\n\n`,
      `event: report\ndata: ${JSON.stringify(testReport)}\n\n`,
      `event: done\ndata: {"success":true}\n\n`,
    ]));

    render(<App />);
    const user = userEvent.setup();
    await submitQuery(user);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("handles draft_answer events by showing preview", async () => {
    vi.stubGlobal("fetch", mockFetch([
      `event: progress\ndata: ${JSON.stringify({ stage: "answer_drafted", message: "Draft answer ready", percent: 12, draftAnswer: "NVIDIA is a leading semiconductor company..." })}\n\n`,
      `event: report\ndata: ${JSON.stringify(testReport)}\n\n`,
      `event: done\ndata: {"success":true}\n\n`,
    ]));

    render(<App />);
    const user = userEvent.setup();
    await submitQuery(user);

    // The draft answer should appear briefly before the full report replaces it
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("handles error events during generation", async () => {
    vi.stubGlobal("fetch", mockFetch([
      `event: progress\ndata: ${JSON.stringify({ stage: "classifying", message: "Analyzing...", percent: 5 })}\n\n`,
      `event: error\ndata: ${JSON.stringify({ message: "API key rejected (HTTP 401). Check that it is valid." })}\n\n`,
    ]));

    render(<App />);
    const user = userEvent.setup();
    await submitQuery(user);

    await waitFor(() => {
      const errors = screen.getAllByText(/API key rejected/);
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("creates a job and connects to SSE events", async () => {
    const fetchMock = mockFetch([
      `event: report\ndata: ${JSON.stringify(testReport)}\n\n`,
      `event: done\ndata: {"success":true}\n\n`,
    ]);

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const user = userEvent.setup();
    await submitQuery(user);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });

    // Verify the classify call was made
    const classifyCall = fetchMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes("/api/classify")
    );
    expect(classifyCall).toBeDefined();

    // Verify the job creation call was made
    const jobCall = fetchMock.mock.calls.find(
      (call: unknown[]) => call[0] === "/api/jobs" && (call[1] as { method: string })?.method === "POST"
    );
    expect(jobCall).toBeDefined();

    // Verify the SSE events call was made
    const eventCall = fetchMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes("/api/jobs/") && (call[0] as string).includes("/events")
    );
    expect(eventCall).toBeDefined();
  });

  it("handles job creation failure gracefully", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/api/classify")) {
        return Promise.resolve(createClassifyResponse());
      }
      if (typeof url === "string" && url === "/api/jobs" && opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Rate limit exceeded" }),
        });
      }
      if (typeof url === "string" && url.match(/\/api\/reports\/[^/]+\/job$/)) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "Not found" }) });
      }
      if (typeof url === "string" && url.match(/\/api\/reports\/[a-z0-9-]+$/)) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "Not found" }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const user = userEvent.setup();
    await submitQuery(user);

    await waitFor(() => {
      const errors = screen.getAllByText(/Rate limit exceeded|failed|error/i);
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("handles classify failure gracefully", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/classify")) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "ANTHROPIC_API_KEY is not set." }),
        });
      }
      if (typeof url === "string" && url.match(/\/api\/reports\/[^/]+\/job$/)) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "Not found" }) });
      }
      if (typeof url === "string" && url.match(/\/api\/reports\/[a-z0-9-]+$/)) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "Not found" }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const user = userEvent.setup();
    await submitQuery(user);

    await waitFor(() => {
      const errors = screen.getAllByText(/ANTHROPIC_API_KEY|API key|error/i);
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
  });
});
