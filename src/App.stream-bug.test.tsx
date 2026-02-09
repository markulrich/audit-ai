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

// Helper: type a query into the ChatPanel textarea and submit
async function submitQuery(user: ReturnType<typeof userEvent.setup>, queryText: string) {
  // The ChatPanel has example chip buttons — click one to submit
  const chip = screen.getByRole("button", { name: queryText });
  await user.click(chip);
}

describe("App SSE parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
      vi.fn().mockResolvedValue(
        createChunkedSseResponse([
          `event: report\ndata: ${JSON.stringify(report)}\n\n`,
          "event: done\ndata: {\"success\":true}\n\n",
        ])
      )
    );

    render(<App />);
    const user = userEvent.setup();
    await submitQuery(user, "Analyze NVIDIA (NVDA)");

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
      vi.fn().mockResolvedValue(
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
    await submitQuery(user, "Analyze NVIDIA (NVDA)");

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
      vi.fn().mockResolvedValue(
        createChunkedSseResponse([
          "event: report\n",
          `data:${JSON.stringify(report)}\n\n`,
        ])
      )
    );

    render(<App />);
    const user = userEvent.setup();
    await submitQuery(user, "Analyze NVIDIA (NVDA)");

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
      vi.fn().mockResolvedValue(
        createChunkedSseResponse([JSON.stringify(report)])
      )
    );

    render(<App />);
    const user = userEvent.setup();
    await submitQuery(user, "Analyze NVIDIA (NVDA)");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("shows error message when stream contains progress then error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
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
    await submitQuery(user, "Analyze NVIDIA (NVDA)");

    await waitFor(() => {
      const matches = screen.getAllByText("Report generation failed. Please try a different query.");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});
