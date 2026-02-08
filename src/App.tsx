import { useState, useRef, useEffect } from "react";
import type { Report, ProgressEvent, TraceEvent, ErrorInfo, ErrorDetail } from "../shared/types";
import QueryInput from "./components/QueryInput";
import ProgressStream from "./components/ProgressStream";
import Report_ from "./components/Report";

function isReportPayload(value: unknown): value is Report {
  return (
    value != null &&
    typeof value === "object" &&
    "meta" in value &&
    value.meta != null &&
    typeof value.meta === "object" &&
    "sections" in value &&
    Array.isArray(value.sections) &&
    "findings" in value &&
    Array.isArray(value.findings)
  );
}

interface SseBlock {
  eventType: string;
  data: string;
}

function parseSseBlock(block: string): SseBlock | null {
  const lines = block.split(/\r?\n/);
  let eventType = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    let value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      eventType = value.trim() || "message";
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) return null;
  return { eventType, data: dataLines.join("\n") };
}

// Check if we're on a /reports/:slug route
function getPublishedSlug() {
  const match = window.location.pathname.match(/^\/reports\/([a-z0-9-]+)$/);
  return match ? match[1] : null;
}

export default function App() {
  const [state, setState] = useState<"idle" | "loading" | "loading-published" | "done" | "error">(
    () => getPublishedSlug() ? "loading-published" : "idle"
  );
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [traceData, setTraceData] = useState<TraceEvent[]>([]);
  const [reasoningLevel, setReasoningLevel] = useState<string>("heavy");
  const [publishedSlug, setPublishedSlug] = useState<string | null>(getPublishedSlug);
  const abortRef = useRef<AbortController | null>(null);

  // Load published report on mount if URL matches /reports/:slug
  useEffect(() => {
    const slug = getPublishedSlug();
    if (!slug) return;

    const params = new URLSearchParams(window.location.search);
    const version = params.get("v");
    const url = `/api/reports/${slug}${version ? `?v=${version}` : ""}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Report not found" : `Error ${res.status}`);
        return res.json();
      })
      .then((data: { report: Report }) => {
        setReport(data.report);
        setPublishedSlug(slug);
        setState("done");
      })
      .catch((err: Error) => {
        setError({ message: err.message || "Failed to load report", detail: null });
        setState("error");
      });
  }, []);

  const handleGenerate = async (query: string): Promise<void> => {
    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState("loading");
    setProgress([]);
    setReport(null);
    setError(null);
    setTraceData([]);
    setPublishedSlug(null);

    // Local flags to avoid stale closure over React state
    let receivedReport = false;
    let receivedError = false;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, reasoningLevel }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error: ${res.status}`);
      }

      if (!res.body) {
        throw new Error("Empty response body from /api/generate");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEventPayload = (eventType: string, payload: unknown): void => {
        if (eventType === "progress") {
          setProgress((prev) => [...prev, payload as ProgressEvent]);
          return;
        }

        if (eventType === "trace") {
          setTraceData((prev) => [...prev, payload as TraceEvent]);
          return;
        }

        const data = payload as Record<string, unknown> | null | undefined;

        if (eventType === "error" || (eventType === "message" && typeof data?.error === "string")) {
          receivedError = true;
          const errorInfo: ErrorInfo = {
            message: (data?.message as string) || (data?.error as string) || "Report generation failed.",
            detail: (data?.detail as ErrorDetail) || null,
          };
          setError(errorInfo);
          setState("error");
          return;
        }

        if (eventType === "report" || (eventType === "message" && isReportPayload(payload))) {
          receivedReport = true;
          setReport(payload as Report);
          setState("done");
        }
      };

      const handleSerializedData = (eventType: string, serialized: string): void => {
        try {
          const payload: unknown = JSON.parse(serialized);
          handleEventPayload(eventType, payload);
        } catch {
          // skip malformed JSON
        }
      };

      const flushBuffer = (force: boolean = false): void => {
        const separator = /\r?\n\r?\n/g;
        let start = 0;
        let match: RegExpExecArray | null;

        while ((match = separator.exec(buffer)) !== null) {
          const block = buffer.slice(start, match.index);
          start = match.index + match[0].length;

          const parsed = parseSseBlock(block);
          if (parsed) handleSerializedData(parsed.eventType, parsed.data);
        }

        buffer = buffer.slice(start);

        if (!force || buffer.trim().length === 0) return;

        const parsed = parseSseBlock(buffer);
        if (parsed) {
          handleSerializedData(parsed.eventType, parsed.data);
          buffer = "";
          return;
        }

        // Fallback: accept plain JSON 200 responses from non-streaming backends.
        handleSerializedData("message", buffer);
        buffer = "";
      };

      while (true) {
        const { done, value }: ReadableStreamReadResult<Uint8Array> = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        flushBuffer();
      }
      buffer += decoder.decode();
      flushBuffer(true);

      // If stream ended without a report or error event
      if (!receivedReport && !receivedError) {
        setState("error");
        setError({ message: "Pipeline completed without producing a report.", detail: null });
      }
    } catch (rawErr: unknown) {
      if (rawErr instanceof Error && rawErr.name === "AbortError") return; // User cancelled — do nothing

      const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr));

      // Browser gives unhelpful messages like "Load failed" or "Failed to fetch"
      // when the connection drops (e.g., server restart, network issue).
      const isNetworkError =
        rawErr instanceof TypeError &&
        /load failed|failed to fetch|network/i.test(err.message);

      const message = isNetworkError
        ? "Connection to the server was lost — the server may have restarted or your network dropped. Please try again."
        : err.message || "An unknown error occurred.";

      setError({
        message,
        detail: {
          originalError: err.message,
          type: err.constructor?.name || "Error",
          hint: isNetworkError
            ? "This usually means the server process restarted mid-request. Your query was not completed."
            : null,
        },
      });
      setState("error");
    }
  };

  const handleReset = (): void => {
    // Abort any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState("idle");
    setProgress([]);
    setReport(null);
    setError(null);
    setTraceData([]);
    setPublishedSlug(null);
    // Clear /reports/:slug from URL if present
    if (window.location.pathname.startsWith("/reports/")) {
      window.history.pushState(null, "", "/");
    }
  };

  if (state === "done" && report) {
    return <Report_ data={report} traceData={traceData} onBack={handleReset} publishedSlug={publishedSlug} />;
  }

  if (state === "loading-published") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 24px",
        }}
      >
        <div style={{ fontSize: 14, color: "#8a8ca5", fontWeight: 500 }}>Loading report...</div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: state === "idle" ? "center" : "flex-start",
        padding: "60px 24px",
        transition: "all 0.3s",
      }}
    >
      {/* Logo */}
      <div style={{ marginBottom: state === "idle" ? 40 : 24, textAlign: "center" }}>
        <h1
          style={{
            fontSize: state === "idle" ? 42 : 28,
            fontWeight: 800,
            letterSpacing: -1,
            color: "#1a1a2e",
            transition: "font-size 0.3s",
          }}
        >
          Doubly
          <span style={{ color: "#b45309" }}>AI</span>
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "#8a8ca5",
            marginTop: 6,
            fontWeight: 500,
          }}
        >
          Explainable Research Reports
        </p>
      </div>

      {/* Query Input */}
      <QueryInput
        onSubmit={handleGenerate}
        disabled={state === "loading"}
        reasoningLevel={reasoningLevel}
        onReasoningLevelChange={setReasoningLevel}
      />

      {/* Progress */}
      {state === "loading" && (
        <>
          <ProgressStream steps={progress} traceData={traceData} error={error} />
          <button
            onClick={handleReset}
            style={{
              marginTop: 16,
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
            Cancel
          </button>
        </>
      )}

      {/* Error */}
      {state === "error" && (
        <>
          {/* Show all intermediate progress/trace data accumulated before error */}
          {progress.length > 0 && (
            <ProgressStream steps={progress} traceData={traceData} error={error} />
          )}
          <div
            style={{
              marginTop: 24,
              padding: "16px 24px",
              background: "#b91c1c0a",
              border: "1px solid #b91c1c30",
              borderRadius: 6,
              maxWidth: 700,
              width: "100%",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "#b91c1c", marginBottom: 4 }}>
              Generation Failed{error?.detail?.stage ? ` (stage: ${error.detail.stage})` : ""}
            </div>
            <div style={{ fontSize: 13, color: "#555770" }}>
              {typeof error === "string" ? error : error?.message}
            </div>
            {error?.detail && (
              <pre
                style={{
                  marginTop: 8,
                  padding: "10px 12px",
                  background: "#f8f8fa",
                  border: "1px solid #e2e4ea",
                  borderRadius: 4,
                  fontSize: 11,
                  color: "#333",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 200,
                  overflow: "auto",
                  fontFamily: "monospace",
                }}
              >
                {JSON.stringify(error.detail, null, 2)}
              </pre>
            )}
            <button
              onClick={handleReset}
              style={{
                marginTop: 12,
                padding: "6px 16px",
                fontSize: 12,
                fontWeight: 600,
                border: "1px solid #e2e4ea",
                borderRadius: 4,
                background: "#fff",
                cursor: "pointer",
                color: "#1a1a2e",
              }}
            >
              Try Again
            </button>
          </div>
        </>
      )}
    </div>
  );
}
