import { useState, useRef, useEffect, useCallback } from "react";

export type ExportFormat = "pdf" | "pptx";

interface ExportMenuProps {
  /** Which format is shown as the primary/default option */
  defaultFormat: ExportFormat;
  /** Called when user picks a format */
  onExport: (format: ExportFormat) => void;
  /** Color scheme: "light" for Report, "dark" for SlideDeck */
  theme?: "light" | "dark";
}

const FORMATS: Record<ExportFormat, { label: string; icon: string }> = {
  pdf: { label: "Export PDF", icon: "PDF" },
  pptx: { label: "Export PowerPoint", icon: "PPTX" },
};

export default function ExportMenu({ defaultFormat, onExport, theme = "light" }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDark = theme === "dark";
  const borderColor = isDark ? "#2a2a40" : "#e2e4ea";
  const bgColor = isDark ? "#1a1a2e" : "#ffffff";
  const textColor = isDark ? "#e8e8f0" : "#555770";
  const textDim = isDark ? "#9a9ab0" : "#8a8ca5";
  const hoverBg = isDark ? "#2a2a40" : "#f7f7fa";

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
    onExport(format);
  }, [onExport]);

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
          <div style={{ padding: "6px 14px", borderTop: `1px solid ${borderColor}` }}>
            <span style={{ fontSize: 10, color: textDim, lineHeight: 1.4 }}>
              Export functionality coming soon
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
