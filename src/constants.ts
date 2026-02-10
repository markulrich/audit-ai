/**
 * Shared UI constants used across multiple components.
 */

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
  codeBg: "#1e1e2e",
  codeText: "#cdd6f4",
  userBubble: "#1a1a2e",
  userText: "#ffffff",
  assistantBubble: "#ffffff",
} as const;

export const EXAMPLES: string[] = [
  "Analyze NVIDIA (NVDA)",
  "Deep dive on Tesla's competitive position",
  "Pitch deck for an AI-powered legal tech startup",
  "Slide deck on Apple's financial performance",
];

export interface ReasoningLevelOption {
  value: string;
  label: string;
  description: string;
}

export const REASONING_LEVELS: ReasoningLevelOption[] = [
  { value: "x-light", label: "X-Light", description: "Fastest — for testing" },
  { value: "light", label: "Light", description: "Faster — reduced scope" },
  { value: "heavy", label: "Heavy", description: "Full quality" },
  { value: "x-heavy", label: "X-Heavy", description: "Maximum reasoning" },
];
