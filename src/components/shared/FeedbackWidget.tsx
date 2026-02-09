import { useState } from "react";
import { COLORS } from "./certainty-utils";

interface FeedbackWidgetProps {
  findingId: string;
}

export default function FeedbackWidget({ findingId }: FeedbackWidgetProps) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [showTextarea, setShowTextarea] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 11,
            color: COLORS.textMuted,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Rate this explanation
        </span>
        <button
          aria-label="Helpful"
          onClick={() => { setFeedback("up"); setShowTextarea(true); setSubmitted(false); }}
          style={{
            border: "none",
            background: feedback === "up" ? COLORS.green + "18" : "transparent",
            cursor: "pointer",
            fontSize: 16,
            padding: "3px 8px",
            borderRadius: 4,
            color: feedback === "up" ? COLORS.green : COLORS.textMuted,
          }}
        >
          ▲
        </button>
        <button
          aria-label="Not helpful"
          onClick={() => { setFeedback("down"); setShowTextarea(true); setSubmitted(false); }}
          style={{
            border: "none",
            background: feedback === "down" ? COLORS.red + "18" : "transparent",
            cursor: "pointer",
            fontSize: 16,
            padding: "3px 8px",
            borderRadius: 4,
            color: feedback === "down" ? COLORS.red : COLORS.textMuted,
          }}
        >
          ▼
        </button>
        {submitted && (
          <span style={{ fontSize: 11, color: COLORS.green, fontWeight: 500 }}>✓ Thanks</span>
        )}
      </div>
      {showTextarea && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={feedbackText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFeedbackText(e.target.value)}
            placeholder={feedback === "up" ? "What was helpful?" : "What could be improved?"}
            aria-label="Feedback details"
            style={{
              width: "100%",
              minHeight: 60,
              padding: 8,
              fontSize: 12,
              fontFamily: "inherit",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button
              onClick={() => { console.log("[feedback]", { findingId, feedback, feedbackText }); setSubmitted(true); setShowTextarea(false); }}
              style={{
                padding: "4px 14px",
                fontSize: 11,
                fontWeight: 600,
                border: "none",
                borderRadius: 4,
                background: COLORS.accent,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Submit
            </button>
            <button
              onClick={() => { setShowTextarea(false); setFeedback(null); }}
              style={{
                padding: "4px 14px",
                fontSize: 11,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 4,
                background: "transparent",
                color: COLORS.textSecondary,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
