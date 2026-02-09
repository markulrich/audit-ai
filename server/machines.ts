/**
 * Fly Machines API — spin up and manage dedicated machines for each report.
 *
 * Each report gets its own Fly Machine that runs the agent worker process.
 * The machine has Claude skills installed as tools and operates independently
 * of the main server. This means:
 *
 * 1. Reports keep working even if the user closes the tab
 * 2. Reports keep working even if the main server restarts
 * 3. Each report has its own isolated compute/memory
 * 4. Machines auto-stop after the report is complete (cost optimization)
 *
 * Architecture:
 *   Main server (control plane) ──── Fly Machines API ────> Worker machine
 *       │                                                        │
 *       │ POST /api/jobs → create machine                        │
 *       │ GET /api/jobs/:id/events → proxy from machine          │
 *       │                                                        │
 *       └─── S3 (shared state) ◄─────────────────────────────────┘
 *
 * The worker machine:
 *   - Runs server/worker.ts
 *   - Reads job config from S3
 *   - Runs Claude tool_use agent loop with skills as tools
 *   - Writes progress/report to S3
 *   - Auto-stops when done
 */

const FLY_API_TOKEN = process.env.FLY_API_TOKEN;
const FLY_APP_NAME = process.env.FLY_APP_NAME || "audit-ai";
const FLY_REGION = process.env.FLY_REGION || "sjc";
const FLY_API_BASE = "https://api.machines.dev/v1";
const FLY_WORKER_IMAGE = process.env.FLY_WORKER_IMAGE || `registry.fly.io/${FLY_APP_NAME}:latest`;

export interface MachineConfig {
  jobId: string;
  slug: string;
  /** Environment variables to pass to the worker */
  env: Record<string, string>;
}

export interface MachineInfo {
  machineId: string;
  state: string;
  region: string;
  createdAt: string;
  instanceId?: string;
  privateIp?: string;
}

/** Check if Fly Machines API is available */
export function isMachinesAvailable(): boolean {
  return !!FLY_API_TOKEN;
}

/** Create a new Fly Machine for a report job */
export async function createMachine(config: MachineConfig): Promise<MachineInfo> {
  if (!FLY_API_TOKEN) {
    throw new Error(
      "FLY_API_TOKEN not set — cannot create machines. " +
      "Set FLY_API_TOKEN to use per-report machine isolation. " +
      "Falling back to in-process execution."
    );
  }

  const machineConfig = {
    name: `report-${config.slug}-${config.jobId.slice(-6)}`,
    region: FLY_REGION,
    config: {
      image: FLY_WORKER_IMAGE,
      env: {
        ...config.env,
        JOB_ID: config.jobId,
        REPORT_SLUG: config.slug,
        WORKER_MODE: "true",
        NODE_ENV: "production",
        // Pass S3 credentials so worker can read/write state
        BUCKET_NAME: process.env.BUCKET_NAME || "",
        AWS_ENDPOINT_URL_S3: process.env.AWS_ENDPOINT_URL_S3 || "",
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "",
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "",
        AWS_REGION: process.env.AWS_REGION || "auto",
        // Pass Anthropic API key
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "",
      },
      guest: {
        cpu_kind: "shared",
        cpus: 1,
        memory_mb: 1024,
      },
      // Auto-stop after 10 minutes of inactivity
      auto_destroy: true,
      restart: {
        policy: "no",
      },
      services: [
        {
          ports: [{ port: 8080, handlers: ["http"] }],
          protocol: "tcp",
          internal_port: 8080,
        },
      ],
    },
  };

  const response = await fetch(`${FLY_API_BASE}/apps/${FLY_APP_NAME}/machines`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FLY_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(machineConfig),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create machine: ${response.status} — ${body}`);
  }

  const machine = await response.json() as {
    id: string;
    state: string;
    region: string;
    created_at: string;
    instance_id?: string;
    private_ip?: string;
  };

  console.log(
    `[machines] Created machine ${machine.id} in ${machine.region} for job ${config.jobId}`
  );

  return {
    machineId: machine.id,
    state: machine.state,
    region: machine.region,
    createdAt: machine.created_at,
    instanceId: machine.instance_id,
    privateIp: machine.private_ip,
  };
}

/** Wait for a machine to reach the "started" state */
export async function waitForMachineReady(
  machineId: string,
  timeoutMs: number = 60_000
): Promise<MachineInfo> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const info = await getMachineState(machineId);
    if (info.state === "started" || info.state === "running") {
      return info;
    }
    if (info.state === "failed" || info.state === "destroyed") {
      throw new Error(`Machine ${machineId} entered ${info.state} state`);
    }

    // Poll every 2 seconds
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Machine ${machineId} did not start within ${timeoutMs}ms`);
}

/** Get current state of a machine */
export async function getMachineState(machineId: string): Promise<MachineInfo> {
  if (!FLY_API_TOKEN) {
    throw new Error("FLY_API_TOKEN not set");
  }

  const response = await fetch(
    `${FLY_API_BASE}/apps/${FLY_APP_NAME}/machines/${machineId}`,
    {
      headers: {
        Authorization: `Bearer ${FLY_API_TOKEN}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get machine state: ${response.status}`);
  }

  const machine = await response.json() as {
    id: string;
    state: string;
    region: string;
    created_at: string;
    instance_id?: string;
    private_ip?: string;
  };

  return {
    machineId: machine.id,
    state: machine.state,
    region: machine.region,
    createdAt: machine.created_at,
    instanceId: machine.instance_id,
    privateIp: machine.private_ip,
  };
}

/** Stop a machine */
export async function stopMachine(machineId: string): Promise<void> {
  if (!FLY_API_TOKEN) return;

  try {
    await fetch(
      `${FLY_API_BASE}/apps/${FLY_APP_NAME}/machines/${machineId}/stop`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FLY_API_TOKEN}`,
        },
      }
    );
    console.log(`[machines] Stopped machine ${machineId}`);
  } catch (err) {
    console.warn(`[machines] Failed to stop machine ${machineId}:`, (err as Error).message);
  }
}

/** Destroy a machine */
export async function destroyMachine(machineId: string): Promise<void> {
  if (!FLY_API_TOKEN) return;

  try {
    await fetch(
      `${FLY_API_BASE}/apps/${FLY_APP_NAME}/machines/${machineId}?force=true`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${FLY_API_TOKEN}`,
        },
      }
    );
    console.log(`[machines] Destroyed machine ${machineId}`);
  } catch (err) {
    console.warn(`[machines] Failed to destroy machine ${machineId}:`, (err as Error).message);
  }
}

// ── Machine tracking ────────────────────────────────────────────────────────

const jobMachines = new Map<string, string>(); // jobId → machineId

/** Associate a machine with a job */
export function trackMachine(jobId: string, machineId: string): void {
  jobMachines.set(jobId, machineId);
}

/** Get the machine ID for a job */
export function getMachineForJob(jobId: string): string | undefined {
  return jobMachines.get(jobId);
}

/** Clean up machine tracking for a job */
export function untrackMachine(jobId: string): void {
  jobMachines.delete(jobId);
}
