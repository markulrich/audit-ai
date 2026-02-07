import { useState, useRef } from "react";
import QueryInput from "./components/QueryInput.jsx";
import ProgressStream from "./components/ProgressStream.jsx";
import Report from "./components/Report.jsx";

export default function App() {
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [progress, setProgress] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
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

    // Local flags to avoid stale closure over React state
    let receivedReport = false;
    let receivedError = false;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "progress") {
                setProgress((prev) => [...prev, data]);
              } else if (eventType === "report") {
                receivedReport = true;
                setReport(data);
                setState("done");
              } else if (eventType === "error") {
                receivedError = true;
                setError(data.message);
                setState("error");
              }
            } catch {
              // skip malformed JSON
            }
            eventType = null;
          }
        }
      }

      // If stream ended without a report or error event
      if (!receivedReport && !receivedError) {
        setState("error");
        setError("Pipeline completed without producing a report.");
      }
    } catch (err) {
      if (err.name === "AbortError") return; // User cancelled — do nothing
      setError(err.message);
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
  };

  if (state === "done" && report) {
    return <Report data={report} onBack={handleReset} />;
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
      />

      {/* Progress */}
      {state === "loading" && (
        <ProgressStream steps={progress} />
      )}

      {/* Error */}
      {state === "error" && (
        <div
          style={{
            marginTop: 24,
            padding: "16px 24px",
            background: "#b91c1c0a",
            border: "1px solid #b91c1c30",
            borderRadius: 6,
            maxWidth: 600,
            width: "100%",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#b91c1c", marginBottom: 4 }}>
            Generation Failed
          </div>
          <div style={{ fontSize: 13, color: "#555770" }}>{error}</div>
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
      )}
    </div>
  );
}
