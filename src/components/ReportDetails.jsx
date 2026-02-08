import { useState } from "react";

const COLORS = {
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
};

const STAGE_META = {
  classifier: {
    label: "Stage 1: Classifier",
    description: "Identifies domain, extracts ticker/company, determines focus areas",
    color: "#6366f1",
  },
  researcher: {
    label: "Stage 2: Researcher",
    description: "Gathers 40+ evidence items with sources, quotes, and authority levels",
    color: "#0891b2",
  },
  synthesizer: {
    label: "Stage 3: Synthesizer",
    description: "Transforms evidence into structured report with findings and prose",
    color: "#059669",
  },
  verifier: {
    label: "Stage 4: Verifier",
    description: "Adversarial fact-checker — assigns certainty scores, adds contrary evidence",
    color: "#d97706",
  },
  pipeline_summary: {
    label: "Pipeline Summary",
    description: "Overall pipeline timing and statistics",
    color: "#7c3aed",
  },
};

// ─── Reusable sub-components ─────────────────────────────────────────────────

function CollapsibleSection({ title, subtitle, color, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen || false);
  return (
    <div
      style={{
        border: `1px solid ${COLORS.border}`,
        borderLeft: `3px solid ${color || COLORS.accent}`,
        borderRadius: 4,
        marginBottom: 8,
        background: COLORS.cardBg,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        <span
          style={{
            fontSize: 12,
            color: COLORS.textMuted,
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
            flexShrink: 0,
            marginLeft: 12,
          }}
        >
          ▶
        </span>
      </button>
      {open && <div style={{ padding: "0 14px 14px" }}>{children}</div>}
    </div>
  );
}

function TabBar({ tabs, activeTab, onTabChange }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderBottom: `1px solid ${COLORS.border}`,
        marginBottom: 10,
        flexWrap: "wrap",
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          style={{
            padding: "6px 14px",
            fontSize: 11,
            fontWeight: activeTab === tab.id ? 700 : 500,
            color: activeTab === tab.id ? COLORS.accent : COLORS.textMuted,
            background: activeTab === tab.id ? COLORS.panelBg : "transparent",
            border: "none",
            borderBottom: activeTab === tab.id
              ? `2px solid ${COLORS.accent}`
              : "2px solid transparent",
            cursor: "pointer",
            fontFamily: "inherit",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function CodeBlock({ content, maxHeight }) {
  const [copied, setCopied] = useState(false);
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={handleCopy}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          padding: "3px 8px",
          fontSize: 10,
          fontWeight: 600,
          border: `1px solid ${COLORS.border}40`,
          borderRadius: 3,
          background: COLORS.codeBg,
          color: COLORS.codeText,
          cursor: "pointer",
          opacity: 0.7,
          zIndex: 2,
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre
        style={{
          background: COLORS.codeBg,
          color: COLORS.codeText,
          padding: 14,
          borderRadius: 4,
          fontSize: 11,
          lineHeight: 1.6,
          overflow: "auto",
          maxHeight: maxHeight || 500,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: 0,
        }}
      >
        {text}
      </pre>
    </div>
  );
}

function StatRow({ label, value, color }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 0",
        borderBottom: `1px solid ${COLORS.border}40`,
      }}
    >
      <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: color || COLORS.text, fontFamily: "monospace" }}>
        {value}
      </span>
    </div>
  );
}

// ─── Agent Trace Panel ──────────────────────────────────────────────────────

function AgentTracePanel({ traceEvent }) {
  const [activeTab, setActiveTab] = useState("overview");
  const { stage, agent, trace, intermediateOutput } = traceEvent;
  const meta = STAGE_META[stage] || { label: agent, description: "", color: COLORS.accent };

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "system_prompt", label: "System Prompt" },
    { id: "user_message", label: "User Message" },
    { id: "raw_response", label: "Raw LLM Output" },
    { id: "parsed", label: "Parsed Output" },
  ];

  // Pipeline summary doesn't have LLM call data
  if (stage === "pipeline_summary") {
    return (
      <div>
        <StatRow
          label="Total Pipeline Duration"
          value={`${(trace.timing?.durationMs / 1000).toFixed(1)}s`}
        />
        {intermediateOutput && (
          <>
            <StatRow label="Query" value={intermediateOutput.query} />
            <StatRow label="Total Stages" value={intermediateOutput.totalStages} />
            <StatRow label="Total Findings" value={intermediateOutput.totalFindings} />
            <StatRow label="Avg Certainty" value={`${intermediateOutput.avgCertainty}%`} />
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "overview" && (
        <div>
          <div
            style={{
              fontSize: 11,
              color: COLORS.textMuted,
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            {meta.description}
          </div>

          <StatRow
            label="Model"
            value={trace.request?.model || "unknown"}
          />
          <StatRow
            label="Max Tokens"
            value={(trace.request?.max_tokens || 0).toLocaleString()}
          />
          <StatRow
            label="Duration"
            value={`${(trace.timing?.durationMs / 1000).toFixed(1)}s`}
          />
          <StatRow
            label="Input Tokens"
            value={(trace.response?.usage?.input_tokens || 0).toLocaleString()}
          />
          <StatRow
            label="Output Tokens"
            value={(trace.response?.usage?.output_tokens || 0).toLocaleString()}
          />
          <StatRow
            label="Stop Reason"
            value={trace.response?.stop_reason || "unknown"}
          />
          <StatRow
            label="Started At"
            value={trace.timing?.startTime || "N/A"}
          />
          {trace.parseWarning && (
            <div
              style={{
                marginTop: 8,
                padding: "6px 10px",
                background: COLORS.orange + "15",
                border: `1px solid ${COLORS.orange}30`,
                borderRadius: 4,
                fontSize: 11,
                color: COLORS.orange,
              }}
            >
              Parse warning: {trace.parseWarning}
            </div>
          )}

          {/* Show summary stats for specific agents */}
          {trace.parsedOutput && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  color: COLORS.textMuted,
                  marginBottom: 6,
                }}
              >
                Agent Output Summary
              </div>
              {Object.entries(trace.parsedOutput).map(([key, val]) => {
                if (typeof val === "object" && !Array.isArray(val)) return null;
                return (
                  <StatRow
                    key={key}
                    label={key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
                    value={Array.isArray(val) ? `[${val.length} items] ${val.join(", ")}` : String(val)}
                  />
                );
              })}
            </div>
          )}

          {/* Certainty summary table for verifier */}
          {trace.parsedOutput?.certaintySummary && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  color: COLORS.textMuted,
                  marginBottom: 6,
                }}
              >
                Certainty Scores by Finding
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: "2px 12px",
                  fontSize: 11,
                }}
              >
                {trace.parsedOutput.certaintySummary.map((f) => (
                  <div key={f.id} style={{ display: "contents" }}>
                    <span style={{ fontFamily: "monospace", color: COLORS.textMuted }}>{f.id}</span>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 3,
                        background: COLORS.border,
                        alignSelf: "center",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${f.certainty}%`,
                          background:
                            f.certainty > 90
                              ? COLORS.green
                              : f.certainty >= 50
                              ? COLORS.orange
                              : COLORS.red,
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 600,
                        color:
                          f.certainty > 90
                            ? COLORS.green
                            : f.certainty >= 50
                            ? COLORS.orange
                            : COLORS.red,
                      }}
                    >
                      {f.certainty}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "system_prompt" && (
        <CodeBlock content={trace.request?.system || "No system prompt"} maxHeight={600} />
      )}

      {activeTab === "user_message" && (
        <CodeBlock
          content={
            trace.request?.messages?.[0]?.content || "No user message"
          }
          maxHeight={600}
        />
      )}

      {activeTab === "raw_response" && (
        <CodeBlock content={trace.response?.raw || "No response"} maxHeight={800} />
      )}

      {activeTab === "parsed" && (
        <div>
          {intermediateOutput ? (
            <CodeBlock content={intermediateOutput} maxHeight={800} />
          ) : (
            <div style={{ fontSize: 12, color: COLORS.textMuted, fontStyle: "italic" }}>
              Final report output — see the report view.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Evidence Explorer ──────────────────────────────────────────────────────

function EvidenceExplorer({ evidence }) {
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  if (!Array.isArray(evidence)) return null;

  const categories = [...new Set(evidence.map((e) => e.category).filter(Boolean))];
  const filtered = evidence.filter((ev) => {
    const matchesText =
      !filter ||
      ev.source?.toLowerCase().includes(filter.toLowerCase()) ||
      ev.quote?.toLowerCase().includes(filter.toLowerCase());
    const matchesCat = categoryFilter === "all" || ev.category === categoryFilter;
    return matchesText && matchesCat;
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Filter evidence..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            minWidth: 150,
            padding: "5px 10px",
            fontSize: 12,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 4,
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{
            padding: "5px 10px",
            fontSize: 12,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 4,
            fontFamily: "inherit",
            background: COLORS.cardBg,
          }}
        >
          <option value="all">All categories ({evidence.length})</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat} ({evidence.filter((e) => e.category === cat).length})
            </option>
          ))}
        </select>
      </div>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 8 }}>
        Showing {filtered.length} of {evidence.length} evidence items
      </div>
      <div style={{ maxHeight: 500, overflow: "auto" }}>
        {filtered.map((ev, i) => (
          <div
            key={i}
            style={{
              padding: "8px 10px",
              marginBottom: 4,
              background: COLORS.panelBg,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontWeight: 700, color: COLORS.text }}>{ev.source}</span>
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  background: COLORS.accent + "10",
                  borderRadius: 3,
                  color: COLORS.textSecondary,
                  fontFamily: "monospace",
                }}
              >
                {ev.category}
              </span>
            </div>
            <div style={{ color: COLORS.textSecondary, fontStyle: "italic", lineHeight: 1.5 }}>
              &ldquo;{ev.quote}&rdquo;
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 3 }}>
              <span style={{ fontSize: 10, color: COLORS.textMuted }}>
                {ev.url}
              </span>
              <span style={{ fontSize: 10, color: COLORS.textMuted }}>
                {ev.authority}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Findings Diff (pre-verification vs post-verification) ─────────────────

function FindingsDiff({ draft, verifierTrace }) {
  if (!draft?.findings || !verifierTrace?.parsedOutput) return null;

  const removedIds = verifierTrace.parsedOutput.removedFindings || [];
  const certaintySummary = verifierTrace.parsedOutput.certaintySummary || [];
  const certMap = {};
  certaintySummary.forEach((c) => { certMap[c.id] = c; });

  return (
    <div>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 10 }}>
        Comparing {draft.findings.length} draft findings against verifier output.
        {removedIds.length > 0 && (
          <span style={{ color: COLORS.red, fontWeight: 600 }}>
            {" "}{removedIds.length} finding(s) removed (certainty &lt;25%).
          </span>
        )}
      </div>

      <div style={{ maxHeight: 500, overflow: "auto" }}>
        {draft.findings.map((f) => {
          const removed = removedIds.includes(f.id);
          const cert = certMap[f.id];

          return (
            <div
              key={f.id}
              style={{
                padding: "8px 10px",
                marginBottom: 4,
                background: removed ? COLORS.red + "08" : COLORS.panelBg,
                border: `1px solid ${removed ? COLORS.red + "30" : COLORS.border}`,
                borderRadius: 4,
                fontSize: 11,
                opacity: removed ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: COLORS.textMuted }}>
                  {f.id}
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {removed && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        background: COLORS.red + "20",
                        borderRadius: 3,
                        color: COLORS.red,
                        fontWeight: 700,
                      }}
                    >
                      REMOVED
                    </span>
                  )}
                  {cert && (
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: "monospace",
                        fontWeight: 700,
                        color:
                          cert.certainty > 90
                            ? COLORS.green
                            : cert.certainty >= 50
                            ? COLORS.orange
                            : COLORS.red,
                      }}
                    >
                      {cert.certainty}%
                      {cert.contraryCount > 0 && (
                        <span style={{ color: COLORS.orange, marginLeft: 4 }}>
                          ({cert.contraryCount} contrary)
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ color: COLORS.textSecondary, lineHeight: 1.5 }}>{f.text}</div>
              <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 3 }}>
                Section: {f.section} | Supporting evidence: {f.explanation?.supportingEvidence?.length || 0}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main ReportDetails Component ───────────────────────────────────────────

export default function ReportDetails({ traceData, onClose }) {
  if (!traceData || traceData.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: COLORS.textMuted }}>
        No trace data available. Generate a report to see pipeline details.
      </div>
    );
  }

  // Organize trace events by stage
  const traceByStage = {};
  traceData.forEach((t) => { traceByStage[t.stage] = t; });

  const classifierTrace = traceByStage.classifier;
  const researcherTrace = traceByStage.researcher;
  const synthesizerTrace = traceByStage.synthesizer;
  const verifierTrace = traceByStage.verifier;
  const pipelineSummary = traceByStage.pipeline_summary;

  // Extract intermediate outputs for specialized views
  const evidence = researcherTrace?.intermediateOutput;
  const draft = synthesizerTrace?.intermediateOutput;

  // Compute total token usage across all stages
  const totalInputTokens = traceData.reduce(
    (sum, t) => sum + (t.trace?.response?.usage?.input_tokens || 0),
    0
  );
  const totalOutputTokens = traceData.reduce(
    (sum, t) => sum + (t.trace?.response?.usage?.output_tokens || 0),
    0
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          maxWidth: 900,
          width: "100%",
          margin: "20px auto",
          background: COLORS.bg,
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            background: COLORS.accent,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Report Details</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              Pipeline trace — click each stage to expand. Drill down to raw LLM calls.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              padding: "4px 12px",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {/* Pipeline Overview Stats */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {[
              {
                label: "Total Duration",
                value: pipelineSummary
                  ? `${(pipelineSummary.trace.timing.durationMs / 1000).toFixed(1)}s`
                  : "N/A",
              },
              { label: "Input Tokens", value: totalInputTokens.toLocaleString() },
              { label: "Output Tokens", value: totalOutputTokens.toLocaleString() },
              {
                label: "Total Tokens",
                value: (totalInputTokens + totalOutputTokens).toLocaleString(),
              },
              {
                label: "LLM Calls",
                value: traceData.filter((t) => t.stage !== "pipeline_summary").length,
              },
              {
                label: "Findings",
                value: pipelineSummary?.intermediateOutput?.totalFindings ?? "N/A",
              },
            ].map((stat, i) => (
              <div
                key={i}
                style={{
                  padding: "10px 14px",
                  background: COLORS.cardBg,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 4,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: COLORS.textMuted,
                    marginBottom: 4,
                  }}
                >
                  {stat.label}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.accent }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Per-stage details */}
          {classifierTrace && (
            <CollapsibleSection
              title={STAGE_META.classifier.label}
              subtitle={`${(classifierTrace.trace.timing?.durationMs / 1000).toFixed(1)}s | ${(classifierTrace.trace.response?.usage?.input_tokens || 0).toLocaleString()} in / ${(classifierTrace.trace.response?.usage?.output_tokens || 0).toLocaleString()} out tokens`}
              color={STAGE_META.classifier.color}
            >
              <AgentTracePanel traceEvent={classifierTrace} />
            </CollapsibleSection>
          )}

          {researcherTrace && (
            <CollapsibleSection
              title={STAGE_META.researcher.label}
              subtitle={`${(researcherTrace.trace.timing?.durationMs / 1000).toFixed(1)}s | ${Array.isArray(evidence) ? evidence.length : 0} evidence items | ${(researcherTrace.trace.response?.usage?.input_tokens || 0).toLocaleString()} in / ${(researcherTrace.trace.response?.usage?.output_tokens || 0).toLocaleString()} out tokens`}
              color={STAGE_META.researcher.color}
            >
              <AgentTracePanel traceEvent={researcherTrace} />
              {Array.isArray(evidence) && (
                <CollapsibleSection
                  title="Evidence Explorer"
                  subtitle={`Browse and filter all ${evidence.length} evidence items`}
                  color={STAGE_META.researcher.color}
                >
                  <EvidenceExplorer evidence={evidence} />
                </CollapsibleSection>
              )}
            </CollapsibleSection>
          )}

          {synthesizerTrace && (
            <CollapsibleSection
              title={STAGE_META.synthesizer.label}
              subtitle={`${(synthesizerTrace.trace.timing?.durationMs / 1000).toFixed(1)}s | ${draft?.findings?.length || 0} findings, ${draft?.sections?.length || 0} sections | ${(synthesizerTrace.trace.response?.usage?.input_tokens || 0).toLocaleString()} in / ${(synthesizerTrace.trace.response?.usage?.output_tokens || 0).toLocaleString()} out tokens`}
              color={STAGE_META.synthesizer.color}
            >
              <AgentTracePanel traceEvent={synthesizerTrace} />
            </CollapsibleSection>
          )}

          {verifierTrace && (
            <CollapsibleSection
              title={STAGE_META.verifier.label}
              subtitle={`${(verifierTrace.trace.timing?.durationMs / 1000).toFixed(1)}s | ${verifierTrace.trace.parsedOutput?.findingsCount || "?"} findings retained | ${(verifierTrace.trace.response?.usage?.input_tokens || 0).toLocaleString()} in / ${(verifierTrace.trace.response?.usage?.output_tokens || 0).toLocaleString()} out tokens`}
              color={STAGE_META.verifier.color}
            >
              <AgentTracePanel traceEvent={verifierTrace} />
              {draft && (
                <CollapsibleSection
                  title="Verification Diff"
                  subtitle="Compare pre-verification draft findings with post-verification results"
                  color={STAGE_META.verifier.color}
                >
                  <FindingsDiff draft={draft} verifierTrace={verifierTrace.trace} />
                </CollapsibleSection>
              )}
            </CollapsibleSection>
          )}

          {pipelineSummary && (
            <CollapsibleSection
              title={STAGE_META.pipeline_summary.label}
              subtitle={`Total: ${(pipelineSummary.trace.timing.durationMs / 1000).toFixed(1)}s`}
              color={STAGE_META.pipeline_summary.color}
            >
              <AgentTracePanel traceEvent={pipelineSummary} />
            </CollapsibleSection>
          )}

          {/* Raw JSON dump of all trace data */}
          <CollapsibleSection
            title="Raw Trace Data"
            subtitle="Complete JSON dump of all trace events — for copy-pasting"
            color={COLORS.textMuted}
          >
            <CodeBlock content={traceData} maxHeight={600} />
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
