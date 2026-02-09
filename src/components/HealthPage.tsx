import { useState, useEffect } from "react";

interface ServiceStatus {
  status: "ok" | "error" | "unconfigured";
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

interface HealthData {
  status: "healthy" | "degraded" | "unhealthy";
  services: {
    anthropic: ServiceStatus;
    s3: ServiceStatus;
  };
  build: {
    commitSha: string;
    commitTitle: string;
    buildTime: string;
  };
  runtime: {
    serverStartTime: string;
    uptime: string;
    nodeVersion: string;
    environment: string;
    region: string | null;
    appName: string | null;
    allocId: string | null;
    memoryUsageMb: number;
  };
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ok: { bg: "#dcfce7", text: "#166534", border: "#86efac" },
  healthy: { bg: "#dcfce7", text: "#166534", border: "#86efac" },
  error: { bg: "#fef2f2", text: "#991b1b", border: "#fca5a5" },
  unhealthy: { bg: "#fef2f2", text: "#991b1b", border: "#fca5a5" },
  degraded: { bg: "#fef9c3", text: "#854d0e", border: "#fde047" },
  unconfigured: { bg: "#f3f4f6", text: "#6b7280", border: "#d1d5db" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.unconfigured;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 600,
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "20px 24px",
        marginBottom: 16,
      }}
    >
      <h3
        style={{
          fontSize: 13,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "#6b7280",
          marginBottom: 16,
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid #f3f4f6",
        gap: 16,
      }}
    >
      <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          color: "#1f2937",
          fontWeight: 500,
          fontFamily: mono ? "'SF Mono', 'Fira Code', 'Consolas', monospace" : "inherit",
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ServiceCard({ name, service }: { name: string; service: ServiceStatus }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "16px 20px",
        marginBottom: 12,
        background: service.status === "ok" ? "#fafffe" : service.status === "error" ? "#fffafa" : "#fafafa",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: "#1f2937" }}>{name}</span>
        <StatusBadge status={service.status} />
      </div>
      <Row label="Latency" value={`${service.latencyMs}ms`} mono />
      {service.error && <Row label="Error" value={<span style={{ color: "#991b1b" }}>{service.error}</span>} />}
      {service.details &&
        Object.entries(service.details).map(([key, val]) => (
          <Row key={key} label={key} value={String(val)} mono />
        ))}
    </div>
  );
}

export default function HealthPage({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/health");
      const json = await res.json();
      setData(json);
      setLastChecked(new Date().toLocaleTimeString());
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : "Failed to reach server");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "40px 24px",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a1a2e", letterSpacing: -0.5 }}>
              System Health
            </h1>
            {data && <StatusBadge status={data.status} />}
          </div>
          {lastChecked && (
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              Last checked: {lastChecked}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={fetchHealth}
            disabled={loading}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid #e2e4ea",
              borderRadius: 6,
              background: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              color: "#1a1a2e",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Checking..." : "Refresh"}
          </button>
          <button
            onClick={onBack}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid #e2e4ea",
              borderRadius: 6,
              background: "#fff",
              cursor: "pointer",
              color: "#555770",
            }}
          >
            Back
          </button>
        </div>
      </div>

      {/* Fetch error */}
      {fetchError && (
        <div
          style={{
            padding: "16px 20px",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
            color: "#991b1b",
          }}
        >
          Could not reach the server: {fetchError}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div style={{ fontSize: 14, color: "#9ca3af", textAlign: "center", padding: 40 }}>
          Checking system health...
        </div>
      )}

      {data && (
        <>
          {/* Services */}
          <Card title="Services">
            <ServiceCard name="Anthropic API" service={data.services.anthropic} />
            <ServiceCard name="S3 Storage (Tigris)" service={data.services.s3} />
          </Card>

          {/* Build info */}
          <Card title="Build">
            <Row label="Commit" value={data.build.commitSha.slice(0, 12)} mono />
            <Row label="Message" value={data.build.commitTitle} />
            <Row label="Built at" value={formatDate(data.build.buildTime)} />
          </Card>

          {/* Runtime info */}
          <Card title="Runtime">
            <Row label="Environment" value={data.runtime.environment} mono />
            <Row label="Node.js" value={data.runtime.nodeVersion} mono />
            <Row label="Uptime" value={data.runtime.uptime} mono />
            <Row label="Memory (RSS)" value={`${data.runtime.memoryUsageMb} MB`} mono />
            <Row label="Server started" value={formatDate(data.runtime.serverStartTime)} />
            {data.runtime.region && <Row label="Region" value={data.runtime.region} mono />}
            {data.runtime.appName && <Row label="App" value={data.runtime.appName} mono />}
            {data.runtime.allocId && <Row label="Alloc ID" value={data.runtime.allocId} mono />}
          </Card>
        </>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso || iso === "unknown") return "unknown";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
