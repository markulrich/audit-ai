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
      return await client.messages.create({ ...params, model });
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
