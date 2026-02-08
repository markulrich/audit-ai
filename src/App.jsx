import { useState, useRef } from "react";
import QueryInput from "./components/QueryInput.jsx";
import ProgressStream from "./components/ProgressStream.jsx";
import Report from "./components/Report.jsx";

function isReportPayload(value) {
  return (
    value &&
    typeof value === "object" &&
    value.meta &&
    typeof value.meta === "object" &&
    Array.isArray(value.sections) &&
    Array.isArray(value.findings)
  );
}

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  let eventType = "message";
  const dataLines = [];

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

export default function App() {
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [progress, setProgress] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [traceData, setTraceData] = useState([]);
  const [reasoningLevel, setReasoningLevel] = useState("heavy");
  const abortRef = useRef(null);

  const handleGenerate = async (query) => {
    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState("loading");
    setProgress([]);
    setReport(null);
    setError(null);
    setTraceData([]);

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

      const handleEventPayload = (eventType, payload) => {
        if (eventType === "progress") {
          setProgress((prev) => [...prev, payload]);
          return;
        }

        if (eventType === "trace") {
          setTraceData((prev) => [...prev, payload]);
          return;
        }

        if (eventType === "error" || (eventType === "message" && typeof payload?.error === "string")) {
          receivedError = true;
          const errorInfo = {
            message: payload?.message || payload?.error || "Report generation failed.",
            detail: payload?.detail || null,
          };
          setError(errorInfo);
          setState("error");
          return;
        }

        if (eventType === "report" || (eventType === "message" && isReportPayload(payload))) {
          receivedReport = true;
          setReport(payload);
          setState("done");
        }
      };

      const handleSerializedData = (eventType, serialized) => {
        try {
          const payload = JSON.parse(serialized);
          handleEventPayload(eventType, payload);
        } catch {
          // skip malformed JSON
        }
      };

      const flushBuffer = (force = false) => {
        const separator = /\r?\n\r?\n/g;
        let start = 0;
        let match;

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
        const { done, value } = await reader.read();
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
    } catch (err) {
      if (err.name === "AbortError") return; // User cancelled — do nothing
      setError({ message: err.message, detail: null });
      setState("error");
    }
  };

  const handleReset = () => {
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
  };

  if (state === "done" && report) {
    return <Report data={report} traceData={traceData} onBack={handleReset} />;
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
          <ProgressStream steps={progress} traceData={traceData} />
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
            <ProgressStream steps={progress} traceData={traceData} />
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
