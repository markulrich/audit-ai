import type { ReasoningConfig } from "../shared/types";

/**
 * Reasoning level presets that control every tunable parameter in the pipeline.
 *
 * X-Light: Minimum everything — for fast testing
 * Light:   Reduced scope, still uses haiku
 * Heavy:   Full production quality with sonnet
 * X-Heavy: Maximum reasoning with opus
 */

export const REASONING_LEVELS: Record<string, ReasoningConfig> = {
  "x-light": {
    label: "X-Light",
    description: "Fastest — minimal output for testing",

    // Models
    classifierModel: undefined, // use default (haiku)
    researcherModel: undefined,
    synthesizerModel: undefined,
    verifierModel: undefined,

    // Researcher
    evidenceMinItems: 2,

    // Synthesizer
    totalFindings: "3-5",
    findingsPerSection: "1",
    supportingEvidenceMin: 1,
    explanationLength: "1 sentence",
    quoteLength: "1-2 sentences — brief and factual",
    keyStatsCount: 2,

    // Verifier
    methodologyLength: "1 sentence",
    methodologySources: "1",
    removalThreshold: 0, // keep all findings regardless of certainty
  },

  light: {
    label: "Light",
    description: "Faster — reduced scope, lower cost",

    classifierModel: undefined,
    researcherModel: undefined,
    synthesizerModel: undefined,
    verifierModel: undefined,

    evidenceMinItems: 20,

    totalFindings: "12-18",
    findingsPerSection: "2-3",
    supportingEvidenceMin: 2,
    explanationLength: "1-2 sentences",
    quoteLength: "1-2 sentences with key data points",
    keyStatsCount: 4,

    methodologyLength: "2-3 sentences",
    methodologySources: "2-3",
    removalThreshold: 25,
  },

  heavy: {
    label: "Heavy",
    description: "Full quality — production grade",

    classifierModel: undefined,
    researcherModel: undefined,
    synthesizerModel: "claude-sonnet-4-5",
    verifierModel: "claude-sonnet-4-5",

    evidenceMinItems: 40,

    totalFindings: "25-35",
    findingsPerSection: "3-5",
    supportingEvidenceMin: 3,
    explanationLength: "2-4 sentences",
    quoteLength: "2-4 sentences — include full context, surrounding data points, and methodology details when available",
    keyStatsCount: 6,

    methodologyLength: "3-5 sentences",
    methodologySources: "3-4",
    removalThreshold: 25,
  },

  "x-heavy": {
    label: "X-Heavy",
    description: "Maximum reasoning — opus, most thorough",

    classifierModel: "claude-sonnet-4-5",
    researcherModel: "claude-opus-4-6",
    synthesizerModel: "claude-opus-4-6",
    verifierModel: "claude-opus-4-6",

    evidenceMinItems: 60,

    totalFindings: "35-50",
    findingsPerSection: "4-7",
    supportingEvidenceMin: 5,
    explanationLength: "3-6 sentences",
    quoteLength: "3-6 sentences — provide extensive verbatim quotes with full surrounding context, complete data tables or breakdowns when available, and detailed methodology descriptions",
    keyStatsCount: 8,

    methodologyLength: "5-8 sentences",
    methodologySources: "4-6",
    removalThreshold: 25,
  },
};

export const DEFAULT_REASONING_LEVEL = "x-light";

export function getReasoningConfig(level: string): ReasoningConfig {
  return REASONING_LEVELS[level] || REASONING_LEVELS[DEFAULT_REASONING_LEVEL];
}
