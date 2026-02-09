import { useState, useEffect, useCallback, useMemo, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
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

// ─── Dark theme overrides for slide deck chrome ─────────────────────────────────

const DARK = {
  bg: "#0f0f1a",
  cardBg: "#1a1a2e",
  slideBg: "#ffffff",
  textLight: "#ffffff",
  border: "#2a2a40",
  accentBlue: "#3b82f6",
} as const;

// ─── Slide title prettifier ──────────────────────────────────────────────────

const SLIDE_TITLES: Record<string, string> = {
  title_slide: "Title",
  problem: "The Problem",
  solution: "The Solution",
  market_opportunity: "Market Opportunity",
  business_model: "Business Model",
  traction: "Traction & Metrics",
  competitive_landscape: "Competitive Landscape",
  team: "The Team",
  financials: "Financial Projections",
  the_ask: "The Ask",
  // Equity research sections used in slide format
  investment_thesis: "Investment Thesis",
  recent_price_action: "Price Action",
  financial_performance: "Financial Performance",
  product_and_technology: "Product & Technology",
  industry_and_macro: "Industry & Macro",
  key_risks: "Key Risks",
  analyst_consensus: "Analyst Consensus",
};

// ─── Slide-specific sub-component ──────────────────────────────────────────────

function FindingBullet({ finding, isActive, onActivate }: { finding: Finding; isActive: boolean; onActivate: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const color = getCertaintyColor(finding.certainty ?? 50);
  const active = isActive || hovered;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Finding: ${finding.text}. Certainty ${finding.certainty}%. Click for explanation.`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onActivate(finding.id)}
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(finding.id); } }}
      style={{
        cursor: "pointer",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 6,
        background: active ? color + "08" : "transparent",
        border: `1.5px solid ${active ? color + "40" : "transparent"}`,
        transition: "all 0.2s ease",
        marginBottom: 4,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          marginTop: 6,
        }}
      />
      <span style={{ fontSize: 14, lineHeight: 1.6, color: COLORS.text }}>{finding.text}</span>
    </div>
  );
}

// ─── Main SlideDeck Component ───────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "error";

interface SlideDeckProps {
  data: ReportData;
  traceData: TraceEvent[];
  onBack: () => void;
  slug?: string | null;
  saveState?: SaveState;
}

export default function SlideDeck({ data, traceData, onBack, slug, saveState }: SlideDeckProps) {
  const [activeId, setActiveId] = useState<string>("overview");
  const [currentSlide, setCurrentSlide] = useState<number>(0);
  const [showPanel, setShowPanel] = useState<boolean>(false);
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const isMobile = useIsMobile();

  const { meta, sections, findings } = data;

  const safeFindings = useMemo<Finding[]>(() => Array.isArray(findings) ? findings : [], [findings]);
  const safeSections = useMemo<Section[]>(() => Array.isArray(sections) ? sections : [], [sections]);

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
    document.title = meta?.title ? `${meta.title} — DoublyAI` : "DoublyAI Slide Deck";
    return () => { document.title = prevTitle; };
  }, [meta?.title]);

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

  const navigateSlide = useCallback((dir: number) => {
    setCurrentSlide((prev) => {
      const next = prev + dir;
      if (next < 0) return 0;
      if (next >= safeSections.length) return safeSections.length - 1;
      return next;
    });
  }, [safeSections.length]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "textarea" || tag === "input" || tag === "select") return;

      if (e.key === "ArrowRight") { e.preventDefault(); navigateSlide(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); navigateSlide(-1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); navigate(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); navigate(-1); }
      else if (e.key === "Escape") {
        if (isMobile && showPanel) setShowPanel(false);
        else setActiveId("overview");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, navigateSlide, isMobile, showPanel]);

  const keyStats: KeyStat[] = meta?.keyStats || [];
  const currentSection = safeSections[currentSlide];

  // Render slide content
  const renderSlideContent = (section: Section): ReactNode => {
    if (!section) return null;
    const isTitle = section.layout === "title" || section.id === "title_slide";

    if (isTitle) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", padding: "40px 60px" }}>
          <h1 style={{ fontSize: isMobile ? 28 : 40, fontWeight: 800, color: COLORS.accent, margin: "0 0 12px", letterSpacing: -1 }}>
            {meta?.title || section.title}
          </h1>
          {(section.subtitle || meta?.tagline) && (
            <p style={{ fontSize: isMobile ? 16 : 20, color: COLORS.textSecondary, margin: "0 0 20px", fontWeight: 500 }}>
              {section.subtitle || meta?.tagline}
            </p>
          )}
          {meta?.companyDescription && (
            <p style={{ fontSize: 14, color: COLORS.textMuted, maxWidth: 500, lineHeight: 1.7, margin: "0 0 24px" }}>
              {meta.companyDescription}
            </p>
          )}
          {keyStats.length > 0 && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center", marginTop: 12 }}>
              {keyStats.slice(0, 4).map((stat, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: COLORS.textMuted, marginBottom: 2 }}>
                    {stat.label}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.accent }}>{stat.value}</div>
                </div>
              ))}
            </div>
          )}
          {(section.content || []).filter((item) => item.type === "text").map((item, i) => (
            <p key={i} style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 12, maxWidth: 500, lineHeight: 1.6 }}>
              {(item as { value: string }).value}
            </p>
          ))}
        </div>
      );
    }

    // Content/bullets/stats slides
    return (
      <div style={{ padding: isMobile ? "24px 20px" : "32px 40px", height: "100%", display: "flex", flexDirection: "column" }}>
        <h2 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, color: COLORS.accent, margin: "0 0 24px", letterSpacing: -0.5 }}>
          {SLIDE_TITLES[section.id] || section.title || section.id}
        </h2>
        {section.subtitle && (
          <p style={{ fontSize: 14, color: COLORS.textMuted, margin: "-16px 0 20px", fontWeight: 500 }}>
            {section.subtitle}
          </p>
        )}
        <div style={{ flex: 1 }}>
          {(section.content || []).map((item: ContentItem, i: number) => {
            if (item.type === "finding") {
              const f = findingsMap[item.id];
              if (!f) return null;
              return <FindingBullet key={item.id} finding={f} isActive={activeId === item.id} onActivate={handleActivate} />;
            }
            if (item.type === "text" && item.value.trim()) {
              return (
                <p key={`t-${i}`} style={{ fontSize: 13, color: COLORS.textMuted, margin: "4px 0 4px 18px", lineHeight: 1.6 }}>
                  {item.value}
                </p>
              );
            }
            if (item.type === "break") {
              return <div key={`b-${i}`} style={{ height: 8 }} />;
            }
            return null;
          })}
        </div>
      </div>
    );
  };

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
      overviewTitle="Deck Methodology"
      overviewFallbackText={`This deck was generated by DoublyAI using a multi-agent pipeline: Research Agent gathered evidence, Synthesis Agent drafted findings, and Verification Agent adversarially reviewed each claim. The overall certainty of ${overallCertainty}% is the arithmetic mean of all ${safeFindings.length} finding scores.`}
    />
  );

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        fontFamily: "'Inter', 'Helvetica Neue', system-ui, sans-serif",
        background: DARK.bg,
        color: DARK.textLight,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── Slide Area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", flexWrap: "wrap" }}>
          <button
            onClick={onBack}
            aria-label="Start new report"
            style={{
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 500,
              border: `1px solid ${DARK.border}`,
              borderRadius: 4,
              background: "transparent",
              color: COLORS.textMuted,
              cursor: "pointer",
            }}
          >
            ← New
          </button>

          {/* Overall certainty */}
          <div
            onClick={() => handleActivate("overview")}
            role="button"
            tabIndex={0}
            aria-label={`Overall certainty: ${overallCertainty}%. Click for methodology.`}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter") handleActivate("overview"); }}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: COLORS.textMuted }}>
              AI-Generated
            </span>
            <CertaintyBadge value={overallCertainty} />
          </div>

          <div style={{ flex: 1 }} />

          {traceData && traceData.length > 0 && (
            <button
              onClick={() => setShowDetails(true)}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 600,
                border: `1px solid ${DARK.border}`,
                borderRadius: 4,
                background: "transparent",
                color: COLORS.textMuted,
                cursor: "pointer",
              }}
            >
              Details
            </button>
          )}
          {saveState === "saving" && (
            <span style={{ fontSize: 12, color: COLORS.textMuted }}>Autosaving...</span>
          )}
          {saveState === "saved" && slug && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.green }}>
              Saved
              <button
                onClick={() => { navigator.clipboard.writeText(window.location.origin + `/reports/${slug}`).catch(() => {}); }}
                style={{ border: `1px solid ${COLORS.green}40`, background: "transparent", borderRadius: 3, padding: "1px 8px", fontSize: 11, fontWeight: 600, color: COLORS.green, cursor: "pointer" }}
              >
                Copy Link
              </button>
            </span>
          )}
          {saveState === "error" && (
            <span style={{ fontSize: 12, color: COLORS.red }}>Save failed</span>
          )}
        </div>

        {/* Slide navigation thumbnails */}
        <div style={{ display: "flex", gap: 4, padding: "0 20px 12px", overflowX: "auto", flexShrink: 0 }}>
          {safeSections.map((section, i) => (
            <button
              key={section.id}
              onClick={() => setCurrentSlide(i)}
              style={{
                flexShrink: 0,
                padding: "4px 10px",
                fontSize: 10,
                fontWeight: currentSlide === i ? 700 : 500,
                border: `1px solid ${currentSlide === i ? DARK.accentBlue : DARK.border}`,
                borderRadius: 4,
                background: currentSlide === i ? DARK.accentBlue + "20" : "transparent",
                color: currentSlide === i ? DARK.accentBlue : COLORS.textMuted,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {i + 1}. {SLIDE_TITLES[section.id] || section.title || section.id}
            </button>
          ))}
        </div>

        {/* Slide content area */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? "8px 12px" : "8px 40px", overflow: "hidden" }}>
          <div
            style={{
              width: "100%",
              maxWidth: 900,
              aspectRatio: isMobile ? "auto" : "16/9",
              background: DARK.slideBg,
              borderRadius: 12,
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {currentSection && renderSlideContent(currentSection)}
          </div>
        </div>

        {/* Bottom navigation */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: "12px 20px", flexShrink: 0 }}>
          <button
            onClick={() => navigateSlide(-1)}
            disabled={currentSlide === 0}
            aria-label="Previous slide"
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: 600,
              border: `1px solid ${DARK.border}`,
              borderRadius: 4,
              background: "transparent",
              color: currentSlide === 0 ? DARK.border : COLORS.textMuted,
              cursor: currentSlide === 0 ? "not-allowed" : "pointer",
            }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 500, minWidth: 60, textAlign: "center" }}>
            {currentSlide + 1} / {safeSections.length}
          </span>
          <button
            onClick={() => navigateSlide(1)}
            disabled={currentSlide === safeSections.length - 1}
            aria-label="Next slide"
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: 600,
              border: `1px solid ${DARK.border}`,
              borderRadius: 4,
              background: "transparent",
              color: currentSlide === safeSections.length - 1 ? DARK.border : COLORS.textMuted,
              cursor: currentSlide === safeSections.length - 1 ? "not-allowed" : "pointer",
            }}
          >
            Next →
          </button>
        </div>

        {/* Speaker notes */}
        {currentSection?.speakerNotes && (
          <div style={{ padding: "0 20px 12px", flexShrink: 0 }}>
            <details>
              <summary style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: COLORS.textMuted, cursor: "pointer", marginBottom: 4 }}>
                Speaker Notes
              </summary>
              <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.6, padding: "8px 12px", background: DARK.cardBg, borderRadius: 6, border: `1px solid ${DARK.border}` }}>
                {currentSection.speakerNotes}
              </div>
            </details>
          </div>
        )}
      </div>

      {/* ── Explanation Panel (desktop: always visible, mobile: overlay) ── */}
      {isMobile ? (
        <>
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
                background: DARK.accentBlue,
                color: "#fff",
                border: "none",
                fontSize: 20,
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                zIndex: 100,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ?
            </button>
          )}
          {showPanel && (
            <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column" }}>
              <div onClick={() => setShowPanel(false)} style={{ flex: "0 0 15vh", background: "rgba(0,0,0,0.5)" }} />
              <div style={{ flex: 1, background: DARK.slideBg, borderTopLeftRadius: 12, borderTopRightRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "8px 12px 0", display: "flex", justifyContent: "center", alignItems: "center", position: "relative" }}>
                  <div style={{ width: 36, height: 4, borderRadius: 2, background: COLORS.border }} />
                  <button
                    onClick={() => setShowPanel(false)}
                    aria-label="Close"
                    style={{ position: "absolute", right: 12, top: 4, border: "none", background: "transparent", fontSize: 18, color: COLORS.textMuted, cursor: "pointer", padding: "4px 8px", borderRadius: 4 }}
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
          style={{
            flex: "0 0 32%",
            minWidth: 320,
            maxWidth: 420,
            background: DARK.slideBg,
            borderLeft: `1px solid ${DARK.border}`,
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
