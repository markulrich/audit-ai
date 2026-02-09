/**
 * Tests for the Anthropic client wrapper.
 * Tests model fallback, max token resolution, error handling, and tracing.
 *
 * Because the Anthropic client is created at module scope based on ANTHROPIC_API_KEY,
 * we mock the entire SDK and set the env var via vi.stubEnv before the module loads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK before anything else
const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      constructor(_opts: Record<string, unknown>) {}
    },
  };
});

// Set the env var BEFORE the module is evaluated (vi.stubEnv runs before module graph resolution)
vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");

// Now import — the module will see ANTHROPIC_API_KEY and create a client (our mock)
const mod = await import("./anthropic-client");
const { createMessage, tracedCreate, ANTHROPIC_MODEL } = mod;

describe("anthropic-client", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe("ANTHROPIC_MODEL", () => {
    it("defaults to claude-haiku-4-5", () => {
      expect(ANTHROPIC_MODEL).toBe("claude-haiku-4-5");
    });
  });

  describe("createMessage", () => {
    it("calls the Anthropic API with resolved max_tokens", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Hello" }],
        model: "claude-haiku-4-5",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await createMessage({
        model: "claude-haiku-4-5",
        system: "Test system",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(result.content[0]).toEqual({ type: "text", text: "Hello" });

      // Should have used haiku's max tokens (8192)
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.max_tokens).toBe(8192);
    });

    it("resolves correct max_tokens for sonnet", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Response" }],
        model: "claude-sonnet-4-5",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await createMessage({
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockCreate.mock.calls[0][0].max_tokens).toBe(16384);
    });

    it("resolves correct max_tokens for opus", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Response" }],
        model: "claude-opus-4-6",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await createMessage({
        model: "claude-opus-4-6",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockCreate.mock.calls[0][0].max_tokens).toBe(16384);
    });

    it("falls back to next model on 404 model-not-found error", async () => {
      const notFoundErr = new Error("model not found") as Error & { status: number };
      notFoundErr.status = 404;
      mockCreate.mockRejectedValueOnce(notFoundErr);

      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Fallback response" }],
        model: "claude-haiku-4-5",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await createMessage({
        model: "nonexistent-model",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.content[0]).toEqual({ type: "text", text: "Fallback response" });
    });

    it("throws non-404 errors immediately (no fallback)", async () => {
      const rateLimitErr = new Error("Rate limited") as Error & { status: number };
      rateLimitErr.status = 429;
      mockCreate.mockRejectedValueOnce(rateLimitErr);

      await expect(
        createMessage({
          model: "claude-haiku-4-5",
          messages: [{ role: "user", content: "Test" }],
        })
      ).rejects.toThrow("Rate limited");

      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it("defaults max_tokens to 8192 for unknown model", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Response" }],
        model: "claude-unknown-99",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await createMessage({
        model: "claude-unknown-99",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockCreate.mock.calls[0][0].max_tokens).toBe(8192);
    });
  });

  describe("tracedCreate", () => {
    it("returns response and trace data", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Traced response" }],
        model: "claude-haiku-4-5",
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const { response, trace } = await tracedCreate({
        model: "claude-haiku-4-5",
        system: "System prompt",
        messages: [{ role: "user", content: "Question" }],
      });

      expect(response.content[0]).toEqual({ type: "text", text: "Traced response" });

      expect(trace.request.model).toBe("claude-haiku-4-5");
      expect(trace.request.system).toBe("System prompt");

      expect(trace.response.raw).toBe("Traced response");
      expect(trace.response.stop_reason).toBe("end_turn");
      expect(trace.response.usage).toEqual({ input_tokens: 100, output_tokens: 50 });

      expect(trace.timing.durationMs).toBeGreaterThanOrEqual(0);
      expect(trace.timing.startTime).toBeDefined();
    });

    it("captures only first text content block", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: "text", text: "First block" },
          { type: "text", text: "Second block" },
        ],
        model: "claude-haiku-4-5",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const { trace } = await tracedCreate({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(trace.response.raw).toBe("First block");
    });

    it("handles empty content array", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [],
        model: "claude-haiku-4-5",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 0 },
      });

      const { trace } = await tracedCreate({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(trace.response.raw).toBe("");
    });

    it("records timing with reasonable values", async () => {
      mockCreate.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({
            content: [{ type: "text", text: "Timed" }],
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 5 },
          }), 10);
        });
      });

      const { trace } = await tracedCreate({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(trace.timing.durationMs).toBeGreaterThanOrEqual(5);
      expect(new Date(trace.timing.startTime).getTime()).toBeGreaterThan(0);
    });
  });
});
