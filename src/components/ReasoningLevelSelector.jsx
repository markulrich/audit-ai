const LEVELS = [
  {
    key: "xlight",
    label: "X-Light",
    model: "Haiku",
    description: "Fastest possible",
    color: "#06b6d4",
  },
  {
    key: "light",
    label: "Light",
    model: "Haiku",
    description: "Fast, fewer details",
    color: "#22c55e",
  },
  {
    key: "medium",
    label: "Medium",
    model: "Sonnet",
    description: "Balanced depth",
    color: "#b45309",
  },
  {
    key: "heavy",
    label: "Heavy",
    model: "Opus",
    description: "Maximum rigor",
    color: "#7c3aed",
  },
];

export default function ReasoningLevelSelector({ value, onChange, disabled }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#8a8ca5",
          marginRight: 2,
          whiteSpace: "nowrap",
        }}
      >
        Reasoning
      </span>
      <div
        style={{
          display: "flex",
          gap: 0,
          background: "#f4f4f6",
          borderRadius: 6,
          padding: 2,
        }}
      >
        {LEVELS.map((level) => {
          const isActive = value === level.key;
          return (
            <button
              key={level.key}
              onClick={() => onChange(level.key)}
              disabled={disabled}
              title={`${level.label} (${level.model}) — ${level.description}`}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                border: "none",
                borderRadius: 4,
                background: isActive ? "#fff" : "transparent",
                color: isActive ? level.color : "#8a8ca5",
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "all 0.15s",
                boxShadow: isActive
                  ? "0 1px 3px rgba(0,0,0,0.08)"
                  : "none",
                opacity: disabled ? 0.6 : 1,
                lineHeight: 1.4,
              }}
            >
              <span>{level.label}</span>
              <span
                style={{
                  display: "block",
                  fontSize: 9,
                  fontWeight: 400,
                  color: isActive ? level.color : "#adb0c0",
                  opacity: 0.8,
                }}
              >
                {level.model}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
