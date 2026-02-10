import { useState, useRef, useEffect, useCallback } from "react";

export type ExportFormat = "pdf" | "pptx";

type SaveState = "idle" | "saving" | "saved" | "error";

interface ExportMenuProps {
  /** Which format is shown as the primary/default option */
  defaultFormat: ExportFormat;
  /** Called when user picks a format (optional — toast is shown regardless) */
  onExport?: (format: ExportFormat) => void;
  /** Color scheme: "light" for Report, "dark" for SlideDeck */
  theme?: "light" | "dark";
  /** On mobile, save state UI is folded into the Export dropdown */
  isMobile?: boolean;
  saveState?: SaveState;
  slug?: string;
  onRetrySave?: () => void;
}

const FORMATS: Record<ExportFormat, { label: string; icon: string }> = {
  pdf: { label: "Export PDF", icon: "PDF" },
  pptx: { label: "Export PowerPoint", icon: "PPTX" },
};

export default function ExportMenu({ defaultFormat, onExport, theme = "light", isMobile, saveState, slug, onRetrySave }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDark = theme === "dark";
  const borderColor = isDark ? "#2a2a40" : "#e2e4ea";
  const bgColor = isDark ? "#1a1a2e" : "#ffffff";
  const textColor = isDark ? "#e8e8f0" : "#555770";
  const textDim = isDark ? "#9a9ab0" : "#8a8ca5";
  const hoverBg = isDark ? "#2a2a40" : "#f7f7fa";
  const greenColor = isDark ? "#34d399" : "#16a34a";
  const redColor = isDark ? "#f87171" : "#dc2626";
  const showSaveInMenu = isMobile && saveState && saveState !== "idle";

  const otherFormat: ExportFormat = defaultFormat === "pdf" ? "pptx" : "pdf";

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setOpen(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoverTimeout.current = setTimeout(() => setOpen(false), 200);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const handleExport = useCallback((format: ExportFormat) => {
    setOpen(false);
    setToast(`${FORMATS[format].label} is not yet implemented`);
    onExport?.(format);
  }, [onExport]);

  // Auto-dismiss toast after 3s
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Export report"
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          padding: "4px 12px",
          fontSize: 12,
          fontWeight: 600,
          border: `1px solid ${borderColor}`,
          borderRadius: 4,
          background: bgColor,
          color: textColor,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        Export
        {showSaveInMenu && (
          <span style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: saveState === "error" ? redColor : saveState === "saved" ? greenColor : textDim,
            flexShrink: 0,
          }} />
        )}
        <span style={{ fontSize: 10, marginLeft: 2, opacity: 0.6 }}>{open ? "\u25B2" : "\u25BC"}</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 180,
            background: bgColor,
            border: `1px solid ${borderColor}`,
            borderRadius: 6,
            boxShadow: isDark
              ? "0 4px 16px rgba(0,0,0,0.4)"
              : "0 4px 16px rgba(0,0,0,0.1)",
            zIndex: 300,
            overflow: "hidden",
          }}
        >
          {[defaultFormat, otherFormat].map((format) => (
            <button
              key={format}
              role="menuitem"
              onClick={() => handleExport(format)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "10px 14px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: format === defaultFormat ? 600 : 400,
                color: textColor,
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 3,
                  background: format === "pdf" ? "#dc262620" : "#2563eb20",
                  color: format === "pdf" ? "#dc2626" : "#2563eb",
                  letterSpacing: 0.5,
                }}
              >
                {FORMATS[format].icon}
              </span>
              <span>{FORMATS[format].label}</span>
              {format === defaultFormat && (
                <span style={{ fontSize: 10, color: textDim, marginLeft: "auto" }}>
                  Recommended
                </span>
              )}
            </button>
          ))}

          {/* Save state section (mobile only) */}
          {showSaveInMenu && (
            <>
              <div style={{
                height: 1,
                background: borderColor,
                margin: "4px 0",
              }} />
              <div style={{
                padding: "8px 14px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                fontWeight: 500,
              }}>
                {saveState === "saving" && (
                  <span style={{ color: textDim }}>Autosaving...</span>
                )}
                {saveState === "saved" && (
                  <>
                    <span style={{ color: greenColor }}>Saved</span>
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
                          border: `1px solid ${copyState === "failed" ? redColor + "40" : greenColor + "40"}`,
                          background: copyState === "copied" ? greenColor + "0a" : "transparent",
                          borderRadius: 3,
                          padding: "1px 8px",
                          fontSize: 11,
                          fontWeight: 600,
                          color: copyState === "failed" ? redColor : greenColor,
                          cursor: copyState !== "idle" ? "default" : "pointer",
                          transition: "all 0.15s",
                          marginLeft: "auto",
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
                    <span style={{ color: redColor }}>Save failed</span>
                    {onRetrySave && (
                      <button
                        onClick={onRetrySave}
                        aria-label="Retry saving report"
                        style={{
                          border: `1px solid ${redColor}40`,
                          background: "transparent",
                          borderRadius: 3,
                          padding: "1px 8px",
                          fontSize: 11,
                          fontWeight: 600,
                          color: redColor,
                          cursor: "pointer",
                          marginLeft: "auto",
                        }}
                      >
                        Try Again
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: isDark ? "#2a2a40" : "#1a1a2e",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
            zIndex: 9999,
            whiteSpace: "nowrap",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
