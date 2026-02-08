/**
 * Reasoning Level Presets
 *
 * Each level configures the model and all quantitative parameters
 * sent to the LLM across every agent in the pipeline.
 *
 * X-Light → Haiku   — Fastest possible, speed over depth
 * Light   → Haiku   — Fast, cheaper, less thorough
 * Medium  → Sonnet  — Balanced (current default behavior)
 * Heavy   → Opus    — Most thorough, slowest, most expensive
 */

export const REASONING_LEVELS = {
  xlight: {
    label: "X-Light",
    description: "Fastest possible — speed over depth",
    model: "claude-haiku-4-5",

    classifier: {
      maxTokens: 256,
    },

    researcher: {
      maxTokens: 4096,
      evidenceTarget: 10,
      evidencePrompt: "AROUND 10",
    },

    synthesizer: {
      maxTokens: 4096,
      findingsTotal: "8-12",
      findingsPerSection: "1-2",
      supportingEvidenceMin: 1,
      explanationTitleLength: "2-3 words",
      explanationTextLength: "1 sentence",
      keyStatsCount: 6,
    },

    verifier: {
      maxTokens: 4096,
      methodologyTextLength: "1-2 sentences",
      certaintyCutoff: 25,
    },
  },

  light: {
    label: "Light",
    description: "Fast analysis with fewer details",
    model: "claude-haiku-4-5",

    classifier: {
      maxTokens: 512,
    },

    researcher: {
      maxTokens: 8192,
      evidenceTarget: 20,
      evidencePrompt: "AT LEAST 20",
    },

    synthesizer: {
      maxTokens: 12288,
      findingsTotal: "15-20",
      findingsPerSection: "2-3",
      supportingEvidenceMin: 2,
      explanationTitleLength: "2-4 words",
      explanationTextLength: "1-2 sentences",
      keyStatsCount: 6,
    },

    verifier: {
      maxTokens: 12288,
      methodologyTextLength: "2-3 sentences",
      certaintyCutoff: 25,
    },
  },

  medium: {
    label: "Medium",
    description: "Balanced depth and speed",
    model: "claude-sonnet-4-5",

    classifier: {
      maxTokens: 512,
    },

    researcher: {
      maxTokens: 12288,
      evidenceTarget: 40,
      evidencePrompt: "AT LEAST 40",
    },

    synthesizer: {
      maxTokens: 16384,
      findingsTotal: "25-35",
      findingsPerSection: "3-5",
      supportingEvidenceMin: 3,
      explanationTitleLength: "2-5 words",
      explanationTextLength: "2-4 sentences",
      keyStatsCount: 6,
    },

    verifier: {
      maxTokens: 16384,
      methodologyTextLength: "3-5 sentences",
      certaintyCutoff: 25,
    },
  },

  heavy: {
    label: "Heavy",
    description: "Maximum depth and rigor",
    model: "claude-opus-4-6",

    classifier: {
      maxTokens: 1024,
    },

    researcher: {
      maxTokens: 16384,
      evidenceTarget: 60,
      evidencePrompt: "AT LEAST 60",
    },

    synthesizer: {
      maxTokens: 16384,
      findingsTotal: "35-50",
      findingsPerSection: "4-7",
      supportingEvidenceMin: 4,
      explanationTitleLength: "2-5 words",
      explanationTextLength: "3-6 sentences",
      keyStatsCount: 6,
    },

    verifier: {
      maxTokens: 16384,
      methodologyTextLength: "4-6 sentences",
      certaintyCutoff: 25,
    },
  },
};

export const DEFAULT_REASONING_LEVEL = "medium";

/**
 * Returns the config for a given reasoning level, falling back to medium.
 */
export function getReasoningConfig(level) {
  return REASONING_LEVELS[level] || REASONING_LEVELS[DEFAULT_REASONING_LEVEL];
}
