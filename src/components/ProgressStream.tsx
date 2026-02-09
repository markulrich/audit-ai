import { useState, useEffect, useRef } from "react";
import type {
  ProgressEvent,
  TraceEvent,
  ErrorInfo,
  ProgressStats,
  CertaintyBuckets,
  EvidencePreviewItem,
  ErrorDetail,
} from "../../shared/types";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface StageConfig {
  key: string;
  doneKey: string;
  label: string;
  doneLabel: string;
  icon: string;
  color: string;
}

interface PulsingDotProps {
  color: string;
}

interface MiniCodeBlockProps {
  content: string | object;
  maxHeight?: number;
}

interface StageCardProps {
  config: StageConfig;
  activeData: ProgressEvent | undefined;
  doneData: ProgressEvent | undefined;
  traceEvent: TraceEvent | undefined;
  pendingTraceEvent: TraceEvent | undefined;
  isActive: boolean;
  isDone: boolean;
  isPending: boolean;
  isFailed: boolean;
  errorMessage: string | null;
  errorDetail: ErrorDetail | null | undefined;
}

interface ProgressStreamProps {
  steps: ProgressEvent[];
  traceData: TraceEvent[];
  error: ErrorInfo | null;
}

interface DrillTab {
  id: string;
  label: string;
  disabled?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const COLORS = {
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

const STAGE_CONFIG: StageConfig[] = [
  {
    key: "classifying",
    doneKey: "classified",
    label: "Classify Query",
    doneLabel: "Query Classified",
    icon: "1",
    color: "#6366f1",
  },
  {
    key: "drafting_answer",
    doneKey: "answer_drafted",
    label: "Draft Answer",
    doneLabel: "Answer Drafted",
    icon: "2",
    color: "#8b5cf6",
  },
  {
    key: "researching",
    doneKey: "researched",
    label: "Gather Evidence",
    doneLabel: "Evidence Gathered",
    icon: "3",
    color: "#0891b2",
  },
  {
    key: "synthesizing",
    doneKey: "synthesized",
    label: "Write Report",
    doneLabel: "Report Written",
    icon: "4",
    color: "#059669",
  },
  {
    key: "verifying",
    doneKey: "verified",
    label: "Audit & Finalize",
    doneLabel: "Audited & Finalized",
    icon: "5",
    color: "#d97706",
  },
];

// ─── Elapsed timer hook ─────────────────────────────────────────────────────

function useElapsed(active: boolean, frozen: boolean): string {
  const [elapsed, setElapsed] = useState<number>(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (active && !frozen) {
      startRef.current = Date.now();
      setElapsed(0);
      const interval = setInterval(() => {
        setElapsed(Date.now() - (startRef.current as number));
      }, 100);
      return () => clearInterval(interval);
    }
  }, [active, frozen]);

  return (elapsed / 1000).toFixed(1);
}

// ─── Animated dots ──────────────────────────────────────────────────────────

function PulsingDot({ color }: PulsingDotProps) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        animation: "pulse 1.5s ease-in-out infinite",
        marginRight: 4,
      }}
    />
  );
}

// ─── Code Block (for raw output drill-down) ─────────────────────────────────

function MiniCodeBlock({ content, maxHeight }: MiniCodeBlockProps) {
  const [copied, setCopied] = useState<boolean>(false);
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);

  return (
    <div style={{ position: "relative", marginTop: 8 }}>
      <button
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          padding: "2px 6px",
          fontSize: 9,
          border: "1px solid #444",
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
          padding: 10,
          borderRadius: 4,
          fontSize: 10,
          lineHeight: 1.5,
          overflow: "auto",
          maxHeight: maxHeight || 300,
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

// ─── Single stage card ──────────────────────────────────────────────────────

function StageCard({ config, activeData, doneData, traceEvent, pendingTraceEvent, isActive, isDone, isPending, isFailed, errorMessage, errorDetail }: StageCardProps) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [drillTab, setDrillTab] = useState<string>("overview");
  const [detailsOpen, setDetailsOpen] = useState<boolean>(false);
  const elapsedSec = useElapsed(isActive || isFailed, isFailed);
  const data: ProgressEvent | undefined = doneData || activeData;
  const stats: ProgressStats | undefined = data?.stats;
  const prevPendingRef = useRef<TraceEvent | null | undefined>(null);
  const prevFailedRef = useRef<boolean>(false);

  // Use completed trace if available, otherwise use pending (pre-call) trace
  const activeTrace: TraceEvent | undefined = traceEvent || pendingTraceEvent;

  // Auto-expand when pre-call trace arrives (LLM call starts)
  useEffect(() => {
    if (pendingTraceEvent && !prevPendingRef.current && isActive) {
      setExpanded(true);
      setDrillTab("system");
    }
    prevPendingRef.current = pendingTraceEvent;
  }, [pendingTraceEvent, isActive]);

  // Auto-expand and show raw output when stage fails
  useEffect(() => {
    if (isFailed && !prevFailedRef.current) {
      setExpanded(true);
      // Show raw output tab if trace data is available, otherwise show overview
      setDrillTab(activeTrace ? "raw" : "overview");
    }
    prevFailedRef.current = isFailed;
  }, [isFailed, activeTrace]);

  return (
    <div
      style={{
        border: `1px solid ${isFailed ? COLORS.red + "60" : isDone ? config.color + "40" : isActive ? config.color + "60" : COLORS.border}`,
        borderLeft: `3px solid ${isFailed ? COLORS.red : isDone ? config.color : isActive ? config.color : COLORS.border}`,
        borderRadius: 6,
        background: isFailed ? COLORS.red + "06" : isActive ? config.color + "06" : isDone ? "#fff" : "#fafafa",
        opacity: isPending ? 0.4 : 1,
        transition: "all 0.3s",
        overflow: "hidden",
      }}
    >
      {/* Header — always visible, clickable when done */}
      <button
        onClick={() => (isDone || isActive || isFailed) && setExpanded(!expanded)}
        disabled={isPending}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: isPending ? "default" : "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        {/* Status indicator */}
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            background: isFailed
              ? COLORS.red
              : isDone
              ? config.color
              : isActive
              ? config.color + "20"
              : COLORS.border,
            color: isFailed ? "#fff" : isDone ? "#fff" : isActive ? config.color : COLORS.textMuted,
            fontSize: isDone || isFailed ? 11 : 10,
            fontWeight: 800,
            border: isActive && !isFailed ? `2px solid ${config.color}` : "none",
          }}
        >
          {isFailed ? "\u2717" : isDone ? "\u2713" : config.icon}
        </div>

        {/* Title + message */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: isFailed ? COLORS.red : isDone || isActive ? COLORS.text : COLORS.textMuted,
              }}
            >
              {isFailed ? `${config.label} — Failed` : isDone ? config.doneLabel : config.label}
            </span>
            {isActive && !isFailed && <PulsingDot color={config.color} />}
          </div>
          {(data?.message || errorMessage) && (
            <div
              style={{
                fontSize: 11,
                color: isFailed ? COLORS.red : COLORS.textSecondary,
                marginTop: 2,
                whiteSpace: isFailed ? "normal" : "nowrap",
                overflow: "hidden",
                textOverflow: isFailed ? "unset" : "ellipsis",
              }}
            >
              {isFailed ? errorMessage : data!.message}
            </div>
          )}
        </div>

        {/* Right side: timer or stats */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          {(isActive || isFailed) && !isDone && (
            <span
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                fontWeight: 600,
                color: isFailed ? COLORS.red : config.color,
              }}
            >
              {elapsedSec}s
            </span>
          )}
          {isDone && stats?.durationMs && (
            <span
              style={{
                fontSize: 10,
                fontFamily: "monospace",
                color: COLORS.textMuted,
              }}
            >
              {(stats.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {isDone && stats?.inputTokens != null && (
            <span
              style={{
                fontSize: 9,
                padding: "1px 5px",
                background: COLORS.panelBg,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 3,
                fontFamily: "monospace",
                color: COLORS.textMuted,
              }}
            >
              {stats.inputTokens.toLocaleString()}+{stats.outputTokens?.toLocaleString()} tok
            </span>
          )}
          {(isDone || isActive || isFailed) && (
            <span
              style={{
                fontSize: 10,
                color: COLORS.textMuted,
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s",
              }}
            >
              &#9654;
            </span>
          )}
        </div>
      </button>

      {/* Substeps (shown when active) */}
      {isActive && activeData?.substeps && !expanded && (
        <div style={{ padding: "0 14px 10px 48px" }}>
          {activeData.substeps.map((sub, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 10,
                color: COLORS.textMuted,
                lineHeight: 1.8,
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: sub.status === "active" ? config.color : COLORS.border,
                  flexShrink: 0,
                  animation: sub.status === "active" ? "pulse 2s ease-in-out infinite" : "none",
                }}
              />
              {sub.text}
            </div>
          ))}
        </div>
      )}

      {/* Active detail line */}
      {isActive && activeData?.detail && !expanded && (
        <div
          style={{
            padding: "0 14px 10px 48px",
            fontSize: 10,
            color: COLORS.textMuted,
            fontStyle: "italic",
            lineHeight: 1.5,
          }}
        >
          {activeData.detail}
        </div>
      )}

      {/* Expanded detail panel — available when done or active */}
      {expanded && (
        <div
          style={{
            padding: "0 14px 14px",
            borderTop: `1px solid ${COLORS.border}40`,
          }}
        >
          {/* Detail text */}
          {data?.detail && (
            <div
              style={{
                fontSize: 11,
                color: COLORS.textSecondary,
                lineHeight: 1.6,
                marginTop: 8,
                marginBottom: 10,
                padding: "6px 10px",
                background: COLORS.panelBg,
                borderRadius: 4,
              }}
            >
              {data.detail}
            </div>
          )}

          {/* Evidence preview (researcher stage) */}
          {data?.evidencePreview && data.evidencePreview.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  color: COLORS.textMuted,
                  marginBottom: 4,
                }}
              >
                Sample Evidence
              </div>
              {data.evidencePreview.map((ev: EvidencePreviewItem, i: number) => (
                <div
                  key={i}
                  style={{
                    fontSize: 10,
                    padding: "4px 8px",
                    marginBottom: 2,
                    background: "#fff",
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 3,
                  }}
                >
                  <span style={{ fontWeight: 600, color: COLORS.text }}>
                    {ev.source}
                  </span>
                  <span style={{ color: COLORS.textMuted }}> ({ev.category})</span>
                  <div
                    style={{
                      color: COLORS.textSecondary,
                      fontStyle: "italic",
                      marginTop: 1,
                    }}
                  >
                    &ldquo;{ev.quote}&rdquo;
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Stats and Details — collapsible */}
          {(stats || activeTrace) && (
            <div>
              <button
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setDetailsOpen(!detailsOpen); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 0",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                    color: COLORS.textMuted,
                  }}
                >
                  Stats and Details
                </span>
                <span
                  style={{
                    fontSize: 8,
                    color: COLORS.textMuted,
                    transform: detailsOpen ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.15s",
                  }}
                >
                  &#9654;
                </span>
              </button>
              {detailsOpen && (
                <>
          {stats && (
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
                  gap: 4,
                  fontSize: 10,
                }}
              >
                {stats.model && (
                  <div style={{ padding: "3px 6px", background: COLORS.panelBg, borderRadius: 3 }}>
                    <span style={{ color: COLORS.textMuted }}>Model: </span>
                    <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{stats.model}</span>
                  </div>
                )}
                {stats.durationMs != null && (
                  <div style={{ padding: "3px 6px", background: COLORS.panelBg, borderRadius: 3 }}>
                    <span style={{ color: COLORS.textMuted }}>Duration: </span>
                    <span style={{ fontWeight: 600, fontFamily: "monospace" }}>
                      {(stats.durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                )}
                {stats.inputTokens != null && (
                  <div style={{ padding: "3px 6px", background: COLORS.panelBg, borderRadius: 3 }}>
                    <span style={{ color: COLORS.textMuted }}>In: </span>
                    <span style={{ fontWeight: 600, fontFamily: "monospace" }}>
                      {stats.inputTokens.toLocaleString()}
                    </span>
                    <span style={{ color: COLORS.textMuted }}> Out: </span>
                    <span style={{ fontWeight: 600, fontFamily: "monospace" }}>
                      {(stats.outputTokens || 0).toLocaleString()}
                    </span>
                  </div>
                )}
                {stats.evidenceCount != null && (
                  <div style={{ padding: "3px 6px", background: COLORS.panelBg, borderRadius: 3 }}>
                    <span style={{ color: COLORS.textMuted }}>Evidence: </span>
                    <span style={{ fontWeight: 600 }}>{stats.evidenceCount}</span>
                  </div>
                )}
                {stats.findingsCount != null && (
                  <div style={{ padding: "3px 6px", background: COLORS.panelBg, borderRadius: 3 }}>
                    <span style={{ color: COLORS.textMuted }}>Findings: </span>
                    <span style={{ fontWeight: 600 }}>{stats.findingsCount}</span>
                  </div>
                )}
                {stats.avgCertainty != null && (
                  <div style={{ padding: "3px 6px", background: COLORS.panelBg, borderRadius: 3 }}>
                    <span style={{ color: COLORS.textMuted }}>Avg certainty: </span>
                    <span style={{ fontWeight: 600 }}>{stats.avgCertainty}%</span>
                  </div>
                )}
                {stats.rating && (
                  <div style={{ padding: "3px 6px", background: COLORS.panelBg, borderRadius: 3 }}>
                    <span style={{ color: COLORS.textMuted }}>Rating: </span>
                    <span style={{ fontWeight: 600 }}>{stats.rating}</span>
                  </div>
                )}
                {(stats.removedCount ?? 0) > 0 && (
                  <div style={{ padding: "3px 6px", background: COLORS.red + "10", borderRadius: 3 }}>
                    <span style={{ color: COLORS.red, fontWeight: 600 }}>
                      {stats.removedCount} finding(s) removed
                    </span>
                  </div>
                )}
              </div>

              {/* Certainty buckets visualization */}
              {stats.certaintyBuckets && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ display: "flex", gap: 2, height: 12, borderRadius: 3, overflow: "hidden" }}>
                    {stats.certaintyBuckets.high > 0 && (
                      <div
                        style={{
                          flex: stats.certaintyBuckets.high,
                          background: COLORS.green,
                          position: "relative",
                        }}
                        title={`High (90%+): ${stats.certaintyBuckets.high}`}
                      />
                    )}
                    {stats.certaintyBuckets.moderate > 0 && (
                      <div
                        style={{
                          flex: stats.certaintyBuckets.moderate,
                          background: COLORS.orange,
                        }}
                        title={`Moderate (70-89%): ${stats.certaintyBuckets.moderate}`}
                      />
                    )}
                    {stats.certaintyBuckets.mixed > 0 && (
                      <div
                        style={{
                          flex: stats.certaintyBuckets.mixed,
                          background: "#eab308",
                        }}
                        title={`Mixed (50-69%): ${stats.certaintyBuckets.mixed}`}
                      />
                    )}
                    {stats.certaintyBuckets.weak > 0 && (
                      <div
                        style={{
                          flex: stats.certaintyBuckets.weak,
                          background: COLORS.red,
                        }}
                        title={`Weak (<50%): ${stats.certaintyBuckets.weak}`}
                      />
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: COLORS.textMuted, marginTop: 2 }}>
                    <span style={{ color: COLORS.green }}>High: {stats.certaintyBuckets.high}</span>
                    <span style={{ color: COLORS.orange }}>Mod: {stats.certaintyBuckets.moderate}</span>
                    <span style={{ color: "#eab308" }}>Mixed: {stats.certaintyBuckets.mixed}</span>
                    <span style={{ color: COLORS.red }}>Weak: {stats.certaintyBuckets.weak}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Trace drill-down (available as soon as pre-call trace arrives) */}
          {activeTrace && (
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  color: COLORS.textMuted,
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                LLM Call Details
                {!traceEvent && (
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 600,
                      color: config.color,
                      background: config.color + "15",
                      padding: "1px 6px",
                      borderRadius: 3,
                      animation: "pulse 1.5s ease-in-out infinite",
                    }}
                  >
                    awaiting response...
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${COLORS.border}`, marginBottom: 6 }}>
                {([
                  { id: "overview", label: "Overview" },
                  { id: "system", label: "System Prompt" },
                  { id: "user", label: "User Msg" },
                  { id: "raw", label: "Raw Output", disabled: !traceEvent && !isFailed },
                  ...(isFailed && errorDetail ? [{ id: "error", label: "Error Detail" }] : []),
                ] as DrillTab[]).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); if (!tab.disabled) setDrillTab(tab.id); }}
                    style={{
                      padding: "4px 8px",
                      fontSize: 9,
                      fontWeight: drillTab === tab.id ? 700 : 500,
                      color: tab.disabled ? COLORS.border : drillTab === tab.id ? COLORS.accent : COLORS.textMuted,
                      background: drillTab === tab.id ? COLORS.panelBg : "transparent",
                      border: "none",
                      borderBottom: drillTab === tab.id ? `2px solid ${config.color}` : "2px solid transparent",
                      cursor: tab.disabled ? "default" : "pointer",
                      fontFamily: "inherit",
                      textTransform: "uppercase",
                      letterSpacing: 0.3,
                      opacity: tab.disabled ? 0.4 : 1,
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {drillTab === "overview" && (
                <div style={{ fontSize: 10, color: COLORS.textSecondary }}>
                  <div>Model: <b>{activeTrace.trace?.request?.model || "default"}</b></div>
                  <div>Max tokens: <b>{activeTrace.trace?.request?.max_tokens?.toLocaleString()}</b></div>
                  {(traceEvent || (isFailed && activeTrace.trace?.response)) ? (
                    <>
                      <div>Stop reason: <b style={{ color: (traceEvent || activeTrace).trace?.response?.stop_reason === "max_tokens" ? COLORS.red : "inherit" }}>
                        {(traceEvent || activeTrace).trace?.response?.stop_reason || "?"}
                      </b></div>
                      <div>
                        Tokens: <b>{(traceEvent || activeTrace).trace?.response?.usage?.input_tokens?.toLocaleString()}</b> in
                        / <b>{(traceEvent || activeTrace).trace?.response?.usage?.output_tokens?.toLocaleString()}</b> out
                      </div>
                      <div>Duration: <b>{(((traceEvent || activeTrace).trace?.timing?.durationMs || 0) / 1000).toFixed(1)}s</b></div>
                      {(traceEvent || activeTrace).trace?.parseWarning && (
                        <div style={{ color: COLORS.orange, marginTop: 4 }}>
                          Parse warning: {(traceEvent || activeTrace).trace!.parseWarning}
                        </div>
                      )}
                    </>
                  ) : isFailed ? (
                    <div style={{ color: COLORS.red, fontStyle: "italic", marginTop: 4 }}>
                      LLM call failed before response was received
                    </div>
                  ) : (
                    <div style={{ color: config.color, fontStyle: "italic", marginTop: 4 }}>
                      Waiting for LLM response...
                    </div>
                  )}
                  {isFailed && errorMessage && (
                    <div style={{ color: COLORS.red, marginTop: 8, padding: "6px 8px", background: COLORS.red + "08", borderRadius: 3, fontSize: 10, lineHeight: 1.5 }}>
                      <b>Error:</b> {errorMessage}
                    </div>
                  )}
                </div>
              )}
              {drillTab === "system" && (
                <MiniCodeBlock content={activeTrace.trace?.request?.system || "N/A"} maxHeight={250} />
              )}
              {drillTab === "user" && (
                <MiniCodeBlock
                  content={activeTrace.trace?.request?.messages?.[0]?.content || "N/A"}
                  maxHeight={250}
                />
              )}
              {drillTab === "raw" && (
                traceEvent
                  ? <MiniCodeBlock content={traceEvent.trace?.response?.raw || traceEvent.rawOutput || "N/A"} maxHeight={400} />
                  : isFailed && activeTrace?.rawOutput
                  ? <MiniCodeBlock content={activeTrace.rawOutput} maxHeight={400} />
                  : <div style={{ fontSize: 10, color: config.color, fontStyle: "italic", padding: "10px 0" }}>
                      Response not yet available — LLM call in progress...
                    </div>
              )}
              {drillTab === "error" && errorDetail && (
                <MiniCodeBlock content={errorDetail} maxHeight={400} />
              )}
            </div>
          )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ProgressStream({ steps, traceData, error }: ProgressStreamProps) {
  const latest: ProgressEvent | undefined = steps[steps.length - 1];
  const percent: number = latest?.percent || 0;

  // Build lookup maps
  const stageMap: Record<string, ProgressEvent> = {};
  steps.forEach((s) => { stageMap[s.stage] = s; });

  // Separate completed/error traces from pending (pre-call) traces
  const traceMap: Record<string, TraceEvent> = {};
  const pendingTraceMap: Record<string, TraceEvent> = {};
  (traceData || []).forEach((t) => {
    if (t.status === "pending") {
      pendingTraceMap[t.stage] = t;
    } else {
      traceMap[t.stage] = t;
    }
  });

  // Map STAGE_CONFIG keys to trace stage names
  const traceKeyMap: Record<string, string> = {
    classifying: "classifier",
    drafting_answer: "draft_answer",
    researching: "researcher",
    synthesizing: "synthesizer",
    verifying: "verifier",
  };

  // Map error stage back to STAGE_CONFIG key
  const failedStageKey: string | null = error?.detail?.stage
    ? Object.entries(traceKeyMap).find(([, v]) => v === error.detail!.stage)?.[0] ?? null
    : null;

  return (
    <div style={{ marginTop: 32, width: "100%", maxWidth: 560 }}>
      {/* CSS animation for pulsing dot */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>

      {/* Progress bar */}
      <div
        style={{
          height: 3,
          background: COLORS.border,
          borderRadius: 2,
          overflow: "hidden",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${percent}%`,
            background: `linear-gradient(90deg, #6366f1, #0891b2, #059669, #d97706)`,
            backgroundSize: "400% 100%",
            borderRadius: 2,
            transition: "width 0.5s ease",
          }}
        />
      </div>

      {/* Stage cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {STAGE_CONFIG.map((config) => {
          const isDone: boolean = !!stageMap[config.doneKey];
          const isFailed: boolean = config.key === failedStageKey;
          const isActive: boolean = !!stageMap[config.key] && !isDone && !isFailed;
          const isPending: boolean = !stageMap[config.key] && !isFailed;
          const traceStage: string = traceKeyMap[config.key];
          const traceEvent: TraceEvent | undefined = traceMap[traceStage];
          const pendingTraceEvent: TraceEvent | undefined = pendingTraceMap[traceStage];

          return (
            <StageCard
              key={config.key}
              config={config}
              activeData={stageMap[config.key]}
              doneData={stageMap[config.doneKey]}
              traceEvent={traceEvent}
              pendingTraceEvent={pendingTraceEvent}
              isActive={isActive}
              isDone={isDone}
              isPending={isPending}
              isFailed={isFailed}
              errorMessage={isFailed ? (error?.message || error?.detail?.message || "Unknown error") : null}
              errorDetail={isFailed ? error?.detail : null}
            />
          );
        })}
      </div>

      {/* Total elapsed (shown at bottom while running) */}
      {latest && !stageMap.verified && (
        <div
          style={{
            textAlign: "center",
            marginTop: 16,
            fontSize: 11,
            color: COLORS.textMuted,
          }}
        >
          {latest.message}
        </div>
      )}
    </div>
  );
}
