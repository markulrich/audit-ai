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

describe("App browser streaming regression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

    await page.getByRole("button", { name: "Analyze NVIDIA (NVDA)" }).click();

    await waitFor(() => {
      expect(page.getByRole("heading", { name: "NVIDIA (NVDA)" }).query()).not.toBeNull();
    });

    expect(page.getByText("Generation Failed").query()).toBeNull();
  });
});
