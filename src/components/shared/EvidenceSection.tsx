import { COLORS } from "./certainty-utils";
import type { EvidenceItem } from "../../../shared/types";

interface EvidenceSectionProps {
  title: string;
  items: EvidenceItem[] | undefined;
  color: string;
}

export default function EvidenceSection({ title, items, color }: EvidenceSectionProps) {
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
