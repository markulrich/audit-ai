import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

function createChunkedSseResponse(chunks) {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
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

describe("App SSE parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a report when event and data are in the same chunk", async () => {
    const report = {
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
    await user.click(screen.getByRole("button", { name: "Analyze NVIDIA (NVDA)" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("renders a report when event and data arrive in separate chunks", async () => {
    const report = {
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
    await user.click(screen.getByRole("button", { name: "Analyze NVIDIA (NVDA)" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("renders a report when SSE data line is formatted as data:<json>", async () => {
    const report = {
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
    await user.click(screen.getByRole("button", { name: "Analyze NVIDIA (NVDA)" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("renders a report when backend returns a plain JSON 200 body", async () => {
    const report = {
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
    await user.click(screen.getByRole("button", { name: "Analyze NVIDIA (NVDA)" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "NVIDIA (NVDA)" })).toBeInTheDocument();
    });
  });

  it("shows backend error when stream contains progress then error", async () => {
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
    await user.click(screen.getByRole("button", { name: "Analyze NVIDIA (NVDA)" }));

    await waitFor(() => {
      expect(screen.getByText("Generation Failed")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Report generation failed. Please try a different query.")
    ).toBeInTheDocument();
  });
});
