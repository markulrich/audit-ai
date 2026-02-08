import { useState, useEffect } from "react";

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function certaintyColor(c) {
  if (c >= 90) return "#16a34a";
  if (c >= 50) return "#d97706";
  return "#dc2626";
}

function ratingBadgeColor(rating) {
  if (!rating) return { bg: "#f3f4f6", color: "#555770" };
  const r = rating.toLowerCase();
  if (r === "overweight") return { bg: "#dcfce7", color: "#16a34a" };
  if (r === "underweight") return { bg: "#fee2e2", color: "#dc2626" };
  return { bg: "#fef9c3", color: "#a16207" };
}

export default function ReportHistory({ onSelectReport }) {
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const limit = 10;

  useEffect(() => {
    fetchReports();
  }, [offset]);

  async function fetchReports() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports?limit=${limit}&offset=${offset}`);
      if (!res.ok) throw new Error("Failed to load reports");
      const data = await res.json();
      setReports(data.reports || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!confirm("Delete this report? This cannot be undone.")) return;

    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      fetchReports();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  async function handleSelect(id) {
    try {
      const res = await fetch(`/api/reports/${id}`);
      if (!res.ok) throw new Error("Failed to load report");
      const data = await res.json();
      onSelectReport(data.report_json);
    } catch (err) {
      console.error("Load failed:", err);
    }
  }

  if (loading && reports.length === 0) {
    return (
      <div style={{ textAlign: "center", color: "#8a8ca5", fontSize: 13, marginTop: 32 }}>
        Loading reports...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", color: "#b91c1c", fontSize: 13, marginTop: 32 }}>
        {error}
      </div>
    );
  }

  if (reports.length === 0) {
    return null;
  }

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div style={{ width: "100%", maxWidth: 600, marginTop: 40 }}>
      <div style={{
        fontSize: 12,
        fontWeight: 700,
        color: "#8a8ca5",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 12,
      }}>
        Recent Reports
      </div>

      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        {reports.map((r) => {
          const badge = ratingBadgeColor(r.rating);
          return (
            <div
              key={r.id}
              onClick={() => handleSelect(r.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                background: "#fff",
                border: "1px solid #e2e4ea",
                borderRadius: 8,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#1a1a2e";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#e2e4ea";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {/* Ticker badge */}
              {r.ticker && (
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#1a1a2e",
                  background: "#f3f4f6",
                  padding: "4px 8px",
                  borderRadius: 4,
                  minWidth: 44,
                  textAlign: "center",
                  flexShrink: 0,
                }}>
                  {r.ticker}
                </div>
              )}

              {/* Title + query */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#1a1a2e",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {r.title || r.query}
                </div>
                {r.title && (
                  <div style={{
                    fontSize: 11,
                    color: "#8a8ca5",
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {r.query}
                  </div>
                )}
              </div>

              {/* Rating */}
              {r.rating && (
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: badge.color,
                  background: badge.bg,
                  padding: "3px 8px",
                  borderRadius: 10,
                  flexShrink: 0,
                }}>
                  {r.rating}
                </div>
              )}

              {/* Certainty */}
              {r.overall_certainty && (
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: certaintyColor(r.overall_certainty),
                  flexShrink: 0,
                }}>
                  {r.overall_certainty}%
                </div>
              )}

              {/* Date */}
              <div style={{
                fontSize: 11,
                color: "#8a8ca5",
                flexShrink: 0,
                minWidth: 50,
                textAlign: "right",
              }}>
                {formatDate(r.created_at)}
              </div>

              {/* Delete */}
              <button
                onClick={(e) => handleDelete(e, r.id)}
                title="Delete report"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#ccc",
                  fontSize: 14,
                  padding: "2px 4px",
                  flexShrink: 0,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => { e.target.style.color = "#dc2626"; }}
                onMouseLeave={(e) => { e.target.style.color = "#ccc"; }}
              >
                &times;
              </button>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 16,
          marginTop: 16,
          fontSize: 12,
          color: "#8a8ca5",
        }}>
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            style={{
              padding: "4px 12px",
              fontSize: 11,
              border: "1px solid #e2e4ea",
              borderRadius: 4,
              background: "#fff",
              cursor: offset === 0 ? "not-allowed" : "pointer",
              color: offset === 0 ? "#ccc" : "#555770",
            }}
          >
            Prev
          </button>
          <span>Page {currentPage} of {totalPages}</span>
          <button
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
            style={{
              padding: "4px 12px",
              fontSize: 11,
              border: "1px solid #e2e4ea",
              borderRadius: 4,
              background: "#fff",
              cursor: offset + limit >= total ? "not-allowed" : "pointer",
              color: offset + limit >= total ? "#ccc" : "#555770",
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
