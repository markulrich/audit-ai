import { describe, it, expect } from "vitest";
import { REASONING_LEVELS, DEFAULT_REASONING_LEVEL, getReasoningConfig } from "./reasoning-levels";

describe("reasoning-levels", () => {
  it("defines four reasoning levels", () => {
    const levels = Object.keys(REASONING_LEVELS);
    expect(levels).toEqual(["x-light", "light", "heavy", "x-heavy"]);
  });

  it("each level has required fields", () => {
    for (const [name, config] of Object.entries(REASONING_LEVELS)) {
      expect(config.label).toBeDefined();
      expect(config.description).toBeDefined();
      expect(config.evidenceMinItems).toBeGreaterThanOrEqual(0);
      expect(config.totalFindings).toBeDefined();
      expect(config.findingsPerSection).toBeDefined();
      expect(config.supportingEvidenceMin).toBeGreaterThanOrEqual(0);
      expect(config.explanationLength).toBeDefined();
      expect(config.quoteLength).toBeDefined();
      expect(config.keyStatsCount).toBeGreaterThan(0);
      expect(config.methodologyLength).toBeDefined();
      expect(config.methodologySources).toBeDefined();
      expect(typeof config.removalThreshold).toBe("number");
    }
  });

  it("evidence requirements increase across levels", () => {
    const levels = ["x-light", "light", "heavy", "x-heavy"];
    for (let i = 1; i < levels.length; i++) {
      const prev = REASONING_LEVELS[levels[i - 1]];
      const curr = REASONING_LEVELS[levels[i]];
      expect(curr.evidenceMinItems).toBeGreaterThanOrEqual(prev.evidenceMinItems);
      expect(curr.supportingEvidenceMin).toBeGreaterThanOrEqual(prev.supportingEvidenceMin);
      expect(curr.keyStatsCount).toBeGreaterThanOrEqual(prev.keyStatsCount);
    }
  });

  it("x-heavy uses more powerful models", () => {
    const xheavy = REASONING_LEVELS["x-heavy"];
    expect(xheavy.researcherModel).toContain("opus");
    expect(xheavy.synthesizerModel).toContain("opus");
    expect(xheavy.verifierModel).toContain("opus");
  });

  it("x-light has removalThreshold of 0 (keeps all findings)", () => {
    expect(REASONING_LEVELS["x-light"].removalThreshold).toBe(0);
  });

  it("other levels have removalThreshold of 25", () => {
    expect(REASONING_LEVELS["light"].removalThreshold).toBe(25);
    expect(REASONING_LEVELS["heavy"].removalThreshold).toBe(25);
    expect(REASONING_LEVELS["x-heavy"].removalThreshold).toBe(25);
  });

  describe("getReasoningConfig", () => {
    it("returns the config for a known level", () => {
      const config = getReasoningConfig("heavy");
      expect(config.label).toBe("Heavy");
      expect(config.evidenceMinItems).toBe(40);
    });

    it("returns default config for unknown level", () => {
      const config = getReasoningConfig("unknown-level");
      expect(config.label).toBe("X-Light");
    });

    it("returns default config for empty string", () => {
      const config = getReasoningConfig("");
      expect(config.label).toBe("X-Light");
    });

    it("DEFAULT_REASONING_LEVEL is x-light", () => {
      expect(DEFAULT_REASONING_LEVEL).toBe("x-light");
    });
  });
});
