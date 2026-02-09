// Shared color constants and certainty utility functions

export const COLORS = {
  bg: "#fafafa",
  cardBg: "#ffffff",
  text: "#1a1a2e",
  textSecondary: "#555770",
  textMuted: "#8a8ca5",
  border: "#e2e4ea",
  accent: "#1a1a2e",
  green: "#15803d",
  orange: "#b45309",
  red: "#b91c1c",
  panelBg: "#f7f7fa",
} as const;

export function getCertaintyColor(c: number): string {
  if (c > 90) return COLORS.green;
  if (c >= 50) return COLORS.orange;
  return COLORS.red;
}

export function getCertaintyLabel(c: number): string {
  if (c > 90) return "High";
  if (c >= 75) return "Moderate-High";
  if (c >= 50) return "Moderate";
  return "Low";
}
