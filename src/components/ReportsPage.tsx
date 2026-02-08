import { useState, useEffect } from "react";

interface ReportSummary {
  slug: string;
  title: string;
  ticker: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export default function ReportsPage({ onBack }: { onBack: () => void }) {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reports")
      .then((res) => {
        if (!res.ok) throw new Error(`Error ${res.status}`);
        return res.json();
      })
      .then((data: { reports: ReportSummary[] }) => {
        setReports(data.reports);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message || "Failed to load reports");
        setLoading(false);
      });
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "60px 24px",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: -1,
            color: "#1a1a2e",
          }}
        >
          Doubly
          <span style={{ color: "#b45309" }}>AI</span>
        </h1>
        <p style={{ fontSize: 14, color: "#8a8ca5", marginTop: 6, fontWeight: 500 }}>
          Published Reports
        </p>
      </div>

      <button
        onClick={onBack}
        style={{
          marginBottom: 24,
          padding: "6px 20px",
          fontSize: 12,
          fontWeight: 600,
          border: "1px solid #e2e4ea",
          borderRadius: 4,
          background: "#fff",
          cursor: "pointer",
          color: "#555770",
        }}
      >
        New Report
      </button>

      <div style={{ width: "100%", maxWidth: 700 }}>
        {loading && (
          <div style={{ textAlign: "center", fontSize: 14, color: "#8a8ca5", padding: 40 }}>
            Loading reports...
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "16px 24px",
              background: "#b91c1c0a",
              border: "1px solid #b91c1c30",
              borderRadius: 6,
            }}
          >
            <div style={{ fontSize: 13, color: "#b91c1c" }}>{error}</div>
          </div>
        )}

        {!loading && !error && reports.length === 0 && (
          <div style={{ textAlign: "center", fontSize: 14, color: "#8a8ca5", padding: 40 }}>
            No published reports yet.
          </div>
        )}

        {!loading &&
          !error &&
          reports.map((r) => (
            <a
              key={r.slug}
              href={`/reports/${r.slug}`}
              style={{
                display: "block",
                padding: "16px 20px",
                marginBottom: 8,
                background: "#fff",
                border: "1px solid #e2e4ea",
                borderRadius: 6,
                textDecoration: "none",
                color: "inherit",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "#b45309";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "#e2e4ea";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                {r.ticker && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#b45309",
                      background: "#b453090d",
                      padding: "2px 8px",
                      borderRadius: 3,
                      letterSpacing: 0.5,
                    }}
                  >
                    {r.ticker.toUpperCase()}
                  </span>
                )}
                <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a2e" }}>
                  {r.title}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#8a8ca5" }}>
                {formatDate(r.updatedAt)}
                {r.currentVersion > 1 && ` · v${r.currentVersion}`}
              </div>
            </a>
          ))}
      </div>
    </div>
  );
}
