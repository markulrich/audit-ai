const STAGE_LABELS = {
  classifying: "Classifying Query",
  classified: "Domain Identified",
  researching: "Gathering Evidence",
  researched: "Evidence Collected",
  synthesizing: "Drafting Report",
  synthesized: "Report Drafted",
  verifying: "Verifying Findings",
  verified: "Verification Complete",
};

const STAGE_ORDER = [
  "classifying",
  "researching",
  "synthesizing",
  "verifying",
];

export default function ProgressStream({ steps }) {
  const latest = steps[steps.length - 1];
  const percent = latest?.percent || 0;

  // Determine which major stages are done
  const completedStages = new Set(steps.map((s) => s.stage));

  return (
    <div
      style={{
        marginTop: 32,
        width: "100%",
        maxWidth: 500,
      }}
    >
      {/* Progress bar */}
      <div
        style={{
          height: 3,
          background: "#e2e4ea",
          borderRadius: 2,
          overflow: "hidden",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${percent}%`,
            background: "#1a1a2e",
            borderRadius: 2,
            transition: "width 0.5s ease",
          }}
        />
      </div>

      {/* Stage list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {STAGE_ORDER.map((stage) => {
          const isDone =
            completedStages.has(stage + "ed") ||
            completedStages.has(stage.replace("ing", "ed")) ||
            completedStages.has(stage.replace("ying", "ied"));
          const isActive =
            completedStages.has(stage) && !isDone;
          const stepData = steps.find((s) => s.stage === stage);
          const doneData = steps.find(
            (s) =>
              s.stage === stage + "ed" ||
              s.stage === stage.replace("ing", "ed") ||
              s.stage === stage.replace("ying", "ied")
          );

          return (
            <div
              key={stage}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                opacity: isDone || isActive ? 1 : 0.35,
                transition: "opacity 0.3s",
              }}
            >
              {/* Status dot */}
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                  background: isDone
                    ? "#15803d"
                    : isActive
                    ? "#b45309"
                    : "#e2e4ea",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {isDone ? "✓" : isActive ? "..." : ""}
              </div>

              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: isDone || isActive ? "#1a1a2e" : "#8a8ca5",
                  }}
                >
                  {STAGE_LABELS[stage]}
                </div>
                {(doneData || (isActive && stepData)) && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#8a8ca5",
                      marginTop: 2,
                    }}
                  >
                    {doneData?.message || stepData?.message}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Animated dots */}
      {latest && !completedStages.has("verified") && (
        <div
          style={{
            textAlign: "center",
            marginTop: 24,
            fontSize: 12,
            color: "#8a8ca5",
            fontStyle: "italic",
          }}
        >
          {latest.message}
        </div>
      )}
    </div>
  );
}
