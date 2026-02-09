import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import HealthPage from "./HealthPage";

function createHealthResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "healthy",
    services: {
      anthropic: { status: "ok", latencyMs: 150, details: { configuredModel: "claude-haiku-4-5" } },
      s3: { status: "ok", latencyMs: 50, details: { bucket: "test-bucket" } },
    },
    build: {
      commitSha: "abc123def456",
      commitTitle: "Test commit message",
      buildTime: "2026-02-09T00:00:00Z",
    },
    runtime: {
      serverStartTime: "2026-02-09T00:00:00Z",
      uptime: "1h 30m 15s",
      nodeVersion: "v22.0.0",
      environment: "development",
      region: null,
      appName: null,
      allocId: null,
      memoryUsageMb: 128,
    },
    ...overrides,
  };
}

describe("HealthPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state initially", () => {
    // Never resolve the fetch
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    render(<HealthPage />);
    expect(screen.getByText("Checking system health...")).toBeInTheDocument();
  });

  it("renders healthy status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(createHealthResponse()),
    }));

    render(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByText("healthy")).toBeInTheDocument();
    });

    // Service statuses should be visible
    expect(screen.getByText("Anthropic API")).toBeInTheDocument();
    expect(screen.getByText("S3 Storage (Tigris)")).toBeInTheDocument();
  });

  it("renders degraded status when a service has errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(createHealthResponse({
        status: "degraded",
        services: {
          anthropic: { status: "error", latencyMs: 0, error: "API key invalid" },
          s3: { status: "ok", latencyMs: 50 },
        },
      })),
    }));

    render(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByText("degraded")).toBeInTheDocument();
    });

    expect(screen.getByText(/API key invalid/)).toBeInTheDocument();
  });

  it("shows build information", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(createHealthResponse()),
    }));

    render(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByText(/abc123/)).toBeInTheDocument();
      expect(screen.getByText(/Test commit message/)).toBeInTheDocument();
    });
  });

  it("shows runtime information", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(createHealthResponse()),
    }));

    render(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByText(/v22\.0\.0/)).toBeInTheDocument();
      expect(screen.getByText(/128/)).toBeInTheDocument();
    });
  });

  it("handles fetch failure gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    render(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByText(/Network error|failed|error/i)).toBeInTheDocument();
    });
  });
});
