import { COLORS } from "../../constants";
export { COLORS };

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
