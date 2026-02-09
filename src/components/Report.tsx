import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  Report as ReportData,
  Finding,
  Section,
  ContentItem,
  EvidenceItem,
  TraceEvent,
  KeyStat,
  MethodologyData,
  Explanation,
} from "../../shared/types";
import ReportDetails from "./ReportDetails";

// ─── Styles ────────────────────────────────────────────────────────────────────

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
} as const;

function getCertaintyColor(c: number): string {
  if (c > 90) return COLORS.green;
  if (c >= 50) return COLORS.orange;
  return COLORS.red;
}

function getCertaintyLabel(c: number): string {
  if (c > 90) return "High";
  if (c >= 75) return "Moderate-High";
  if (c >= 50) return "Moderate";
  return "Low";
}

// ─── Prop Interfaces ────────────────────────────────────────────────────────────

interface CertaintyBadgeProps {
  value: number;
  large?: boolean;
}

interface FindingSpanProps {
  finding: Finding;
  isActive: boolean;
  onActivate: (id: string) => void;
}

interface EvidenceSectionProps {
  title: string;
  items: EvidenceItem[] | undefined;
  color: string;
}

interface FeedbackWidgetProps {
  findingId: string;
}

interface ExplanationPanelProps {
  activeData: Finding | { explanation: Partial<Explanation> } | null;
  isOverview: boolean;
  findingIndex: number;
  total: number;
  onNavigate: (dir: number) => void;
  overallCertainty: number;
  findingsCount: number;
  overviewData: MethodologyData | undefined;
}

interface ReportProps {
  data: ReportData;
  traceData: TraceEvent[];
  onBack: () => void;
  publishedSlug?: string | null;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function CertaintyBadge({ value, large }: CertaintyBadgeProps) {
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

function FindingSpan({ finding, isActive, onActivate }: FindingSpanProps) {
  const [hovered, setHovered] = useState(false);
  const color = getCertaintyColor(finding.certainty ?? 50);
  const active = isActive || hovered;

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Finding: ${finding.text}. Certainty ${finding.certainty}%. Click for explanation.`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onActivate(finding.id)}
      onKeyDown={(e: ReactKeyboardEvent<HTMLSpanElement>) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(finding.id); } }}
      style={{
        cursor: "pointer",
        position: "relative",
        borderBottom: `2px solid ${active ? color : color + "40"}`,
        paddingBottom: 1,
        transition: "all 0.2s ease",
        backgroundColor: active ? color + "08" : "transparent",
        borderRadius: active ? 2 : 0,
      }}
    >
      {finding.text}
      {active && (
        <span
          style={{
            position: "absolute",
            bottom: -4,
            left: "50%",
            transform: "translateX(-50%)",
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: color,
          }}
        />
      )}
    </span>
  );
}

function EvidenceSection({ title, items, color }: EvidenceSectionProps) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color,
          marginBottom: 6,
        }}
      >
        {title} ({items.length})
      </div>
      {items.map((ev: EvidenceItem, i: number) => (
        <div
          key={i}
          style={{
            padding: "8px 10px",
            marginBottom: 6,
            background: color + "06",
            border: `1px solid ${color}18`,
            borderRadius: 4,
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 600, color: COLORS.text, marginBottom: 2, fontSize: 11 }}>
            {ev.source}
          </div>
          <div style={{ color: COLORS.textSecondary, fontStyle: "italic" }}>
            &ldquo;{ev.quote}&rdquo;
          </div>
          {ev.url &&
            ev.url !== "general" &&
            ev.url !== "various" &&
            ev.url !== "derived" &&
            ev.url !== "internal" && (
              <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 3 }}>
                Source:{" "}
                {ev.url.startsWith("http") ? (
                  <a
                    href={ev.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: COLORS.textMuted, textDecoration: "underline" }}
                  >
                    {(() => {
                      try {
                        const u = new URL(ev.url);
                        return u.hostname.replace(/^www\./, "");
                      } catch {
                        return ev.url;
                      }
                    })()}
                  </a>
                ) : (
                  ev.url
                )}
              </div>
            )}
        </div>
      ))}
    </div>
  );
}

function FeedbackWidget({ findingId }: FeedbackWidgetProps) {
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

function ExplanationPanel({ activeData, isOverview, findingIndex, total, onNavigate, overallCertainty, findingsCount, overviewData }: ExplanationPanelProps) {
  if (!activeData) return null;

  const certainty = isOverview ? overallCertainty : (activeData as Finding).certainty;
  const expl = activeData.explanation;
  const id = isOverview ? "overview" : (activeData as Finding).id;

  return (
    <div
      role="complementary"
      aria-label="Explanation panel"
      style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "inherit" }}
    >
      <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1.2,
            color: COLORS.textMuted,
            marginBottom: 8,
          }}
        >
          Explanation
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button
            aria-label="Previous finding"
            onClick={() => onNavigate(-1)}
            style={{
              border: `1px solid ${COLORS.border}`,
              background: "#fff",
              borderRadius: 4,
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: 14,
              color: COLORS.text,
            }}
          >
            ←
          </button>
          <span style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 500 }}>
            {isOverview ? "Overview" : `${findingIndex + 1} of ${total}`}
          </span>
          <button
            aria-label="Next finding"
            onClick={() => onNavigate(1)}
            style={{
              border: `1px solid ${COLORS.border}`,
              background: "#fff",
              borderRadius: 4,
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: 14,
              color: COLORS.text,
            }}
          >
            →
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, margin: "0 0 10px", lineHeight: 1.3 }}>
          {isOverview
            ? (overviewData?.explanation?.title || "Report Methodology")
            : (expl?.title || "Explanation")}
        </h3>
        <div style={{ marginBottom: 12 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              color: COLORS.textMuted,
              marginRight: 8,
            }}
          >
            Certainty
          </span>
          <CertaintyBadge value={certainty || 50} />
        </div>

        {isOverview && (
          <>
            <p style={{ fontSize: 13, lineHeight: 1.75, color: COLORS.textSecondary, margin: "0 0 4px", whiteSpace: "pre-wrap" }}>
              {overviewData?.explanation?.text || `This report was generated by DoublyAI using a multi-agent pipeline: Research Agent gathered evidence, Synthesis Agent drafted findings, and Verification Agent adversarially reviewed each claim. The overall certainty of ${overallCertainty}% is the arithmetic mean of all ${findingsCount} finding scores. Scores above 90% require 3+ corroborating sources and 0 contradictions. Scores below 25% result in finding removal.`}
            </p>
            <EvidenceSection title="Supporting Evidence" items={overviewData?.explanation?.supportingEvidence} color={COLORS.green} />
            <EvidenceSection title="Contrary Evidence" items={overviewData?.explanation?.contraryEvidence} color={COLORS.red} />
          </>
        )}

        {!isOverview && (
          <>
            <div
              style={{
                background: getCertaintyColor(certainty ?? 50) + "08",
                border: `1px solid ${getCertaintyColor(certainty ?? 50)}20`,
                borderRadius: 4,
                padding: "6px 10px",
                marginBottom: 14,
                fontSize: 12,
                color: COLORS.textSecondary,
                fontStyle: "italic",
                lineHeight: 1.5,
              }}
            >
              Finding: &ldquo;{(activeData as Finding).text}&rdquo;
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.75, color: COLORS.textSecondary, margin: "0 0 4px", whiteSpace: "pre-wrap" }}>
              {expl?.text}
            </p>
            <EvidenceSection title="Supporting Evidence" items={expl?.supportingEvidence} color={COLORS.green} />
            <EvidenceSection title="Contrary Evidence" items={expl?.contraryEvidence} color={COLORS.red} />
          </>
        )}

        <FeedbackWidget findingId={id} key={id} />
      </div>
    </div>
  );
}

// ─── Section title prettifier ──────────────────────────────────────────────────

const SECTION_TITLES: Record<string, string> = {
  investment_thesis: "Investment Thesis",
  thesis: "Investment Thesis",
  recent_price_action: "Recent Price Action",
  price: "Recent Price Action",
  financial_performance: "Financial Performance",
  financials: "Financial Performance",
  product_and_technology: "Product & Technology Roadmap",
  product: "Product & Technology Roadmap",
  competitive_landscape: "Competitive Landscape",
  competition: "Competitive Landscape",
  industry_and_macro: "Industry & Macro Outlook",
  macro: "Industry & Macro Outlook",
  key_risks: "Key Risks",
  risks: "Key Risks",
  analyst_consensus: "Analyst Consensus",
  consensus: "Analyst Consensus",
};

// ─── Mobile breakpoint ─────────────────────────────────────────────────────────

const MOBILE_BREAKPOINT = 768;

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// ─── Main Report Component ─────────────────────────────────────────────────────

export default function Report({ data, traceData, onBack, publishedSlug }: ReportProps) {
  const [activeId, setActiveId] = useState<string>("overview");
  const [showPanel, setShowPanel] = useState<boolean>(false); // for mobile panel toggle
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [publishState, setPublishState] = useState<"idle" | "publishing" | "done" | "error">(publishedSlug ? "done" : "idle");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(publishedSlug ? `/reports/${publishedSlug}` : null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const handlePublish = async () => {
    setPublishState("publishing");
    setPublishError(null);
    try {
      const res = await fetch("/api/reports/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: data, slug: publishedSlug || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error: ${res.status}`);
      }
      const result = await res.json();
      setPublishedUrl(result.url);
      setPublishState("done");
    } catch (thrown: unknown) {
      const err = thrown instanceof Error ? thrown : new Error(String(thrown));
      setPublishError(err.message);
      setPublishState("error");
    }
  };

  const { meta, sections, findings } = data;

  // Guard: empty findings
  const safeFindings = useMemo<Finding[]>(() => Array.isArray(findings) ? findings : [], [findings]);
  const safeSections = useMemo<Section[]>(() => Array.isArray(sections) ? sections : [], [sections]);

  // Build a lookup map
  const findingsMap = useMemo<Record<string, Finding>>(() => {
    const map: Record<string, Finding> = {};
    safeFindings.forEach((f) => { map[f.id] = f; });
    return map;
  }, [safeFindings]);

  const overallCertainty = useMemo<number>(() => meta?.overallCertainty || (
    safeFindings.length > 0
      ? Math.round(safeFindings.reduce((s, f) => s + (f.certainty || 50), 0) / safeFindings.length)
      : 0
  ), [meta?.overallCertainty, safeFindings]);

  const isOverview = activeId === "overview";
  const activeFinding: Finding | null = isOverview ? null : findingsMap[activeId] || null;
  const activeIndex: number = isOverview ? -1 : safeFindings.findIndex((f) => f.id === activeId);

  // Update browser tab title
  useEffect(() => {
    const prevTitle = document.title;
    document.title = meta?.title ? `${meta.title} — DoublyAI` : "DoublyAI Report";
    return () => { document.title = prevTitle; };
  }, [meta?.title]);

  // On mobile, show panel when a finding is activated
  const handleActivate = useCallback((id: string) => {
    setActiveId(id);
    if (isMobile) setShowPanel(true);
  }, [isMobile]);

  const navigate = useCallback(
    (dir: number) => {
      if (isOverview) {
        if (dir > 0 && safeFindings.length > 0) setActiveId(safeFindings[0].id);
        return;
      }
      const idx = safeFindings.findIndex((f) => f.id === activeId);
      const next = idx + dir;
      if (next < 0) setActiveId("overview");
      else if (next < safeFindings.length) setActiveId(safeFindings[next].id);
    },
    [activeId, isOverview, safeFindings]
  );

  // Keyboard navigation — skip when a textarea/input is focused
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "textarea" || tag === "input" || tag === "select") return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); navigate(1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); navigate(-1); }
      else if (e.key === "Escape") {
        if (isMobile && showPanel) setShowPanel(false);
        else setActiveId("overview");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, isMobile, showPanel]);

  const overallColor = getCertaintyColor(overallCertainty);
  const keyStats: KeyStat[] = meta?.keyStats || [];

  // Filter sections that have at least one valid finding
  const visibleSections = useMemo<Section[]>(() => safeSections.filter((s) =>
    (s.content || []).some((item) => item.type === "finding" && findingsMap[(item as { id: string }).id])
  ), [safeSections, findingsMap]);

  // Render a content block (finding or text)
  const renderContent = (item: ContentItem, i: number): ReactNode => {
    if (item.type === "finding") {
      const f = findingsMap[item.id];
      if (!f) return null;
      return <FindingSpan key={item.id} finding={f} isActive={activeId === item.id} onActivate={handleActivate} />;
    }
    if (item.type === "text") {
      return <span key={`t-${i}`}>{item.value}</span>;
    }
    return null;
  };

  // Split a section's content array into paragraphs on { type: "break" } nodes
  const splitIntoParagraphs = (content: ContentItem[] | undefined): ContentItem[][] => {
    const paragraphs: ContentItem[][] = [];
    let current: ContentItem[] = [];
    for (const item of content || []) {
      if (item.type === "break") {
        if (current.length > 0) { paragraphs.push(current); current = []; }
      } else {
        current.push(item);
      }
    }
    if (current.length > 0) paragraphs.push(current);
    return paragraphs;
  };

  // ─── Mobile Panel Overlay ──────────────────────────────────────────────────
  const panelContent = (
    <ExplanationPanel
      activeData={isOverview ? { explanation: {} } : activeFinding}
      isOverview={isOverview}
      findingIndex={activeIndex}
      total={safeFindings.length}
      onNavigate={navigate}
      overallCertainty={overallCertainty}
      findingsCount={safeFindings.length}
      overviewData={meta?.methodology}
    />
  );

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        fontFamily: "'Inter', 'Helvetica Neue', system-ui, sans-serif",
        background: COLORS.bg,
        color: COLORS.text,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── Report Panel ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 780, margin: "0 auto", padding: isMobile ? "20px 16px 60px" : "32px 40px 60px" }}>
          {/* Top buttons */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            {publishedSlug && (
              <button
                onClick={onBack}
                style={{
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 4,
                  background: COLORS.cardBg,
                  cursor: "pointer",
                  color: COLORS.text,
                }}
              >
                ← Back
              </button>
            )}
            {traceData && traceData.length > 0 && (
              <button
                onClick={() => setShowDetails(true)}
                aria-label="View report generation details"
                style={{
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${COLORS.accent}40`,
                  borderRadius: 4,
                  background: COLORS.accent + "08",
                  color: COLORS.accent,
                  cursor: "pointer",
                }}
              >
                Report Details
              </button>
            )}
            {publishState === "idle" && (
              <button
                onClick={handlePublish}
                aria-label="Publish report"
                style={{
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${COLORS.green}40`,
                  borderRadius: 4,
                  background: COLORS.green + "0d",
                  color: COLORS.green,
                  cursor: "pointer",
                  marginLeft: "auto",
                }}
              >
                Publish
              </button>
            )}
            {publishState === "publishing" && (
              <span
                style={{
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 500,
                  color: COLORS.textMuted,
                  marginLeft: "auto",
                }}
              >
                Publishing...
              </span>
            )}
            {publishState === "done" && publishedUrl && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 500,
                  color: COLORS.green,
                  background: COLORS.green + "0d",
                  border: `1px solid ${COLORS.green}30`,
                  borderRadius: 4,
                  marginLeft: "auto",
                }}
              >
                Published
                <button
                  onClick={() => {
                    const fullUrl = window.location.origin + publishedUrl;
                    navigator.clipboard.writeText(fullUrl).catch(() => {});
                  }}
                  aria-label="Copy published report link"
                  style={{
                    border: `1px solid ${COLORS.green}40`,
                    background: "#fff",
                    borderRadius: 3,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: COLORS.green,
                    cursor: "pointer",
                  }}
                >
                  Copy Link
                </button>
              </span>
            )}
            {publishState === "error" && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: COLORS.red,
                  marginLeft: "auto",
                }}
              >
                {publishError || "Publish failed"}
                <button
                  onClick={handlePublish}
                  style={{
                    border: `1px solid ${COLORS.red}40`,
                    background: "#fff",
                    borderRadius: 3,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: COLORS.red,
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
              </span>
            )}
          </div>

          {/* Overall Certainty Banner */}
          <div
            onClick={() => handleActivate("overview")}
            onMouseEnter={() => !isMobile && setActiveId("overview")}
            role="button"
            tabIndex={0}
            aria-label={`Overall report certainty: ${overallCertainty}%. Click for methodology.`}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter") handleActivate("overview"); }}
            style={{
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              marginBottom: 16,
              background: isOverview ? overallColor + "0a" : COLORS.panelBg,
              border: `1.5px solid ${isOverview ? overallColor + "40" : COLORS.border}`,
              borderRadius: 4,
              transition: "all 0.2s",
              position: "relative",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 1.5,
                  color: COLORS.textMuted,
                }}
              >
                AI-Generated Equity Research
              </span>
              <CertaintyBadge value={overallCertainty} large />
            </div>
            <span style={{ fontSize: 11, color: COLORS.textMuted, fontStyle: "italic" }}>
              {isMobile ? "Tap for methodology" : "Click for methodology"} →
            </span>
            {isOverview && !isMobile && (
              <span
                style={{
                  position: "absolute",
                  bottom: -4,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: overallColor,
                }}
              />
            )}
          </div>

          {/* Masthead */}
          <div style={{ borderBottom: `3px solid ${COLORS.accent}`, paddingBottom: 16, marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 2,
                    color: COLORS.textMuted,
                    marginBottom: 4,
                  }}
                >
                  {meta?.subtitle || "Equity Research"}
                </div>
                <h1 style={{ fontSize: isMobile ? 20 : 26, fontWeight: 800, margin: "0 0 2px", letterSpacing: -0.5, color: COLORS.accent }}>
                  {meta?.title || "Research Report"}
                </h1>
                <div style={{ fontSize: 13, color: COLORS.textSecondary }}>
                  {meta?.exchange}: {meta?.ticker} · {meta?.sector}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    color: COLORS.textMuted,
                    marginBottom: 4,
                  }}
                >
                  {meta?.date}
                </div>
                {meta?.rating && (
                  <div
                    style={{
                      display: "inline-block",
                      background: COLORS.accent,
                      color: "#fff",
                      padding: "3px 12px",
                      borderRadius: 3,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                    }}
                  >
                    {meta.rating}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Key Stats Bar */}
          {keyStats.length > 0 && (
            <div
              style={{
                display: "flex",
                margin: "0 0 24px",
                borderBottom: `1px solid ${COLORS.border}`,
                flexWrap: isMobile ? "wrap" : "nowrap",
              }}
            >
              {keyStats.map((item: KeyStat, i: number) => (
                <div
                  key={i}
                  style={{
                    flex: isMobile ? "1 1 33%" : 1,
                    padding: "10px 0",
                    textAlign: "center",
                    borderRight: !isMobile && i < keyStats.length - 1 ? `1px solid ${COLORS.border}` : "none",
                    borderBottom: isMobile ? `1px solid ${COLORS.border}` : "none",
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: COLORS.textMuted,
                      marginBottom: 2,
                    }}
                  >
                    {item.label}
                  </div>
                  <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 700, color: COLORS.accent }}>{item.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Certainty Legend */}
          <div
            role="note"
            aria-label="Certainty color legend"
            style={{
              display: "flex",
              gap: isMobile ? 10 : 16,
              alignItems: "center",
              marginBottom: 24,
              padding: "8px 12px",
              background: COLORS.panelBg,
              borderRadius: 4,
              border: `1px solid ${COLORS.border}`,
              fontSize: 11,
              color: COLORS.textMuted,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600 }}>Finding certainty:</span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.green, display: "inline-block" }} />
              &gt;90%
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.orange, display: "inline-block" }} />
              50–90%
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.red, display: "inline-block" }} />
              &lt;50%
            </span>
            {!isMobile && (
              <span style={{ marginLeft: "auto", fontStyle: "italic" }}>
                Hover underlined text · Arrow keys to navigate
              </span>
            )}
          </div>

          {/* ── Dynamic Sections ── */}
          {visibleSections.map((section: Section) => {
            const paragraphs = splitIntoParagraphs(section.content);
            return (
              <div key={section.id}>
                <h2
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 1.0,
                    color: COLORS.accent,
                    margin: "28px 0 14px",
                    paddingBottom: 6,
                    borderBottom: `2px solid ${COLORS.accent}`,
                  }}
                >
                  {SECTION_TITLES[section.id] || section.title || section.id}
                </h2>
                {paragraphs.map((paraItems: ContentItem[], pi: number) => (
                  <p key={pi} style={{ fontSize: 14, lineHeight: 1.85, color: COLORS.textSecondary, margin: "0 0 14px" }}>
                    {paraItems.map((item: ContentItem, i: number) => renderContent(item, i))}
                  </p>
                ))}
              </div>
            );
          })}

          {/* Empty state */}
          {visibleSections.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: COLORS.textMuted }}>
              <p style={{ fontSize: 14 }}>No sections with verified findings were produced.</p>
              <p style={{ fontSize: 12 }}>Try a different query or check the pipeline logs.</p>
            </div>
          )}

          {/* Disclaimer */}
          <div
            style={{
              marginTop: 36,
              paddingTop: 16,
              borderTop: `2px solid ${COLORS.accent}`,
              fontSize: 10,
              lineHeight: 1.7,
              color: COLORS.textMuted,
            }}
          >
            <strong>Disclaimer:</strong> This report is generated by DoublyAI using AI and publicly
            available data for informational purposes only. It does not constitute investment advice.
            Certainty scores reflect data verifiability, not investment confidence. Consult a licensed
            financial advisor before making investment decisions.
          </div>
        </div>
      </div>

      {/* ── Explanation Panel (desktop: always visible, mobile: overlay) ── */}
      {isMobile ? (
        <>
          {/* Mobile floating button to show panel */}
          {!showPanel && (
            <button
              onClick={() => setShowPanel(true)}
              aria-label="Show explanation panel"
              style={{
                position: "fixed",
                bottom: 20,
                right: 20,
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: COLORS.accent,
                color: "#fff",
                border: "none",
                fontSize: 20,
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                zIndex: 100,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ?
            </button>
          )}
          {/* Mobile panel overlay */}
          {showPanel && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 200,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                onClick={() => setShowPanel(false)}
                style={{
                  flex: "0 0 15vh",
                  background: "rgba(0,0,0,0.3)",
                }}
              />
              <div
                style={{
                  flex: 1,
                  background: COLORS.cardBg,
                  borderTopLeftRadius: 12,
                  borderTopRightRadius: 12,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px 0",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 4,
                      borderRadius: 2,
                      background: COLORS.border,
                    }}
                  />
                  <button
                    onClick={() => setShowPanel(false)}
                    aria-label="Close explanation panel"
                    style={{
                      position: "absolute",
                      right: 12,
                      top: 4,
                      border: "none",
                      background: "transparent",
                      fontSize: 18,
                      color: COLORS.textMuted,
                      cursor: "pointer",
                      padding: "4px 8px",
                      borderRadius: 4,
                    }}
                  >
                    ✕
                  </button>
                </div>
                {panelContent}
              </div>
            </div>
          )}
        </>
      ) : (
        <div
          ref={panelRef}
          style={{
            flex: "0 0 32%",
            minWidth: 320,
            maxWidth: 420,
            background: COLORS.cardBg,
            borderLeft: `1px solid ${COLORS.border}`,
            display: "flex",
            flexDirection: "column",
            height: "100vh",
            overflow: "hidden",
          }}
        >
          {panelContent}
        </div>
      )}

      {/* Report Details Modal */}
      {showDetails && (
        <ReportDetails traceData={traceData} onClose={() => setShowDetails(false)} />
      )}
    </div>
  );
}
