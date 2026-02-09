/**
 * AgentWorkLog — displays the agent's execution plan and skill invocations.
 *
 * Shows:
 * - The agent's reasoning about what skills to use
 * - Each planned step with status (pending/running/completed/failed)
 * - Skill invocation details (duration, output summary)
 */

import type { AgentWorkLog as WorkLogType, AgentPlanStep, SkillInvocation } from "../../shared/types";

interface AgentWorkLogProps {
  workLog: WorkLogType | null;
}

const SKILL_LABELS: Record<string, string> = {
  classify: "Classify",
  research: "Research",
  analyze_attachment: "Analyze Attachment",
  synthesize: "Synthesize",
  verify: "Verify",
  refine_section: "Refine Section",
  draft_answer: "Draft Answer",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#8a8ca5",
  running: "#6366f1",
  completed: "#059669",
  failed: "#b91c1c",
};

const STATUS_ICONS: Record<string, string> = {
  pending: "\u25CB",  // circle outline
  running: "\u25D4",  // circle with upper right filled
  completed: "\u25CF", // filled circle
  failed: "\u2715",   // X mark
};

function StepRow({ step, index }: { step: AgentPlanStep; index: number }) {
  const color = STATUS_COLORS[step.status] || "#8a8ca5";
  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
      padding: "4px 0",
    }}>
      <span style={{
        color,
        fontSize: 10,
        fontWeight: 700,
        minWidth: 14,
        textAlign: "center",
        marginTop: 1,
      }}>
        {STATUS_ICONS[step.status] || "\u25CB"}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: step.status === "running" ? "#6366f1" : "#1a1a2e",
        }}>
          {SKILL_LABELS[step.skill] || step.skill}
        </div>
        <div style={{
          fontSize: 11,
          color: "#8a8ca5",
          marginTop: 1,
        }}>
          {step.description}
        </div>
      </div>
      <span style={{
        fontSize: 10,
        fontWeight: 500,
        color,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        flexShrink: 0,
      }}>
        {step.status}
      </span>
    </div>
  );
}

export default function AgentWorkLog({ workLog }: AgentWorkLogProps) {
  if (!workLog || (workLog.plan.length === 0 && workLog.invocations.length === 0)) {
    return null;
  }

  const completedCount = workLog.plan.filter((s) => s.status === "completed").length;
  const totalCount = workLog.plan.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div style={{
      padding: "12px 16px",
      background: "#fafafa",
      borderRadius: 8,
      border: "1px solid #e2e4ea",
      marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "#6366f1",
        }}>
          Agent Plan
        </div>
        <div style={{
          fontSize: 10,
          fontWeight: 500,
          color: "#8a8ca5",
        }}>
          {completedCount}/{totalCount} steps ({progressPct}%)
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 3,
        background: "#e2e4ea",
        borderRadius: 2,
        marginBottom: 10,
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${progressPct}%`,
          background: "linear-gradient(90deg, #6366f1, #059669)",
          transition: "width 0.3s ease",
          borderRadius: 2,
        }} />
      </div>

      {/* Reasoning */}
      {workLog.reasoning.length > 0 && (
        <div style={{
          fontSize: 11,
          color: "#8a8ca5",
          fontStyle: "italic",
          marginBottom: 8,
          lineHeight: 1.4,
        }}>
          {workLog.reasoning[workLog.reasoning.length - 1]}
        </div>
      )}

      {/* Steps */}
      <div>
        {workLog.plan.map((step, i) => (
          <StepRow key={`${step.skill}-${i}`} step={step} index={i} />
        ))}
      </div>

      {/* Invocation stats */}
      {workLog.invocations.length > 0 && (
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid #e2e4ea",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}>
          {workLog.invocations
            .filter((inv) => inv.status === "completed" && inv.durationMs)
            .map((inv, i) => (
              <div key={i} style={{
                fontSize: 10,
                color: "#8a8ca5",
              }}>
                <span style={{ fontWeight: 600 }}>
                  {SKILL_LABELS[inv.skill] || inv.skill}
                </span>
                {" "}
                {(inv.durationMs! / 1000).toFixed(1)}s
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
