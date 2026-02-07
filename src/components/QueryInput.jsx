import { useState } from "react";

const EXAMPLES = [
  "Analyze NVIDIA (NVDA)",
  "Deep dive on Tesla's competitive position",
  "Palantir equity research report",
  "Apple financial analysis and outlook",
];

export default function QueryInput({ onSubmit, disabled }) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e) => {
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
            onChange={(e) => setQuery(e.target.value)}
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
            {disabled ? "Generating..." : "Generate"}
          </button>
        </div>
      </form>

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
          {EXAMPLES.map((ex) => (
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
              onMouseEnter={(e) => {
                e.target.style.borderColor = "#1a1a2e";
                e.target.style.color = "#1a1a2e";
              }}
              onMouseLeave={(e) => {
                e.target.style.borderColor = "#e2e4ea";
                e.target.style.color = "#555770";
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
