import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Save original env
const originalEnv = { ...process.env };

describe("machines", () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset fetch mock
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("isMachinesAvailable", () => {
    it("returns false when FLY_API_TOKEN is not set", async () => {
      delete process.env.FLY_API_TOKEN;
      const { isMachinesAvailable } = await import("./machines");
      expect(isMachinesAvailable()).toBe(false);
    });

    it("returns true when FLY_API_TOKEN is set", async () => {
      process.env.FLY_API_TOKEN = "test-token";
      const { isMachinesAvailable } = await import("./machines");
      expect(isMachinesAvailable()).toBe(true);
    });
  });

  describe("createMachine", () => {
    it("throws when FLY_API_TOKEN is not set", async () => {
      delete process.env.FLY_API_TOKEN;
      const { createMachine } = await import("./machines");

      await expect(
        createMachine({ jobId: "job-1", slug: "test", env: {} })
      ).rejects.toThrow("FLY_API_TOKEN not set");
    });

    it("creates a machine via the Fly API", async () => {
      process.env.FLY_API_TOKEN = "test-token";
      process.env.FLY_APP_NAME = "test-app";

      const mockResponse = {
        id: "machine-123",
        state: "created",
        region: "sjc",
        created_at: "2026-02-09T00:00:00Z",
        instance_id: "inst-1",
        private_ip: "172.19.0.1",
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { createMachine } = await import("./machines");
      const result = await createMachine({
        jobId: "job-test-123",
        slug: "nvda-report",
        env: { CUSTOM_VAR: "value" },
      });

      expect(result.machineId).toBe("machine-123");
      expect(result.state).toBe("created");
      expect(result.region).toBe("sjc");
      expect(result.instanceId).toBe("inst-1");
      expect(result.privateIp).toBe("172.19.0.1");

      // Verify fetch was called correctly
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toContain("/apps/test-app/machines");
      expect(fetchCall[1].method).toBe("POST");
      expect(fetchCall[1].headers.Authorization).toBe("Bearer test-token");

      const body = JSON.parse(fetchCall[1].body);
      expect(body.name).toContain("report-nvda-report-");
      expect(body.config.env.JOB_ID).toBe("job-test-123");
      expect(body.config.env.WORKER_MODE).toBe("true");
      expect(body.config.env.CUSTOM_VAR).toBe("value");
    });

    it("throws on API error", async () => {
      process.env.FLY_API_TOKEN = "test-token";

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const { createMachine } = await import("./machines");
      await expect(
        createMachine({ jobId: "job-1", slug: "test", env: {} })
      ).rejects.toThrow("Failed to create machine: 500");
    });
  });

  describe("getMachineState", () => {
    it("throws when FLY_API_TOKEN is not set", async () => {
      delete process.env.FLY_API_TOKEN;
      const { getMachineState } = await import("./machines");
      await expect(getMachineState("machine-1")).rejects.toThrow("FLY_API_TOKEN not set");
    });

    it("returns machine state", async () => {
      process.env.FLY_API_TOKEN = "test-token";

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "machine-1",
          state: "started",
          region: "sjc",
          created_at: "2026-02-09T00:00:00Z",
        }),
      });

      const { getMachineState } = await import("./machines");
      const result = await getMachineState("machine-1");

      expect(result.machineId).toBe("machine-1");
      expect(result.state).toBe("started");
    });

    it("throws on API error", async () => {
      process.env.FLY_API_TOKEN = "test-token";

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const { getMachineState } = await import("./machines");
      await expect(getMachineState("nonexistent")).rejects.toThrow("Failed to get machine state: 404");
    });
  });

  describe("waitForMachineReady", () => {
    it("returns when machine reaches started state", async () => {
      process.env.FLY_API_TOKEN = "test-token";

      let callCount = 0;
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        const state = callCount >= 2 ? "started" : "created";
        return {
          ok: true,
          json: async () => ({
            id: "machine-1",
            state,
            region: "sjc",
            created_at: "2026-02-09T00:00:00Z",
          }),
        };
      });

      const { waitForMachineReady } = await import("./machines");
      const result = await waitForMachineReady("machine-1", 10_000);

      expect(result.state).toBe("started");
      expect(callCount).toBe(2);
    });

    it("throws on failed machine state", async () => {
      process.env.FLY_API_TOKEN = "test-token";

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "machine-1",
          state: "failed",
          region: "sjc",
          created_at: "2026-02-09T00:00:00Z",
        }),
      });

      const { waitForMachineReady } = await import("./machines");
      await expect(waitForMachineReady("machine-1", 5000)).rejects.toThrow("entered failed state");
    });

    it("throws on timeout", async () => {
      process.env.FLY_API_TOKEN = "test-token";

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "machine-1",
          state: "created",
          region: "sjc",
          created_at: "2026-02-09T00:00:00Z",
        }),
      });

      const { waitForMachineReady } = await import("./machines");
      // Very short timeout to trigger failure quickly
      await expect(waitForMachineReady("machine-1", 100)).rejects.toThrow("did not start within");
    }, 10_000);
  });

  describe("stopMachine", () => {
    it("calls the stop API", async () => {
      process.env.FLY_API_TOKEN = "test-token";

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

      const { stopMachine } = await import("./machines");
      await stopMachine("machine-1");

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toContain("/machines/machine-1/stop");
      expect(fetchCall[1].method).toBe("POST");
    });

    it("does nothing when FLY_API_TOKEN is not set", async () => {
      delete process.env.FLY_API_TOKEN;
      const { stopMachine } = await import("./machines");
      await stopMachine("machine-1"); // Should not throw
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      process.env.FLY_API_TOKEN = "test-token";

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

      const { stopMachine } = await import("./machines");
      // Should not throw
      await stopMachine("machine-1");
    });
  });

  describe("destroyMachine", () => {
    it("calls the destroy API with force=true", async () => {
      process.env.FLY_API_TOKEN = "test-token";

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

      const { destroyMachine } = await import("./machines");
      await destroyMachine("machine-1");

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toContain("/machines/machine-1?force=true");
      expect(fetchCall[1].method).toBe("DELETE");
    });

    it("does nothing when FLY_API_TOKEN is not set", async () => {
      delete process.env.FLY_API_TOKEN;
      const { destroyMachine } = await import("./machines");
      await destroyMachine("machine-1"); // Should not throw
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe("machine tracking", () => {
    it("tracks and retrieves machine for job", async () => {
      process.env.FLY_API_TOKEN = "test-token";
      const { trackMachine, getMachineForJob } = await import("./machines");

      trackMachine("job-1", "machine-abc");
      expect(getMachineForJob("job-1")).toBe("machine-abc");
    });

    it("returns undefined for untracked job", async () => {
      process.env.FLY_API_TOKEN = "test-token";
      const { getMachineForJob } = await import("./machines");
      expect(getMachineForJob("nonexistent")).toBeUndefined();
    });

    it("untracks a machine", async () => {
      process.env.FLY_API_TOKEN = "test-token";
      const { trackMachine, getMachineForJob, untrackMachine } = await import("./machines");

      trackMachine("job-1", "machine-abc");
      expect(getMachineForJob("job-1")).toBe("machine-abc");

      untrackMachine("job-1");
      expect(getMachineForJob("job-1")).toBeUndefined();
    });
  });
});
