import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  Report as ReportData,
  Finding,
  Section,
  ContentItem,
  TraceEvent,
  KeyStat,
} from "../../shared/types";
import ReportDetails from "./ReportDetails";
import { COLORS, getCertaintyColor } from "./shared/certainty-utils";
import { useIsMobile } from "./shared/useIsMobile";
import CertaintyBadge from "./shared/CertaintyBadge";
import ExplanationPanel from "./shared/ExplanationPanel";

// ─── Sub-components ────────────────────────────────────────────────────────────

interface FindingSpanProps {
  finding: Finding;
  isActive: boolean;
  onActivate: (id: string) => void;
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

// ─── Prop Interfaces ────────────────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "error";

interface ReportProps {
  data: ReportData;
  traceData: TraceEvent[];
  onBack: () => void;
  slug?: string | null;
  saveState?: SaveState;
}

// ─── Main Report Component ─────────────────────────────────────────────────────

export default function Report({ data, traceData, onBack, slug, saveState }: ReportProps) {
  const [activeId, setActiveId] = useState<string>("overview");
  const [showPanel, setShowPanel] = useState<boolean>(false); // for mobile panel toggle
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

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
            {/* Save status + copy link */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginLeft: "auto",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {saveState === "saving" && (
                <span style={{ color: COLORS.textMuted }}>Autosaving...</span>
              )}
              {saveState === "saved" && slug && (
                <>
                  <span style={{ color: COLORS.green }}>Saved</span>
                  <button
                    onClick={() => {
                      const fullUrl = window.location.origin + `/reports/${slug}`;
                      navigator.clipboard.writeText(fullUrl).catch(() => {});
                    }}
                    aria-label="Copy report link"
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
                </>
              )}
              {saveState === "error" && (
                <span style={{ color: COLORS.red }}>Save failed</span>
              )}
            </span>
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
