import { useState } from "react";

interface Props {
  onSubmit: (query: string) => void;
  disabled: boolean;
  reasoningLevel: string;
  onReasoningLevelChange: (level: string) => void;
}

interface ReasoningLevelOption {
  value: string;
  label: string;
  description: string;
}

const EXAMPLES: string[] = [
  "Analyze NVIDIA (NVDA)",
  "Deep dive on Tesla's competitive position",
  "Pitch deck for an AI-powered legal tech startup",
  "Slide deck on Apple's financial performance",
];

const REASONING_LEVELS: ReasoningLevelOption[] = [
  { value: "x-light", label: "X-Light", description: "Fastest — for testing" },
  { value: "light", label: "Light", description: "Faster — reduced scope" },
  { value: "heavy", label: "Heavy", description: "Full quality" },
  { value: "x-heavy", label: "X-Heavy", description: "Maximum depth" },
];

export default function QueryInput({ onSubmit, disabled, reasoningLevel, onReasoningLevelChange }: Props) {
  const [query, setQuery] = useState<string>("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (query.trim().length >= 3 && !disabled) {
      onSubmit(query.trim());
    }
  };

  return (
    <div style={{ width: "100%", maxWidth: 600 }}>
      <form onSubmit={handleSubmit}>
        <div
          style={{
            display: "flex",
            gap: 8,
            background: "#fff",
            border: "1.5px solid #e2e4ea",
            borderRadius: 8,
            padding: 6,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="Enter a company or research topic..."
            disabled={disabled}
            style={{
              flex: 1,
              padding: "10px 14px",
              fontSize: 15,
              border: "none",
              background: "transparent",
              color: "#1a1a2e",
              fontFamily: "inherit",
            }}
          />
          <button
            type="submit"
            disabled={disabled || query.trim().length < 3}
            style={{
              padding: "10px 24px",
              fontSize: 13,
              fontWeight: 700,
              border: "none",
              borderRadius: 5,
              background: disabled ? "#e2e4ea" : "#1a1a2e",
              color: disabled ? "#8a8ca5" : "#fff",
              cursor: disabled ? "not-allowed" : "pointer",
              transition: "all 0.15s",
              letterSpacing: 0.3,
            }}
          >
            {disabled ? "Classifying..." : "Generate"}
          </button>
        </div>
      </form>

      {/* Reasoning level selector */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginTop: 12,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#8a8ca5",
            marginRight: 4,
            letterSpacing: 0.3,
            textTransform: "uppercase",
          }}
        >
          Reasoning
        </span>
        {REASONING_LEVELS.map((level: ReasoningLevelOption) => {
          const isActive = reasoningLevel === level.value;
          return (
            <button
              key={level.value}
              onClick={() => onReasoningLevelChange(level.value)}
              disabled={disabled}
              title={level.description}
              style={{
                padding: "4px 12px",
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                border: isActive ? "1.5px solid #1a1a2e" : "1px solid #e2e4ea",
                borderRadius: 4,
                background: isActive ? "#1a1a2e" : "#fff",
                color: isActive ? "#fff" : "#555770",
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "all 0.15s",
                opacity: disabled ? 0.5 : 1,
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                if (!isActive && !disabled) {
                  e.currentTarget.style.borderColor = "#1a1a2e";
                  e.currentTarget.style.color = "#1a1a2e";
                }
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                if (!isActive && !disabled) {
                  e.currentTarget.style.borderColor = "#e2e4ea";
                  e.currentTarget.style.color = "#555770";
                }
              }}
            >
              {level.label}
            </button>
          );
        })}
      </div>

      {/* Example queries */}
      {!disabled && (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 14,
            justifyContent: "center",
          }}
        >
          {EXAMPLES.map((ex: string) => (
            <button
              key={ex}
              onClick={() => {
                setQuery(ex);
                onSubmit(ex);
              }}
              style={{
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: 500,
                border: "1px solid #e2e4ea",
                borderRadius: 20,
                background: "#fff",
                color: "#555770",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.borderColor = "#1a1a2e";
                e.currentTarget.style.color = "#1a1a2e";
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.borderColor = "#e2e4ea";
                e.currentTarget.style.color = "#555770";
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
