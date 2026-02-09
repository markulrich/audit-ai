import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the anthropic-client
vi.mock("./anthropic-client", () => ({
  client: {
    messages: {
      create: vi.fn(),
    },
  },
  ANTHROPIC_MODEL: "claude-sonnet-4-5-20250929",
}));

// Mock the storage checkS3Health
vi.mock("./storage", () => ({
  checkS3Health: vi.fn(),
}));

// Mock child_process and fs for build info
vi.mock("child_process", () => ({
  execSync: vi.fn().mockReturnValue("abc123\n"),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import { getHealthStatus } from "./health";
import { client as anthropicClient } from "./anthropic-client";
import { checkS3Health } from "./storage";

describe("health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns healthy when all services are ok", async () => {
    (anthropicClient.messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    (checkS3Health as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      bucket: "test-bucket",
      endpoint: "https://s3.example.com",
    });

    const health = await getHealthStatus();

    expect(health.status).toBe("healthy");
    expect(health.services.anthropic.status).toBe("ok");
    expect(health.services.s3.status).toBe("ok");
    expect(health.runtime.nodeVersion).toBeDefined();
    expect(health.build).toBeDefined();
  });

  it("returns degraded when anthropic API has error", async () => {
    (anthropicClient.messages.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("Internal server error"), { status: 500 })
    );
    (checkS3Health as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      bucket: "test-bucket",
      endpoint: "https://s3.example.com",
    });

    const health = await getHealthStatus();

    expect(health.status).toBe("degraded");
    expect(health.services.anthropic.status).toBe("error");
    expect(health.services.anthropic.error).toContain("500");
    expect(health.services.s3.status).toBe("ok");
  });

  it("returns degraded when S3 has error", async () => {
    (anthropicClient.messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    (checkS3Health as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      bucket: "test-bucket",
      endpoint: "https://s3.example.com",
      error: "Access denied",
    });

    const health = await getHealthStatus();

    expect(health.status).toBe("degraded");
    expect(health.services.s3.status).toBe("error");
    expect(health.services.anthropic.status).toBe("ok");
  });

  it("reports S3 as unconfigured when env vars are missing", async () => {
    (anthropicClient.messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    (checkS3Health as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      bucket: undefined,
      endpoint: undefined,
      error: "Missing env vars: BUCKET_NAME not set",
    });

    const health = await getHealthStatus();

    // Unconfigured services don't make the system "degraded" — only errors do
    expect(health.services.s3.status).toBe("unconfigured");
    expect(health.services.s3.error).toContain("not set");
  });

  it("includes runtime information", async () => {
    (anthropicClient.messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    (checkS3Health as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, bucket: "b", endpoint: "e" });

    const health = await getHealthStatus();

    expect(health.runtime.serverStartTime).toBeDefined();
    expect(health.runtime.uptime).toMatch(/\d+s/);
    expect(health.runtime.nodeVersion).toMatch(/^v\d+/);
    expect(health.runtime.memoryUsageMb).toBeGreaterThan(0);
  });

  it("reports latency for each service check", async () => {
    (anthropicClient.messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    (checkS3Health as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, bucket: "b", endpoint: "e" });

    const health = await getHealthStatus();

    expect(health.services.anthropic.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.services.s3.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
