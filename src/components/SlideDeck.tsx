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
  bg: "#0f0f1a",
  cardBg: "#1a1a2e",
  slideBg: "#ffffff",
  text: "#1a1a2e",
  textLight: "#ffffff",
  textSecondary: "#555770",
  textMuted: "#8a8ca5",
  border: "#2a2a40",
  borderLight: "#e2e4ea",
  accent: "#1a1a2e",
  accentBlue: "#3b82f6",
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

// ─── Prop Interfaces ────────────────────────────────────────────────────────────

interface SlideDeckProps {
  data: ReportData;
  traceData: TraceEvent[];
  onBack: () => void;
  publishedSlug?: string | null;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function CertaintyBadge({ value, large }: { value: number; large?: boolean }) {
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

function EvidenceSection({ title, items, color }: { title: string; items: EvidenceItem[] | undefined; color: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color, marginBottom: 6 }}>
        {title} ({items.length})
      </div>
      {items.map((ev: EvidenceItem, i: number) => (
        <div key={i} style={{ padding: "8px 10px", marginBottom: 6, background: color + "06", border: `1px solid ${color}18`, borderRadius: 4, fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, color: COLORS.text, marginBottom: 2, fontSize: 11 }}>{ev.source}</div>
          <div style={{ color: COLORS.textSecondary, fontStyle: "italic" }}>&ldquo;{ev.quote}&rdquo;</div>
          {ev.url && ev.url !== "general" && ev.url !== "various" && ev.url !== "derived" && ev.url !== "internal" && (
            <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 3 }}>
              Source:{" "}
              {ev.url.startsWith("http") ? (
                <a href={ev.url} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.textMuted, textDecoration: "underline" }}>
                  {(() => { try { return new URL(ev.url).hostname.replace(/^www\./, ""); } catch { return ev.url; } })()}
                </a>
              ) : ev.url}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ExplanationPanel({ activeData, isOverview, findingIndex, total, onNavigate, overallCertainty, findingsCount, overviewData }: {
  activeData: Finding | { explanation: Partial<Explanation> } | null;
  isOverview: boolean;
  findingIndex: number;
  total: number;
  onNavigate: (dir: number) => void;
  overallCertainty: number;
  findingsCount: number;
  overviewData: MethodologyData | undefined;
}) {
  if (!activeData) return null;

  const certainty = isOverview ? overallCertainty : (activeData as Finding).certainty;
  const expl = activeData.explanation;
  const id = isOverview ? "overview" : (activeData as Finding).id;

  return (
    <div role="complementary" aria-label="Explanation panel" style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "inherit" }}>
      <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${COLORS.borderLight}`, flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, color: COLORS.textMuted, marginBottom: 8 }}>
          Explanation
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button aria-label="Previous finding" onClick={() => onNavigate(-1)} style={{ border: `1px solid ${COLORS.borderLight}`, background: "#fff", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 14, color: COLORS.text }}>
            ←
          </button>
          <span style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 500 }}>
            {isOverview ? "Overview" : `${findingIndex + 1} of ${total}`}
          </span>
          <button aria-label="Next finding" onClick={() => onNavigate(1)} style={{ border: `1px solid ${COLORS.borderLight}`, background: "#fff", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 14, color: COLORS.text }}>
            →
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, margin: "0 0 10px", lineHeight: 1.3 }}>
          {isOverview ? (overviewData?.explanation?.title || "Deck Methodology") : (expl?.title || "Explanation")}
        </h3>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: COLORS.textMuted, marginRight: 8 }}>
            Certainty
          </span>
          <CertaintyBadge value={certainty || 50} />
        </div>

        {isOverview && (
          <>
            <p style={{ fontSize: 13, lineHeight: 1.75, color: COLORS.textSecondary, margin: "0 0 4px", whiteSpace: "pre-wrap" }}>
              {overviewData?.explanation?.text || `This deck was generated by DoublyAI using a multi-agent pipeline: Research Agent gathered evidence, Synthesis Agent drafted findings, and Verification Agent adversarially reviewed each claim. The overall certainty of ${overallCertainty}% is the arithmetic mean of all ${findingsCount} finding scores.`}
            </p>
            <EvidenceSection title="Supporting Evidence" items={overviewData?.explanation?.supportingEvidence} color={COLORS.green} />
            <EvidenceSection title="Contrary Evidence" items={overviewData?.explanation?.contraryEvidence} color={COLORS.red} />
          </>
        )}

        {!isOverview && (
          <>
            <div style={{
              background: getCertaintyColor(certainty ?? 50) + "08",
              border: `1px solid ${getCertaintyColor(certainty ?? 50)}20`,
              borderRadius: 4,
              padding: "6px 10px",
              marginBottom: 14,
              fontSize: 12,
              color: COLORS.textSecondary,
              fontStyle: "italic",
              lineHeight: 1.5,
            }}>
              Finding: &ldquo;{(activeData as Finding).text}&rdquo;
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.75, color: COLORS.textSecondary, margin: "0 0 4px", whiteSpace: "pre-wrap" }}>
              {expl?.text}
            </p>
            <EvidenceSection title="Supporting Evidence" items={expl?.supportingEvidence} color={COLORS.green} />
            <EvidenceSection title="Contrary Evidence" items={expl?.contraryEvidence} color={COLORS.red} />
          </>
        )}
      </div>
    </div>
  );
}

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

// ─── Main SlideDeck Component ───────────────────────────────────────────────────

export default function SlideDeck({ data, traceData, onBack, publishedSlug }: SlideDeckProps) {
  const [activeId, setActiveId] = useState<string>("overview");
  const [currentSlide, setCurrentSlide] = useState<number>(0);
  const [showPanel, setShowPanel] = useState<boolean>(false);
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [publishState, setPublishState] = useState<"idle" | "publishing" | "done" | "error">(publishedSlug ? "done" : "idle");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(publishedSlug ? `/reports/${publishedSlug}` : null);
  const [publishError, setPublishError] = useState<string | null>(null);
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

  // Get findings for the current slide
  const currentSlideFindings = useMemo<Finding[]>(() => {
    if (!currentSection) return [];
    return (currentSection.content || [])
      .filter((item) => item.type === "finding")
      .map((item) => findingsMap[(item as { id: string }).id])
      .filter(Boolean) as Finding[];
  }, [currentSection, findingsMap]);

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
          {/* Render any text content items from the title slide */}
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
        color: COLORS.textLight,
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
              border: `1px solid ${COLORS.border}`,
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
                border: `1px solid ${COLORS.border}`,
                borderRadius: 4,
                background: "transparent",
                color: COLORS.textMuted,
                cursor: "pointer",
              }}
            >
              Details
            </button>
          )}
          {publishState === "idle" && (
            <button
              onClick={handlePublish}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 600,
                border: `1px solid ${COLORS.green}40`,
                borderRadius: 4,
                background: COLORS.green + "1a",
                color: COLORS.green,
                cursor: "pointer",
              }}
            >
              Publish
            </button>
          )}
          {publishState === "publishing" && (
            <span style={{ fontSize: 12, color: COLORS.textMuted }}>Publishing...</span>
          )}
          {publishState === "done" && publishedUrl && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.green }}>
              Published
              <button
                onClick={() => { navigator.clipboard.writeText(window.location.origin + publishedUrl).catch(() => {}); }}
                style={{ border: `1px solid ${COLORS.green}40`, background: "transparent", borderRadius: 3, padding: "1px 8px", fontSize: 11, fontWeight: 600, color: COLORS.green, cursor: "pointer" }}
              >
                Copy Link
              </button>
            </span>
          )}
          {publishState === "error" && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.red }}>
              {publishError || "Failed"}
              <button onClick={handlePublish} style={{ border: `1px solid ${COLORS.red}40`, background: "transparent", borderRadius: 3, padding: "1px 8px", fontSize: 11, fontWeight: 600, color: COLORS.red, cursor: "pointer" }}>
                Retry
              </button>
            </span>
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
                border: `1px solid ${currentSlide === i ? COLORS.accentBlue : COLORS.border}`,
                borderRadius: 4,
                background: currentSlide === i ? COLORS.accentBlue + "20" : "transparent",
                color: currentSlide === i ? COLORS.accentBlue : COLORS.textMuted,
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
              background: COLORS.slideBg,
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
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              background: "transparent",
              color: currentSlide === 0 ? COLORS.border : COLORS.textMuted,
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
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              background: "transparent",
              color: currentSlide === safeSections.length - 1 ? COLORS.border : COLORS.textMuted,
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
              <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.6, padding: "8px 12px", background: COLORS.cardBg, borderRadius: 6, border: `1px solid ${COLORS.border}` }}>
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
                background: COLORS.accentBlue,
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
              <div style={{ flex: 1, background: COLORS.slideBg, borderTopLeftRadius: 12, borderTopRightRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "8px 12px 0", display: "flex", justifyContent: "center", alignItems: "center", position: "relative" }}>
                  <div style={{ width: 36, height: 4, borderRadius: 2, background: COLORS.borderLight }} />
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
            background: COLORS.slideBg,
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
