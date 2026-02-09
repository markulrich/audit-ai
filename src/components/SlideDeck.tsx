import { useState, useEffect, useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  Report as ReportData,
  Finding,
  Section,
  ContentItem,
  TraceEvent,
  KeyStat,
} from "../../shared/types";
import { getCertaintyColor, getCertaintyLabel } from "./shared/certainty-utils";
import { useIsMobile } from "./shared/useIsMobile";
import CertaintyBadge from "./shared/CertaintyBadge";
import ExplanationPanel from "./shared/ExplanationPanel";
import ExportMenu from "./shared/ExportMenu";

// ─── Dark Theme Colors ──────────────────────────────────────────────────────────

const DK = {
  bg: "#0f0f1a",
  cardBg: "#1a1a2e",
  slideBg: "#ffffff",
  text: "#e8e8f0",
  textDim: "#9a9ab0",
  textSlide: "#1a1a2e",
  textSlideSecondary: "#555770",
  border: "#2a2a40",
  accent: "#6c63ff",
  green: "#22c55e",
  orange: "#f59e0b",
  red: "#ef4444",
  panelBg: "#16162a",
} as const;

// ─── Slide Title Maps ──────────────────────────────────────────────────────────

const SLIDE_TITLES: Record<string, string> = {
  // Pitch deck
  title_slide: "Title Slide",
  problem: "The Problem",
  solution: "Our Solution",
  market_opportunity: "Market Opportunity",
  business_model: "Business Model",
  traction: "Traction & Milestones",
  competitive_landscape: "Competitive Landscape",
  team: "Team",
  financials: "Financials",
  the_ask: "The Ask",
  // Equity research (when rendered as slides)
  investment_thesis: "Investment Thesis",
  recent_price_action: "Recent Price Action",
  financial_performance: "Financial Performance",
  product_and_technology: "Product & Technology",
  industry_and_macro: "Industry & Macro",
  key_risks: "Key Risks",
  analyst_consensus: "Analyst Consensus",
};

// ─── FindingBullet Subcomponent ────────────────────────────────────────────────

interface FindingBulletProps {
  finding: Finding;
  isActive: boolean;
  onActivate: (id: string) => void;
}

function FindingBullet({ finding, isActive, onActivate }: FindingBulletProps) {
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
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(finding.id); }
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        marginBottom: 8,
        background: active ? color + "0a" : "#f8f8fc",
        border: `1.5px solid ${active ? color + "40" : "#e8e8f0"}`,
        borderRadius: 6,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
          marginTop: 5,
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: DK.textSlide, fontWeight: 500 }}>
          {finding.text}
        </div>
        <div style={{ fontSize: 10, color: DK.textSlideSecondary, marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color, fontWeight: 600 }}>{finding.certainty}%</span>
          <span>{getCertaintyLabel(finding.certainty ?? 50)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Prop Interfaces ────────────────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "error";

interface SlideDeckProps {
  data: ReportData;
  traceData: TraceEvent[];
  onBack: () => void;
  slug?: string | null;
  saveState?: SaveState;
  onRetrySave?: () => void;
  onToggleView?: () => void;
}

// ─── Main SlideDeck Component ──────────────────────────────────────────────────

export default function SlideDeck({ data, traceData, onBack, slug, saveState, onRetrySave, onToggleView }: SlideDeckProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState<boolean>(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const isMobile = useIsMobile();

  const { meta, sections, findings } = data;

  const safeFindings = useMemo<Finding[]>(() => Array.isArray(findings) ? findings : [], [findings]);
  const rawSections = useMemo<Section[]>(() => Array.isArray(sections) ? sections : [], [sections]);

  // If there's no title slide, synthesize one from meta so the deck always opens with a title
  const safeSections = useMemo<Section[]>(() => {
    const hasTitle = rawSections.some((s) => s.id === "title_slide" || s.layout === "title");
    if (hasTitle || rawSections.length === 0) return rawSections;
    const syntheticTitle: Section = {
      id: "title_slide",
      title: meta?.title || "Slide Deck",
      layout: "title",
      content: meta?.tagline ? [{ type: "text" as const, value: meta.tagline }] : [],
    };
    return [syntheticTitle, ...rawSections];
  }, [rawSections, meta?.title, meta?.tagline]);

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
  const activeFinding: Finding | null = (!activeId || isOverview) ? null : findingsMap[activeId] || null;
  const activeIndex: number = (!activeId || isOverview) ? -1 : safeFindings.findIndex((f) => f.id === activeId);

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
      if (!activeId) return;
      const idx = safeFindings.findIndex((f) => f.id === activeId);
      const next = idx + dir;
      if (next < 0) setActiveId("overview");
      else if (next < safeFindings.length) setActiveId(safeFindings[next].id);
    },
    [activeId, isOverview, safeFindings]
  );

  const goToSlide = useCallback((index: number) => {
    if (index >= 0 && index < safeSections.length) setCurrentSlide(index);
  }, [safeSections.length]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "textarea" || tag === "input" || tag === "select") return;

      if (e.key === "ArrowRight") { e.preventDefault(); goToSlide(currentSlide + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goToSlide(currentSlide - 1); }
      else if (e.key === "Escape") {
        if (isMobile && showPanel) setShowPanel(false);
        else setActiveId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentSlide, goToSlide, isMobile, showPanel]);

  const currentSection = safeSections[currentSlide];
  const isTitle = currentSection?.layout === "title" || currentSection?.id === "title_slide";
  const keyStats: KeyStat[] = meta?.keyStats || [];

  // Get findings for current slide
  const currentFindings = useMemo(() => {
    if (!currentSection) return [];
    return (currentSection.content || [])
      .filter((item) => item.type === "finding" && findingsMap[item.id])
      .map((item) => findingsMap[(item as { id: string }).id]);
  }, [currentSection, findingsMap]);

  // Render slide content
  const renderSlideContent = () => {
    if (!currentSection) return null;

    if (isTitle) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", padding: "40px 32px" }}>
          <h1 style={{ fontSize: isMobile ? 28 : 42, fontWeight: 800, color: DK.textSlide, margin: "0 0 12px", letterSpacing: -1, lineHeight: 1.1 }}>
            {meta?.title || currentSection.title}
          </h1>
          {(currentSection.subtitle || meta?.tagline) && (
            <p style={{ fontSize: isMobile ? 16 : 20, color: DK.textSlideSecondary, margin: "0 0 20px", fontWeight: 400, lineHeight: 1.5 }}>
              {currentSection.subtitle || meta?.tagline}
            </p>
          )}
          {meta?.companyDescription && (
            <p style={{ fontSize: 14, color: DK.textSlideSecondary, margin: "0 0 24px", maxWidth: 500, lineHeight: 1.7 }}>
              {meta.companyDescription}
            </p>
          )}
          {meta?.fundingAsk && (
            <div style={{ display: "inline-block", background: DK.accent + "12", border: `1.5px solid ${DK.accent}40`, borderRadius: 6, padding: "8px 20px", fontSize: 14, fontWeight: 600, color: DK.accent }}>
              {meta.fundingAsk}
            </div>
          )}
          {keyStats.length > 0 && (
            <div style={{ display: "flex", gap: 20, marginTop: 28, flexWrap: "wrap", justifyContent: "center" }}>
              {keyStats.slice(0, 4).map((stat, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: DK.textSlideSecondary, marginBottom: 2 }}>
                    {stat.label}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: DK.textSlide }}>{stat.value}</div>
                </div>
              ))}
            </div>
          )}
          {/* Render text-only content items */}
          {(currentSection.content || []).filter(c => c.type === "text").map((item, i) => (
            <p key={i} style={{ fontSize: 14, color: DK.textSlideSecondary, margin: "8px 0", lineHeight: 1.6 }}>
              {item.value}
            </p>
          ))}
        </div>
      );
    }

    // Content slide — render findings as bullet cards
    return (
      <div style={{ padding: isMobile ? "24px 16px" : "32px 40px", height: "100%", overflow: "auto" }}>
        <h2 style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700, color: DK.textSlide, margin: "0 0 20px", letterSpacing: -0.3 }}>
          {SLIDE_TITLES[currentSection.id] || currentSection.title || currentSection.id}
        </h2>
        {currentSection.subtitle && (
          <p style={{ fontSize: 14, color: DK.textSlideSecondary, margin: "-12px 0 20px", fontWeight: 400 }}>
            {currentSection.subtitle}
          </p>
        )}
        {currentFindings.map((f) => (
          <FindingBullet
            key={f.id}
            finding={f}
            isActive={activeId === f.id}
            onActivate={handleActivate}
          />
        ))}
        {currentFindings.length === 0 && (
          <div style={{ fontSize: 14, color: DK.textSlideSecondary, fontStyle: "italic", padding: 20, textAlign: "center" }}>
            No verified findings for this slide.
          </div>
        )}
      </div>
    );
  };

  const panelContent = activeId ? (
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
  ) : null;

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      width: "100%",
      fontFamily: "'Inter', 'Helvetica Neue', system-ui, sans-serif",
      background: DK.bg,
      color: DK.text,
      overflow: "hidden",
    }}>
      {/* Main slide area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: `1px solid ${DK.border}`,
          flexShrink: 0,
          flexWrap: "wrap",
          gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={onBack}
              style={{
                border: `1px solid ${DK.border}`,
                background: "transparent",
                borderRadius: 4,
                padding: "4px 12px",
                fontSize: 12,
                color: DK.textDim,
                cursor: "pointer",
              }}
            >
              Back
            </button>
            {onToggleView && (
              <button
                onClick={onToggleView}
                aria-label="View as written report"
                style={{
                  border: `1px solid ${DK.border}`,
                  background: "transparent",
                  borderRadius: 4,
                  padding: "4px 12px",
                  fontSize: 12,
                  color: DK.textDim,
                  cursor: "pointer",
                }}
              >
                View as Report
              </button>
            )}
            <span style={{ fontSize: 13, fontWeight: 600, color: DK.text }}>
              {meta?.title || "Slide Deck"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ExportMenu defaultFormat="pptx" theme="dark" />
            <span
              onClick={() => handleActivate("overview")}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              onKeyDown={(e: ReactKeyboardEvent<HTMLSpanElement>) => { if (e.key === "Enter") handleActivate("overview"); }}
            >
              <CertaintyBadge value={overallCertainty} />
            </span>
            <span style={{ fontSize: 11, color: DK.textDim }}>
              {currentSlide + 1} / {safeSections.length}
            </span>
            {saveState === "saving" && (
              <span style={{ fontSize: 11, color: DK.textDim }}>Autosaving...</span>
            )}
            {saveState === "saved" && (
              <>
                <span style={{ fontSize: 11, color: DK.green }}>Saved</span>
                {slug && (
                  <button
                    onClick={() => {
                      const fullUrl = window.location.origin + `/reports/${slug}`;
                      navigator.clipboard.writeText(fullUrl).then(
                        () => {
                          setCopyState("copied");
                          setTimeout(() => setCopyState("idle"), 2000);
                        },
                        () => {
                          setCopyState("failed");
                          setTimeout(() => setCopyState("idle"), 2000);
                        }
                      );
                    }}
                    aria-label="Copy report link"
                    style={{
                      border: `1px solid ${copyState === "failed" ? DK.red + "40" : DK.green + "40"}`,
                      background: copyState === "copied" ? DK.green + "12" : "transparent",
                      borderRadius: 3,
                      padding: "1px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: copyState === "failed" ? DK.red : DK.green,
                      cursor: copyState !== "idle" ? "default" : "pointer",
                      transition: "all 0.15s",
                    }}
                    disabled={copyState !== "idle"}
                  >
                    {copyState === "copied" ? "Link Copied \u2713" : copyState === "failed" ? "Copy Failed" : "Copy Link"}
                  </button>
                )}
              </>
            )}
            {saveState === "error" && (
              <>
                <span style={{ fontSize: 11, color: DK.red }}>Save failed</span>
                {onRetrySave && (
                  <button
                    onClick={onRetrySave}
                    aria-label="Retry saving report"
                    style={{
                      border: `1px solid ${DK.red}40`,
                      background: "transparent",
                      borderRadius: 3,
                      padding: "1px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: DK.red,
                      cursor: "pointer",
                    }}
                  >
                    Try Again
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Thumbnail navigation bar */}
        <div style={{
          display: "flex",
          gap: 4,
          padding: "8px 16px",
          overflowX: "auto",
          flexShrink: 0,
          borderBottom: `1px solid ${DK.border}`,
        }}>
          {safeSections.map((section, i) => {
            const isActive = i === currentSlide;
            return (
              <button
                key={section.id}
                onClick={() => goToSlide(i)}
                title={SLIDE_TITLES[section.id] || section.title || section.id}
                style={{
                  flexShrink: 0,
                  width: isMobile ? 60 : 80,
                  height: isMobile ? 38 : 48,
                  borderRadius: 4,
                  border: isActive ? `2px solid ${DK.accent}` : `1px solid ${DK.border}`,
                  background: isActive ? DK.accent + "18" : DK.cardBg,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 4,
                }}
              >
                <span style={{
                  fontSize: 8,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? DK.accent : DK.textDim,
                  textAlign: "center",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                }}>
                  {i + 1}. {(SLIDE_TITLES[section.id] || section.title || "").slice(0, 12)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Slide content area — 16:9 */}
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: isMobile ? 12 : 24,
          overflow: "hidden",
        }}>
          <div style={{
            width: "100%",
            maxWidth: 900,
            aspectRatio: "16 / 9",
            background: DK.slideBg,
            borderRadius: 8,
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}>
            {renderSlideContent()}
          </div>
        </div>

        {/* Bottom navigation */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 24px 12px",
          borderTop: `1px solid ${DK.border}`,
          flexShrink: 0,
        }}>
          <button
            onClick={() => goToSlide(currentSlide - 1)}
            disabled={currentSlide === 0}
            style={{
              border: `1px solid ${DK.border}`,
              background: "transparent",
              borderRadius: 4,
              padding: "6px 16px",
              fontSize: 13,
              color: currentSlide === 0 ? DK.border : DK.text,
              cursor: currentSlide === 0 ? "not-allowed" : "pointer",
            }}
          >
            Previous
          </button>

          {/* Speaker notes toggle */}
          {currentSection?.speakerNotes && (
            <details style={{ fontSize: 12, color: DK.textDim, maxWidth: 400, textAlign: "center" }}>
              <summary style={{ cursor: "pointer", fontWeight: 500 }}>Speaker Notes</summary>
              <p style={{ margin: "6px 0 0", lineHeight: 1.6, fontStyle: "italic" }}>
                {currentSection.speakerNotes}
              </p>
            </details>
          )}

          <button
            onClick={() => goToSlide(currentSlide + 1)}
            disabled={currentSlide >= safeSections.length - 1}
            style={{
              border: `1px solid ${DK.border}`,
              background: currentSlide >= safeSections.length - 1 ? "transparent" : DK.accent,
              borderColor: currentSlide >= safeSections.length - 1 ? DK.border : DK.accent,
              borderRadius: 4,
              padding: "6px 16px",
              fontSize: 13,
              color: currentSlide >= safeSections.length - 1 ? DK.border : "#fff",
              cursor: currentSlide >= safeSections.length - 1 ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            Next
          </button>
        </div>
      </div>

      {/* Explanation panel (desktop only — mobile uses overlay) */}
      {isMobile ? (
        <>
          {!showPanel && activeId && (
            <button
              onClick={() => setShowPanel(true)}
              aria-label="Show explanation panel"
              style={{
                position: "fixed",
                bottom: 70,
                right: 16,
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: DK.accent,
                color: "#fff",
                border: "none",
                fontSize: 16,
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
          {showPanel && activeId && (
            <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column" }}>
              <div onClick={() => setShowPanel(false)} style={{ flex: "0 0 15vh", background: "rgba(0,0,0,0.5)" }} />
              <div style={{
                flex: 1,
                background: "#fff",
                borderTopLeftRadius: 12,
                borderTopRightRadius: 12,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}>
                <div style={{ padding: "8px 12px 0", display: "flex", justifyContent: "center", alignItems: "center", position: "relative" }}>
                  <div style={{ width: 36, height: 4, borderRadius: 2, background: "#e2e4ea" }} />
                  <button
                    onClick={() => setShowPanel(false)}
                    aria-label="Close explanation panel"
                    style={{ position: "absolute", right: 12, top: 4, border: "none", background: "transparent", fontSize: 18, color: "#8a8ca5", cursor: "pointer", padding: "4px 8px", borderRadius: 4 }}
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
        activeId && (
          <div style={{
            flex: "0 0 30%",
            minWidth: 300,
            maxWidth: 400,
            background: "#fff",
            borderLeft: `1px solid ${DK.border}`,
            display: "flex",
            flexDirection: "column",
            height: "100vh",
            overflow: "hidden",
          }}>
            {panelContent}
          </div>
        )
      )}
    </div>
  );
}
