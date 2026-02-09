import { useState, useRef, useCallback, useEffect } from "react";
import type {
  Report,
  ProgressEvent,
  TraceEvent,
  ErrorInfo,
  ErrorDetail,
  ChatMessage,
} from "../shared/types";
import ChatPanel from "./components/ChatPanel";
import ReportView from "./components/Report";
import ReportsPage from "./components/ReportsPage";
import HealthPage from "./components/HealthPage";

// ── SSE parsing ─────────────────────────────────────────────────────────────

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

// ── Routing helpers ──────────────────────────────────────────────────────────

function getSlugFromPath() {
  const match = window.location.pathname.match(/^\/reports\/([a-z0-9-]+)$/);
  return match ? match[1] : null;
}

function isReportsListRoute() {
  return window.location.pathname === "/reports" || window.location.pathname === "/reports/";
}

function isHealthRoute() {
  return window.location.pathname === "/health" || window.location.pathname === "/health/";
}

// ── Unique ID generator ──────────────────────────────────────────────────────

let msgCounter = 0;
function genId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

function genConversationId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Save state type ─────────────────────────────────────────────────────────

export type SaveState = "idle" | "saving" | "saved" | "error";

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  // Utility routes (health, reports list) — separate from main flow
  const [utilityRoute] = useState<string | null>(() => {
    if (isHealthRoute()) return "health";
    if (isReportsListRoute()) return "reports-list";
    return null;
  });

  // ── Conversation state ──────────────────────────────────────────────────────
  const [conversationId, setConversationId] = useState<string>(genConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentReport, setCurrentReport] = useState<Report | null>(null);
  const [currentTraceData, setCurrentTraceData] = useState<TraceEvent[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [liveProgress, setLiveProgress] = useState<ProgressEvent[]>([]);
  const [liveError, setLiveError] = useState<ErrorInfo | null>(null);
  const [reasoningLevel, setReasoningLevel] = useState<string>("heavy");
  const [reportVersion, setReportVersion] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // ── Save / slug state ───────────────────────────────────────────────────────
  const [slug, setSlug] = useState<string | null>(getSlugFromPath);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isLoadingSlug, setIsLoadingSlug] = useState<boolean>(!!getSlugFromPath());
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Load saved report+conversation when visiting /reports/:slug ──────────
  useEffect(() => {
    const initialSlug = getSlugFromPath();
    if (!initialSlug) return;

    const params = new URLSearchParams(window.location.search);
    const version = params.get("v");
    const url = `/api/reports/${initialSlug}${version ? `?v=${version}` : ""}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Report not found" : `Error ${res.status}`);
        return res.json();
      })
      .then((data: { report: Report; messages?: ChatMessage[]; version: number }) => {
        if (data.report) setCurrentReport(data.report);
        if (data.messages && data.messages.length > 0) setMessages(data.messages);
        if (data.version) setReportVersion(data.version);
        setSlug(initialSlug);
        setSaveState("saved");
        setIsLoadingSlug(false);
      })
      .catch((err: Error) => {
        setLoadError(err.message || "Failed to load report");
        setIsLoadingSlug(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save helper ────────────────────────────────────────────────────────
  const autoSave = useCallback(async (report: Report, allMessages: ChatMessage[], currentSlug: string | null): Promise<string | null> => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/reports/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report,
          slug: currentSlug || undefined,
          messages: allMessages,
        }),
      });
      if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`);
      }
      const result = await res.json() as { slug: string; version: number; url: string };
      setSaveState("saved");

      // If this is the first save, navigate to the report URL
      if (!currentSlug) {
        setSlug(result.slug);
        window.history.pushState(null, "", result.url);
      }

      return result.slug;
    } catch (err) {
      console.error("Auto-save error:", err);
      setSaveState("error");
      return currentSlug;
    }
  }, []);

  const handleNewConversation = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setConversationId(genConversationId());
    setMessages([]);
    setCurrentReport(null);
    setCurrentTraceData([]);
    setIsGenerating(false);
    setLiveProgress([]);
    setLiveError(null);
    setReportVersion(0);
    setSlug(null);
    setSaveState("idle");
    setLoadError(null);
    window.history.pushState(null, "", "/");
  }, []);

  const handleAbort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsGenerating(false);

    // Add an assistant message noting the abort
    setMessages((prev) => [
      ...prev,
      {
        id: genId(),
        role: "assistant" as const,
        content: "Generation stopped.",
        timestamp: Date.now(),
        progress: liveProgress,
        error: null,
      },
    ]);
    setLiveProgress([]);
    setLiveError(null);
  }, [liveProgress]);

  const handleSend = useCallback(async (userMessage: string) => {
    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Add user message
    const userMsg: ChatMessage = {
      id: genId(),
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // Reset live state
    setIsGenerating(true);
    setLiveProgress([]);
    setLiveError(null);

    const newVersion = reportVersion + 1;

    // Local flags to avoid stale closure over React state
    let receivedReport = false;
    let receivedError = false;
    let finalReport: Report | null = null;
    let collectedProgress: ProgressEvent[] = [];
    let collectedTraceData: TraceEvent[] = [];
    let collectedError: ErrorInfo | null = null;

    try {
      // Build message history for context
      const messageHistory = messages
        .concat(userMsg)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userMessage,
          conversationId,
          messageHistory,
          previousReport: currentReport,
          reasoningLevel,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error: ${res.status}`);
      }

      if (!res.body) {
        throw new Error("Empty response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEventPayload = (eventType: string, payload: unknown): void => {
        if (eventType === "progress") {
          const evt = payload as ProgressEvent;
          collectedProgress = [...collectedProgress, evt];
          setLiveProgress((prev) => [...prev, evt]);
          return;
        }

        if (eventType === "trace") {
          const evt = payload as TraceEvent;
          collectedTraceData = [...collectedTraceData, evt];
          setCurrentTraceData((prev) => [...prev, evt]);
          return;
        }

        const data = payload as Record<string, unknown> | null | undefined;

        if (eventType === "error" || (eventType === "message" && typeof data?.error === "string")) {
          receivedError = true;
          collectedError = {
            message: (data?.message as string) || (data?.error as string) || "Report generation failed.",
            detail: (data?.detail as ErrorDetail) || null,
          };
          setLiveError(collectedError);
          return;
        }

        if (eventType === "report" || (eventType === "message" && isReportPayload(payload))) {
          receivedReport = true;
          finalReport = payload as Report;
          setCurrentReport(finalReport);
          setReportVersion(newVersion);
          return;
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

      // Done — add assistant message and auto-save
      setIsGenerating(false);
      setLiveProgress([]);
      setLiveError(null);

      if (receivedReport && finalReport) {
        const assistantMsg: ChatMessage = {
          id: genId(),
          role: "assistant" as const,
          content: `Report ${newVersion > 1 ? `updated (v${newVersion})` : "generated"} successfully.`,
          timestamp: Date.now(),
          reportVersion: newVersion,
          progress: collectedProgress,
          traceData: collectedTraceData,
        };
        const allMessages = [...messages, userMsg, assistantMsg];
        setMessages(allMessages);

        // Auto-save report + conversation
        autoSave(finalReport, allMessages, slug);
      } else if (receivedError) {
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: "assistant" as const,
            content: collectedError?.message || "An error occurred.",
            timestamp: Date.now(),
            progress: collectedProgress,
            error: collectedError,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: "assistant" as const,
            content: "Pipeline completed without producing a report.",
            timestamp: Date.now(),
            progress: collectedProgress,
            error: { message: "No report produced", detail: null },
          },
        ]);
      }
    } catch (rawErr: unknown) {
      if (rawErr instanceof Error && rawErr.name === "AbortError") return;

      const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr));

      const isNetworkError =
        rawErr instanceof TypeError &&
        /load failed|failed to fetch|network/i.test(err.message);

      const message = isNetworkError
        ? "Connection to the server was lost. Please try again."
        : err.message || "An unknown error occurred.";

      setIsGenerating(false);
      setLiveProgress([]);
      setLiveError(null);

      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: "assistant" as const,
          content: message,
          timestamp: Date.now(),
          progress: collectedProgress,
          error: { message, detail: null },
        },
      ]);
    }
  }, [conversationId, messages, currentReport, reasoningLevel, reportVersion, slug, autoSave]);

  // ── Utility routes ────────────────────────────────────────────────────────

  const handleRouteBack = () => {
    window.history.pushState(null, "", "/");
    window.location.reload();
  };

  if (utilityRoute === "health") {
    return <HealthPage onBack={handleRouteBack} />;
  }

  if (utilityRoute === "reports-list") {
    return <ReportsPage onBack={handleRouteBack} />;
  }

  // ── Loading state for /reports/:slug ───────────────────────────────────────

  if (isLoadingSlug) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 24px",
      }}>
        <div style={{ fontSize: 14, color: "#8a8ca5", fontWeight: 500 }}>Loading report...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 24px",
      }}>
        <div style={{ fontSize: 14, color: "#b91c1c", fontWeight: 500 }}>{loadError}</div>
        <button
          onClick={handleRouteBack}
          style={{
            marginTop: 16,
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
          Back
        </button>
      </div>
    );
  }

  // ── Main split-pane layout ──────────────────────────────────────────────────

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      width: "100%",
      overflow: "hidden",
      background: "#fafafa",
    }}>
      {/* Left: Chat panel */}
      <div style={{
        flex: "0 0 360px",
        minWidth: 300,
        maxWidth: 420,
        overflow: "hidden",
      }}>
        <ChatPanel
          messages={messages}
          isGenerating={isGenerating}
          liveProgress={liveProgress}
          liveError={liveError}
          onSend={handleSend}
          onAbort={handleAbort}
          onNewConversation={handleNewConversation}
          reasoningLevel={reasoningLevel}
          onReasoningLevelChange={setReasoningLevel}
          saveState={saveState}
        />
      </div>

      {/* Right: Report panel (or empty state) */}
      <div style={{
        flex: 1,
        overflow: "hidden",
        display: "flex",
      }}>
        {currentReport ? (
          <ReportView
            data={currentReport}
            traceData={currentTraceData}
            onBack={handleNewConversation}
            slug={slug}
            saveState={saveState}
          />
        ) : (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#8a8ca5",
            fontFamily: "'Inter', 'Helvetica Neue', system-ui, sans-serif",
          }}>
            <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: -2, color: "#1a1a2e", marginBottom: 8 }}>
              Doubly<span style={{ color: "#b45309" }}>AI</span>
            </div>
            <p style={{ fontSize: 14, fontWeight: 500, maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
              {isGenerating
                ? "Generating your research report..."
                : "Start a conversation to generate an interactive research report. Ask follow-up questions to refine it."}
            </p>
            {isGenerating && (
              <div style={{
                marginTop: 24,
                width: 200,
                height: 2,
                background: "#e2e4ea",
                borderRadius: 1,
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${liveProgress.length > 0 ? liveProgress[liveProgress.length - 1].percent : 5}%`,
                  background: "linear-gradient(90deg, #6366f1, #0891b2, #059669, #d97706)",
                  backgroundSize: "400% 100%",
                  transition: "width 0.5s ease",
                }} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
