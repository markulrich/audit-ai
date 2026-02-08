import Anthropic from "@anthropic-ai/sdk";
import type { TraceData, TraceRequest, PipelineError } from "../shared/types";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "WARNING: ANTHROPIC_API_KEY is not set. " +
    "The app will serve the frontend but API calls will fail."
  );
}

export const client: Anthropic | null = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 120_000,
      maxRetries: 2,
    })
  : null;

// For testing, use haiku to save $, but in prod use sonnet or opus.
export const ANTHROPIC_MODEL: string =
  process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

const MODEL_FALLBACKS: string[] = [
  ANTHROPIC_MODEL,
  "claude-haiku-4-5",
  "claude-opus-4-6",
  "claude-sonnet-4-5"
];

// Max output tokens per model family. The API rejects requests that exceed these.
const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "claude-haiku": 8192,
  "claude-sonnet": 16384,
  "claude-opus": 16384,
};

/** Return the max output tokens for a given model ID. */
function getMaxOutputTokens(model: string | undefined): number {
  if (!model) return 8192;
  for (const [prefix, max] of Object.entries(MODEL_MAX_OUTPUT_TOKENS)) {
    if (model.startsWith(prefix)) return max;
  }
  return 8192; // safe default
}

function isModelNotFound(err: unknown): boolean {
  const apiErr = err as {
    status?: number;
    message?: string;
    error?: { error?: { message?: string } };
  };
  const status: number | undefined = apiErr?.status;
  const message: string = `${apiErr?.message || ""} ${apiErr?.error?.error?.message || ""}`.toLowerCase();
  return status === 404 && message.includes("model");
}

export type CreateMessageParams = Omit<Anthropic.MessageCreateParamsNonStreaming, "max_tokens"> & {
  max_tokens?: number;
};

export async function createMessage(params: CreateMessageParams): Promise<Anthropic.Message> {
  if (!client) {
    const err = new Error("ANTHROPIC_API_KEY is not configured.") as PipelineError;
    err.status = 401;
    err.keyMissing = true;
    throw err;
  }
  const requestedModel: string = params.model;
  const candidateModels: string[] = [
    ...new Set([requestedModel, ...MODEL_FALLBACKS].filter(Boolean)),
  ];

  let lastModelError: unknown = null;
  for (const model of candidateModels) {
    try {
      // Always use the model's maximum output tokens
      const max_tokens: number = getMaxOutputTokens(model);
      return await client.messages.create({ ...params, model, max_tokens });
    } catch (err) {
      if (isModelNotFound(err)) {
        lastModelError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastModelError || new Error("No available Anthropic model.");
}

interface TracedResult {
  response: Anthropic.Message;
  trace: TraceData;
}

/**
 * Wraps createMessage to capture full trace data:
 * request params, raw response, timing, and token usage.
 *
 * Returns { response, trace } where trace contains everything
 * needed for debugging drill-down.
 */
export async function tracedCreate(params: CreateMessageParams): Promise<TracedResult> {
  const startTime: number = Date.now();
  const response: Anthropic.Message = await createMessage(params);
  const durationMs: number = Date.now() - startTime;

  // Resolve the actual max_tokens that was used (set by createMessage based on model)
  const resolvedModel: string = response.model || params.model || ANTHROPIC_MODEL;
  const resolvedMaxTokens: number = getMaxOutputTokens(resolvedModel);

  const responseText: string =
    response.content?.[0]?.type === "text" ? response.content[0].text : "";

  const trace: TraceData = {
    request: {
      model: params.model,
      max_tokens: resolvedMaxTokens,
      system: params.system as string | undefined,
      messages: params.messages as TraceRequest["messages"],
    },
    response: {
      raw: responseText,
      stop_reason: response.stop_reason ?? undefined,
      usage: response.usage,
    },
    timing: {
      startTime: new Date(startTime).toISOString(),
      durationMs,
    },
  };

  return { response, trace };
}
