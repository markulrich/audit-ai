import { getCertaintyColor, getCertaintyLabel } from "./certainty-utils";

interface CertaintyBadgeProps {
  value: number;
  large?: boolean;
}

export default function CertaintyBadge({ value, large }: CertaintyBadgeProps) {
  const color = getCertaintyColor(value);
  return (
    <span
      role="status"
      aria-label={`Certainty: ${value}%, ${getCertaintyLabel(value)}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: large ? 14 : 12,
        fontWeight: 600,
        color,
        background: color + "0d",
        border: `1px solid ${color}30`,
        borderRadius: 4,
        padding: large ? "4px 12px" : "2px 8px",
        letterSpacing: 0.3,
      }}
    >
      {value}%
      <span style={{ fontWeight: 400, opacity: 0.8 }}>{getCertaintyLabel(value)}</span>
    </span>
  );
}
