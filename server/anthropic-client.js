import Anthropic from "@anthropic-ai/sdk";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "WARNING: ANTHROPIC_API_KEY is not set. " +
    "The app will serve the frontend but API calls will fail."
  );
}

export const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 120_000,
      maxRetries: 2,
    })
  : null;

// For testing, use haiku to save $, but in prod use sonnet or opus.
export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

const MODEL_FALLBACKS = [
  ANTHROPIC_MODEL,
  "claude-haiku-4-5",
  "claude-opus-4-6",
  "claude-sonnet-4-5"
];

// Max output tokens per model family. The API rejects requests that exceed these.
const MODEL_MAX_OUTPUT_TOKENS = {
  "claude-haiku": 8192,
  "claude-sonnet": 16384,
  "claude-opus": 16384,
};

/** Return the max output tokens for a given model ID. */
function getMaxOutputTokens(model) {
  if (!model) return 8192;
  for (const [prefix, max] of Object.entries(MODEL_MAX_OUTPUT_TOKENS)) {
    if (model.startsWith(prefix)) return max;
  }
  return 8192; // safe default
}

function isModelNotFound(err) {
  const status = err?.status;
  const message = `${err?.message || ""} ${err?.error?.error?.message || ""}`.toLowerCase();
  return status === 404 && message.includes("model");
}

export async function createMessage(params) {
  if (!client) {
    const err = new Error("ANTHROPIC_API_KEY is not configured.");
    err.status = 401;
    err.keyMissing = true;
    throw err;
  }
  const requestedModel = params.model;
  const candidateModels = [
    ...new Set([requestedModel, ...MODEL_FALLBACKS].filter(Boolean)),
  ];

  let lastModelError = null;
  for (const model of candidateModels) {
    try {
      // Always use the model's maximum output tokens
      const max_tokens = getMaxOutputTokens(model);
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

/**
 * Wraps createMessage to capture full trace data:
 * request params, raw response, timing, and token usage.
 *
 * Returns { response, trace } where trace contains everything
 * needed for debugging drill-down.
 */
export async function tracedCreate(params) {
  const startTime = Date.now();
  const response = await createMessage(params);
  const durationMs = Date.now() - startTime;

  // Resolve the actual max_tokens that was used (set by createMessage based on model)
  const resolvedModel = response.model || params.model || ANTHROPIC_MODEL;
  const resolvedMaxTokens = getMaxOutputTokens(resolvedModel);

  const trace = {
    request: {
      model: params.model,
      max_tokens: resolvedMaxTokens,
      system: params.system,
      messages: params.messages,
    },
    response: {
      raw: response.content?.[0]?.text || "",
      stop_reason: response.stop_reason,
      usage: response.usage || {},
    },
    timing: {
      startTime: new Date(startTime).toISOString(),
      durationMs,
    },
  };

  return { response, trace };
}
