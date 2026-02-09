import { describe, it, expect } from "vitest";
import { COLORS, getCertaintyColor, getCertaintyLabel } from "./certainty-utils";

describe("COLORS", () => {
  it("has all required color constants", () => {
    expect(COLORS.bg).toBeDefined();
    expect(COLORS.cardBg).toBeDefined();
    expect(COLORS.text).toBeDefined();
    expect(COLORS.textSecondary).toBeDefined();
    expect(COLORS.textMuted).toBeDefined();
    expect(COLORS.border).toBeDefined();
    expect(COLORS.accent).toBeDefined();
    expect(COLORS.green).toBeDefined();
    expect(COLORS.orange).toBeDefined();
    expect(COLORS.red).toBeDefined();
    expect(COLORS.panelBg).toBeDefined();
  });

  it("uses valid hex color format", () => {
    const hexRegex = /^#[0-9a-f]{6}$/;
    for (const [key, value] of Object.entries(COLORS)) {
      expect(value).toMatch(hexRegex);
    }
  });
});

describe("getCertaintyColor", () => {
  it("returns green for certainty > 90", () => {
    expect(getCertaintyColor(91)).toBe(COLORS.green);
    expect(getCertaintyColor(95)).toBe(COLORS.green);
    expect(getCertaintyColor(99)).toBe(COLORS.green);
    expect(getCertaintyColor(100)).toBe(COLORS.green);
  });

  it("returns orange for certainty 50-90", () => {
    expect(getCertaintyColor(50)).toBe(COLORS.orange);
    expect(getCertaintyColor(70)).toBe(COLORS.orange);
    expect(getCertaintyColor(90)).toBe(COLORS.orange);
  });

  it("returns red for certainty < 50", () => {
    expect(getCertaintyColor(49)).toBe(COLORS.red);
    expect(getCertaintyColor(25)).toBe(COLORS.red);
    expect(getCertaintyColor(0)).toBe(COLORS.red);
    expect(getCertaintyColor(1)).toBe(COLORS.red);
  });

  it("handles boundary at 90 (orange, not green)", () => {
    expect(getCertaintyColor(90)).toBe(COLORS.orange);
  });

  it("handles boundary at 91 (green)", () => {
    expect(getCertaintyColor(91)).toBe(COLORS.green);
  });

  it("handles boundary at 50 (orange, not red)", () => {
    expect(getCertaintyColor(50)).toBe(COLORS.orange);
  });

  it("handles boundary at 49 (red)", () => {
    expect(getCertaintyColor(49)).toBe(COLORS.red);
  });
});

describe("getCertaintyLabel", () => {
  it("returns 'High' for certainty > 90", () => {
    expect(getCertaintyLabel(91)).toBe("High");
    expect(getCertaintyLabel(99)).toBe("High");
  });

  it("returns 'Moderate-High' for certainty 75-90", () => {
    expect(getCertaintyLabel(75)).toBe("Moderate-High");
    expect(getCertaintyLabel(85)).toBe("Moderate-High");
    expect(getCertaintyLabel(90)).toBe("Moderate-High");
  });

  it("returns 'Moderate' for certainty 50-74", () => {
    expect(getCertaintyLabel(50)).toBe("Moderate");
    expect(getCertaintyLabel(60)).toBe("Moderate");
    expect(getCertaintyLabel(74)).toBe("Moderate");
  });

  it("returns 'Low' for certainty < 50", () => {
    expect(getCertaintyLabel(49)).toBe("Low");
    expect(getCertaintyLabel(25)).toBe("Low");
    expect(getCertaintyLabel(0)).toBe("Low");
  });

  it("handles boundary at 75 (Moderate-High, not Moderate)", () => {
    expect(getCertaintyLabel(75)).toBe("Moderate-High");
  });

  it("handles boundary at 74 (Moderate)", () => {
    expect(getCertaintyLabel(74)).toBe("Moderate");
  });
});
