import { client as anthropicClient, ANTHROPIC_MODEL } from "./anthropic-client";
import { checkS3Health } from "./storage";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Build info (read once at startup) ────────────────────────────────────────

interface BuildInfo {
  commitSha: string;
  commitTitle: string;
  buildTime: string;
}

function loadBuildInfo(): BuildInfo {
  // Try build-info.json first (written by Dockerfile)
  const buildInfoPath = join(__dirname, "..", "build-info.json");
  if (existsSync(buildInfoPath)) {
    try {
      return JSON.parse(readFileSync(buildInfoPath, "utf-8"));
    } catch {
      // fall through
    }
  }

  // In dev mode, read directly from git
  try {
    const commitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    const commitTitle = execSync("git log -1 --pretty=%s", { encoding: "utf-8" }).trim();
    return { commitSha, commitTitle, buildTime: new Date().toISOString() };
  } catch {
    return { commitSha: "unknown", commitTitle: "unknown", buildTime: "unknown" };
  }
}

const buildInfo = loadBuildInfo();
const serverStartTime = new Date().toISOString();

// ── Health check logic ───────────────────────────────────────────────────────

interface ServiceStatus {
  status: "ok" | "error" | "unconfigured";
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

async function checkAnthropic(): Promise<ServiceStatus> {
  const start = Date.now();

  if (!anthropicClient) {
    return {
      status: "unconfigured",
      latencyMs: Date.now() - start,
      error: "ANTHROPIC_API_KEY is not set",
    };
  }

  try {
    await anthropicClient.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return {
      status: "ok",
      latencyMs: Date.now() - start,
      details: { configuredModel: ANTHROPIC_MODEL },
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: status ? `HTTP ${status}: ${error}` : error,
    };
  }
}

async function checkS3(): Promise<ServiceStatus> {
  const start = Date.now();
  const result = await checkS3Health();

  if (!result.ok && (result.error?.includes("not set"))) {
    return {
      status: "unconfigured",
      latencyMs: Date.now() - start,
      error: result.error,
    };
  }

  if (!result.ok) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: result.error,
      details: { bucket: result.bucket, endpoint: result.endpoint },
    };
  }

  return {
    status: "ok",
    latencyMs: Date.now() - start,
    details: { bucket: result.bucket, endpoint: result.endpoint },
  };
}

export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  services: {
    anthropic: ServiceStatus;
    s3: ServiceStatus;
  };
  build: {
    commitSha: string;
    commitTitle: string;
    buildTime: string;
  };
  runtime: {
    serverStartTime: string;
    uptime: string;
    nodeVersion: string;
    environment: string;
    region: string | null;
    appName: string | null;
    allocId: string | null;
    memoryUsageMb: number;
  };
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

export async function getHealthStatus(): Promise<HealthResponse> {
  const [anthropic, s3Status] = await Promise.all([
    checkAnthropic(),
    checkS3(),
  ]);

  const allServices = [anthropic, s3Status];
  const anyError = allServices.some((s) => s.status === "error");
  const allOk = allServices.every((s) => s.status === "ok");

  const mem = process.memoryUsage();

  return {
    status: allOk ? "healthy" : anyError ? "degraded" : "healthy",
    services: {
      anthropic,
      s3: s3Status,
    },
    build: buildInfo,
    runtime: {
      serverStartTime,
      uptime: formatUptime(Date.now() - new Date(serverStartTime).getTime()),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || "development",
      region: process.env.FLY_REGION || null,
      appName: process.env.FLY_APP_NAME || null,
      allocId: process.env.FLY_ALLOC_ID || null,
      memoryUsageMb: Math.round(mem.rss / 1024 / 1024),
    },
  };
}
