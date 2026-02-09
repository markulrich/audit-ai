import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReportsPage from "./ReportsPage";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReportsPage", () => {
  it("shows loading state initially", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<ReportsPage onBack={vi.fn()} />);
    expect(screen.getByText("Loading reports...")).toBeInTheDocument();
  });

  it("shows empty state when no reports exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ reports: [] }),
      })
    );

    render(<ReportsPage onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No published reports yet.")).toBeInTheDocument();
    });
  });

  it("renders a list of reports with titles and tickers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            reports: [
              {
                slug: "nvda-abc1",
                title: "NVIDIA Corp Analysis",
                ticker: "NVDA",
                currentVersion: 2,
                createdAt: "2026-01-15T00:00:00.000Z",
                updatedAt: "2026-02-01T00:00:00.000Z",
              },
              {
                slug: "aapl-xyz9",
                title: "Apple Inc Report",
                ticker: null,
                currentVersion: 1,
                createdAt: "2026-01-10T00:00:00.000Z",
                updatedAt: "2026-01-10T00:00:00.000Z",
              },
            ],
          }),
      })
    );

    render(<ReportsPage onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("NVIDIA Corp Analysis")).toBeInTheDocument();
    });

    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getByText("Apple Inc Report")).toBeInTheDocument();

    // Version badge shown for v2, not for v1
    expect(screen.getByText(/v2/)).toBeInTheDocument();

    // Links point to correct URLs
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/reports/nvda-abc1");
    expect(links[1]).toHaveAttribute("href", "/reports/aapl-xyz9");
  });

  it("shows error state when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
    );

    render(<ReportsPage onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Error 500")).toBeInTheDocument();
    });
  });

  it("calls onBack when 'New Report' button is clicked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ reports: [] }),
      })
    );

    const onBack = vi.fn();
    render(<ReportsPage onBack={onBack} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New Report" }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows Published Reports subtitle", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<ReportsPage onBack={vi.fn()} />);
    expect(screen.getByText("Published Reports")).toBeInTheDocument();
  });
});
