import { useState, useRef, useEffect } from "react";
import type { ChatMessage, ProgressEvent, ErrorInfo, TraceEvent } from "../../shared/types";
import ProgressStream from "./ProgressStream";

const COLORS = {
  bg: "#f7f7fa",
  cardBg: "#ffffff",
  text: "#1a1a2e",
  textSecondary: "#555770",
  textMuted: "#8a8ca5",
  border: "#e2e4ea",
  accent: "#1a1a2e",
  green: "#15803d",
  orange: "#b45309",
  red: "#b91c1c",
  userBubble: "#1a1a2e",
  userText: "#ffffff",
  assistantBubble: "#ffffff",
} as const;

const EXAMPLES: string[] = [
  "Analyze NVIDIA (NVDA)",
  "Deep dive on Tesla's competitive position",
  "Palantir equity research report",
  "Apple financial analysis and outlook",
];

interface ReasoningLevelOption {
  value: string;
  label: string;
  description: string;
}

const REASONING_LEVELS: ReasoningLevelOption[] = [
  { value: "x-light", label: "X-Light", description: "Fastest — for testing" },
  { value: "light", label: "Light", description: "Faster — reduced scope" },
  { value: "heavy", label: "Heavy", description: "Full quality" },
  { value: "x-heavy", label: "X-Heavy", description: "Maximum depth" },
];

type SaveState = "idle" | "saving" | "saved" | "error";

interface Props {
  messages: ChatMessage[];
  isGenerating: boolean;
  liveProgress: ProgressEvent[];
  liveError: ErrorInfo | null;
  liveTraceData: TraceEvent[];
  onSend: (message: string) => void;
  onAbort: () => void;
  onNewConversation: () => void;
  reasoningLevel: string;
  onReasoningLevelChange: (level: string) => void;
  saveState?: SaveState;
}

function ProgressInline({ progress, error }: { progress: ProgressEvent[]; error: ErrorInfo | null }) {
  if (progress.length === 0 && !error) return null;

  const latest = progress[progress.length - 1];
  const percent = latest?.percent || 0;

  const stages = [
    { key: "classifying", doneKey: "classified", label: "Classifying", doneLabel: "Classified", color: "#6366f1" },
    { key: "researching", doneKey: "researched", label: "Researching", doneLabel: "Researched", color: "#0891b2" },
    { key: "synthesizing", doneKey: "synthesized", label: "Synthesizing", doneLabel: "Synthesized", color: "#059669" },
    { key: "verifying", doneKey: "verified", label: "Verifying", doneLabel: "Verified", color: "#d97706" },
  ];

  const stageMap: Record<string, ProgressEvent> = {};
  progress.forEach((s) => { stageMap[s.stage] = s; });

  return (
    <div style={{ padding: "8px 0" }}>
      {/* Mini progress bar */}
      <div style={{
        height: 2,
        background: COLORS.border,
        borderRadius: 1,
        overflow: "hidden",
        marginBottom: 8,
      }}>
        <div style={{
          height: "100%",
          width: `${percent}%`,
          background: `linear-gradient(90deg, #6366f1, #0891b2, #059669, #d97706)`,
          backgroundSize: "400% 100%",
          borderRadius: 1,
          transition: "width 0.5s ease",
        }} />
      </div>

      {/* Stage indicators */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {stages.map((stage) => {
          const isDone = !!stageMap[stage.doneKey];
          const isActive = !!stageMap[stage.key] && !isDone;
          const isPending = !stageMap[stage.key];

          return (
            <span
              key={stage.key}
              style={{
                fontSize: 10,
                fontWeight: isDone || isActive ? 600 : 400,
                color: isDone ? stage.color : isActive ? stage.color : COLORS.textMuted,
                opacity: isPending ? 0.4 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              {isDone ? "\u2713" : isActive ? "\u25CF" : "\u25CB"}
              {isDone ? stage.doneLabel : stage.label}
            </span>
          );
        })}
      </div>

      {/* Current message */}
      {latest?.message && (
        <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4, fontStyle: "italic" }}>
          {latest.message}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={{
          marginTop: 6,
          padding: "6px 8px",
          background: COLORS.red + "08",
          border: `1px solid ${COLORS.red}20`,
          borderRadius: 4,
          fontSize: 11,
          color: COLORS.red,
        }}>
          {error.message}
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({
  messages,
  isGenerating,
  liveProgress,
  liveError,
  liveTraceData,
  onSend,
  onAbort,
  onNewConversation,
  reasoningLevel,
  onReasoningLevelChange,
  saveState,
}: Props) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isEmptyConversation = messages.length === 0;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, liveProgress.length]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (trimmed.length < 3) return;
    onSend(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      width: "100%",
      background: COLORS.bg,
      borderRight: `1px solid ${COLORS.border}`,
      fontFamily: "'Inter', 'Helvetica Neue', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px",
        borderBottom: `1px solid ${COLORS.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        background: COLORS.cardBg,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1 style={{
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: -0.5,
            color: COLORS.text,
            margin: 0,
          }}>
            Doubly<span style={{ color: COLORS.orange }}>AI</span>
          </h1>
          {saveState === "saving" && (
            <span style={{ fontSize: 10, color: COLORS.textMuted, fontWeight: 500 }}>Autosaving...</span>
          )}
          {saveState === "saved" && (
            <span style={{ fontSize: 10, color: COLORS.green, fontWeight: 500 }}>Saved</span>
          )}
          {saveState === "error" && (
            <span style={{ fontSize: 10, color: COLORS.red, fontWeight: 500 }}>Save failed</span>
          )}
        </div>
        <button
          onClick={onNewConversation}
          title="New conversation"
          style={{
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 600,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 4,
            background: COLORS.cardBg,
            color: COLORS.textSecondary,
            cursor: "pointer",
          }}
        >
          + New
        </button>
      </div>

      {/* Messages area */}
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "16px 12px",
      }}>
        {/* Empty state — show when no messages */}
        {isEmptyConversation && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            gap: 16,
            padding: "0 8px",
          }}>
            <div style={{ textAlign: "center" }}>
              <p style={{
                fontSize: 13,
                color: COLORS.textMuted,
                fontWeight: 500,
                margin: "0 0 16px",
              }}>
                What should I research?
              </p>
              {/* Example chips */}
              <div style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                justifyContent: "center",
              }}>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => {
                      setInput(ex);
                      onSend(ex);
                    }}
                    style={{
                      padding: "5px 10px",
                      fontSize: 11,
                      fontWeight: 500,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 16,
                      background: COLORS.cardBg,
                      color: COLORS.textSecondary,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = COLORS.accent;
                      e.currentTarget.style.color = COLORS.accent;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = COLORS.border;
                      e.currentTarget.style.color = COLORS.textSecondary;
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              marginBottom: 12,
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            {/* Role label */}
            <span style={{
              fontSize: 9,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              color: COLORS.textMuted,
              marginBottom: 3,
              padding: "0 4px",
            }}>
              {msg.role === "user" ? "You" : "DoublyAI"}
            </span>

            {/* Message bubble */}
            <div style={{
              maxWidth: "90%",
              padding: "8px 12px",
              borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background: msg.role === "user" ? COLORS.userBubble : COLORS.assistantBubble,
              color: msg.role === "user" ? COLORS.userText : COLORS.text,
              fontSize: 13,
              lineHeight: 1.5,
              border: msg.role === "assistant" ? `1px solid ${COLORS.border}` : "none",
              whiteSpace: "pre-wrap",
            }}>
              {msg.content}
            </div>

            {/* Inline progress for past assistant messages */}
            {msg.role === "assistant" && msg.progress && msg.progress.length > 0 && (
              <div style={{ maxWidth: "90%", marginTop: 4, paddingLeft: 4 }}>
                <ProgressInline progress={msg.progress} error={msg.error || null} />
              </div>
            )}
          </div>
        ))}

        {/* Live progress for current generation — full ProgressStream with LLM details */}
        {isGenerating && (
          <div style={{ marginBottom: 12 }}>
            <ProgressStream
              steps={liveProgress}
              traceData={liveTraceData}
              error={liveError}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area — ALWAYS visible */}
      <div style={{
        flexShrink: 0,
        padding: "8px 12px 12px",
        borderTop: `1px solid ${COLORS.border}`,
        background: COLORS.cardBg,
      }}>
        {/* Reasoning level selector */}
        <div style={{
          display: "flex",
          gap: 4,
          marginBottom: 6,
          alignItems: "center",
        }}>
          <span style={{
            fontSize: 9,
            fontWeight: 600,
            color: COLORS.textMuted,
            letterSpacing: 0.3,
            textTransform: "uppercase",
          }}>
            Depth
          </span>
          {REASONING_LEVELS.map((level) => {
            const isActive = reasoningLevel === level.value;
            return (
              <button
                key={level.value}
                onClick={() => onReasoningLevelChange(level.value)}
                title={level.description}
                style={{
                  padding: "2px 8px",
                  fontSize: 9,
                  fontWeight: isActive ? 700 : 500,
                  border: isActive ? `1.5px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
                  borderRadius: 3,
                  background: isActive ? COLORS.accent : "transparent",
                  color: isActive ? "#fff" : COLORS.textMuted,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {level.label}
              </button>
            );
          })}
        </div>

        {/* Input row */}
        <div style={{
          display: "flex",
          gap: 6,
          alignItems: "flex-end",
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isEmptyConversation ? "Enter a company or research topic..." : "Ask a follow-up or give feedback..."}
            rows={1}
            style={{
              flex: 1,
              padding: "8px 12px",
              fontSize: 13,
              border: `1.5px solid ${COLORS.border}`,
              borderRadius: 8,
              background: COLORS.cardBg,
              color: COLORS.text,
              fontFamily: "inherit",
              resize: "none",
              minHeight: 36,
              maxHeight: 120,
              lineHeight: 1.4,
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 120) + "px";
            }}
          />
          {isGenerating ? (
            <button
              onClick={onAbort}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                border: `1.5px solid ${COLORS.red}40`,
                borderRadius: 8,
                background: COLORS.red + "0d",
                color: COLORS.red,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={input.trim().length < 3}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                border: "none",
                borderRadius: 8,
                background: input.trim().length < 3 ? COLORS.border : COLORS.accent,
                color: input.trim().length < 3 ? COLORS.textMuted : "#fff",
                cursor: input.trim().length < 3 ? "not-allowed" : "pointer",
                flexShrink: 0,
                transition: "all 0.15s",
              }}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
