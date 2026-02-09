/**
 * Agent Orchestrator — LLM-driven planning and skill execution.
 *
 * The orchestrator is the "brain" of each report. Given a query and optional
 * attachments, it:
 *   1. Plans which skills to invoke (using an LLM to reason about the task)
 *   2. Executes skills in the planned order
 *   3. Adapts the plan based on intermediate results
 *   4. Saves progress after each skill so work survives disconnections
 *
 * This replaces the fixed pipeline.ts with a flexible, agent-driven approach.
 * The agent can decide to analyze attachments before researching, skip certain
 * steps, or run additional refinement passes.
 */

import type {
  SendFn,
  ReasoningConfig,
  ConversationContext,
  DomainProfile,
  Report,
  Attachment,
  AgentPlanStep,
  AgentWorkLog,
  SkillName,
  TraceData,
  PipelineError,
  CertaintyBuckets,
} from "../shared/types";

import { ANTHROPIC_MODEL, tracedCreate } from "./anthropic-client";
import { getReasoningConfig } from "./reasoning-levels";
import { executeSkill, listSkills } from "./skills/index";
import type { SkillContext } from "./skills/index";

// ── Plan generation ─────────────────────────────────────────────────────────

interface AgentPlan {
  reasoning: string;
  steps: AgentPlanStep[];
}

/**
 * Use the LLM to generate an execution plan based on the query, attachments,
 * and conversation context.
 */
async function generatePlan(
  query: string,
  attachments: Attachment[],
  conversationContext?: ConversationContext,
  preClassified?: { domainProfile: DomainProfile; trace: TraceData }
): Promise<AgentPlan> {
  const skills = listSkills();
  const skillDescriptions = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");

  const hasAttachments = attachments.length > 0;
  const isFollowUp = !!conversationContext?.previousReport;
  const isPreClassified = !!preClassified;

  const systemPrompt = `You are an AI research agent planner. Given a user query and context, you decide which skills to invoke to produce the best research report.

Available skills:
${skillDescriptions}

Rules:
1. Always start with "classify" unless pre-classified data is provided${isPreClassified ? " (PRE-CLASSIFIED — skip classify)" : ""}
2. If attachments are present, run "analyze_attachment" for each BEFORE "research" so attachment data feeds into the research
3. Always run "research" to gather external evidence
4. Run "draft_answer" in parallel with research if this is a new query (not a follow-up)
5. Always run "synthesize" after research completes
6. Always run "verify" after synthesis
7. For follow-up queries on existing reports, you may use "refine_section" instead of a full pipeline

Current context:
- Query: "${query}"
- Attachments: ${hasAttachments ? attachments.map((a) => `"${a.filename}" (${a.mimeType})`).join(", ") : "none"}
- Is follow-up: ${isFollowUp}
- Pre-classified: ${isPreClassified}
${isFollowUp ? `- Previous report had ${conversationContext?.previousReport?.findings?.length || 0} findings` : ""}

Return ONLY a JSON object:
{
  "reasoning": "Brief explanation of your plan",
  "steps": [
    { "skill": "skill_name", "description": "what this step does", "input": {}, "status": "pending" }
  ]
}`;

  try {
    const { response } = await tracedCreate({
      model: "claude-haiku-4-5",
      system: systemPrompt,
      messages: [{ role: "user", content: `Plan the execution for: ${query}` }],
    });

    const text = response.content?.[0]?.type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const plan = JSON.parse(jsonMatch[0]) as AgentPlan;
      return plan;
    }
  } catch (err) {
    console.warn("[orchestrator] Plan generation failed, using default plan:", (err as Error).message);
  }

  // Default plan if LLM planning fails
  return generateDefaultPlan(attachments, isFollowUp, isPreClassified);
}

function generateDefaultPlan(
  attachments: Attachment[],
  isFollowUp: boolean,
  isPreClassified: boolean
): AgentPlan {
  const steps: AgentPlanStep[] = [];

  if (!isPreClassified) {
    steps.push({
      skill: "classify",
      description: "Identify domain, company, and output format",
      input: {},
      status: "pending",
    });
  }

  // Analyze attachments
  for (const att of attachments) {
    steps.push({
      skill: "analyze_attachment",
      description: `Extract insights from ${att.filename}`,
      input: { attachmentId: att.id },
      status: "pending",
    });
  }

  if (!isFollowUp) {
    steps.push({
      skill: "draft_answer",
      description: "Generate quick preview answer",
      input: {},
      status: "pending",
    });
  }

  steps.push({
    skill: "research",
    description: "Gather evidence from sources",
    input: {},
    status: "pending",
  });

  steps.push({
    skill: "synthesize",
    description: "Draft findings and report structure",
    input: {},
    status: "pending",
  });

  steps.push({
    skill: "verify",
    description: "Adversarial verification and certainty scoring",
    input: {},
    status: "pending",
  });

  return {
    reasoning: "Standard pipeline: classify → attachments → draft → research → synthesize → verify",
    steps,
  };
}

// ── Orchestrator execution ──────────────────────────────────────────────────

export interface OrchestratorOptions {
  query: string;
  send: SendFn;
  isAborted?: () => boolean;
  reasoningLevel?: string;
  conversationContext?: ConversationContext;
  preClassified?: { domainProfile: DomainProfile; trace: TraceData };
  attachments?: Attachment[];
  /** Called after each skill completes with updated work log */
  onProgress?: (workLog: AgentWorkLog) => void;
}

/**
 * Run the agent orchestrator — plans and executes skills to produce a report.
 *
 * This is the main entry point that replaces runPipeline.
 * It runs as a background process: closing the SSE connection does NOT abort it.
 */
export async function runOrchestrator(opts: OrchestratorOptions): Promise<Report> {
  const {
    query,
    send,
    isAborted = () => false,
    reasoningLevel,
    conversationContext,
    preClassified,
    attachments = [],
  } = opts;

  const config = getReasoningConfig(reasoningLevel ?? "x-light");

  send("progress", {
    stage: "planning",
    message: "Agent is planning the research approach...",
    percent: 0,
    detail: `Reasoning level: ${config.label} | ${config.description}`,
  });

  // ── Generate execution plan ───────────────────────────────────────────────

  const plan = await generatePlan(query, attachments, conversationContext, preClassified);

  const workLog: AgentWorkLog = {
    plan: plan.steps,
    invocations: [],
    reasoning: [plan.reasoning],
  };

  send("work_log", workLog);
  opts.onProgress?.(workLog);

  send("progress", {
    stage: "planned",
    message: `Plan: ${plan.steps.length} steps`,
    percent: 2,
    detail: plan.reasoning,
  });

  // ── Build skill context ───────────────────────────────────────────────────

  const ctx: SkillContext = {
    send,
    config,
    conversationContext,
    state: {
      query,
      domainProfile: preClassified?.domainProfile,
      attachments,
    },
  };

  // If pre-classified, inject the trace event
  if (preClassified) {
    send("progress", {
      stage: "classified",
      message: `Identified ${preClassified.domainProfile.companyName} (${preClassified.domainProfile.ticker})`,
      percent: 10,
      domainProfile: preClassified.domainProfile,
      detail: `Domain: ${preClassified.domainProfile.domainLabel} | Format: ${preClassified.domainProfile.outputFormat} (pre-classified)`,
    });

    send("trace", {
      stage: "classifier",
      agent: "Classifier",
      trace: preClassified.trace,
      intermediateOutput: preClassified.domainProfile,
    });
  }

  // ── Execute each skill in the plan ────────────────────────────────────────

  const totalSteps = plan.steps.length;
  let report: Report | null = null;

  for (let i = 0; i < totalSteps; i++) {
    if (isAborted()) {
      send("progress", {
        stage: "aborted",
        message: "Agent stopped by user",
        percent: Math.round(((i + 1) / totalSteps) * 100),
      });
      break;
    }

    const step = plan.steps[i];
    step.status = "running";
    workLog.plan = [...plan.steps];
    send("work_log", workLog);

    const percentBase = Math.round((i / totalSteps) * 90) + 5;
    send("progress", {
      stage: `skill_${step.skill}`,
      message: step.description,
      percent: percentBase,
      detail: `Step ${i + 1}/${totalSteps}: ${step.skill}`,
    });

    // Build input from step definition + state
    const input = { ...step.input };
    if (step.skill === "analyze_attachment") {
      const attId = step.input.attachmentId as string;
      input.attachment = attachments.find((a) => a.id === attId) || attachments[i] || attachments[0];
    }

    try {
      // Per-skill timeout: 5 minutes for research/synthesize/verify, 2 minutes for others
      const timeoutMs = ["research", "synthesize", "verify"].includes(step.skill)
        ? 5 * 60 * 1000
        : 2 * 60 * 1000;

      const invocation = await Promise.race([
        executeSkill(step.skill as SkillName, ctx, input),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Skill "${step.skill}" timed out after ${timeoutMs / 1000}s`)), timeoutMs)
        ),
      ]);
      workLog.invocations.push(invocation);
      step.status = invocation.status === "completed" ? "completed" : "failed";

      // Track domain profile updates
      if (step.skill === "classify" && invocation.status === "completed") {
        ctx.state.domainProfile = invocation.output as DomainProfile;
      }

      // Track report from synthesize/verify
      if (
        (step.skill === "synthesize" || step.skill === "verify" || step.skill === "refine_section") &&
        invocation.status === "completed"
      ) {
        report = invocation.output as Report;
        // Send intermediate report to listeners
        send("report", report);
      }

      // Handle draft answer
      if (step.skill === "draft_answer" && invocation.status === "completed") {
        send("progress", {
          stage: "answer_drafted",
          message: "Draft answer ready",
          percent: percentBase + 2,
          draftAnswer: invocation.output as string,
        });
      }

      workLog.plan = [...plan.steps];
      send("work_log", workLog);
      opts.onProgress?.(workLog);
    } catch (err) {
      step.status = "failed";
      workLog.reasoning.push(`Step "${step.skill}" failed: ${(err as Error).message}`);

      // Non-critical skills (draft_answer) don't abort the pipeline
      if (step.skill === "draft_answer") {
        console.warn(`[orchestrator] Non-critical skill ${step.skill} failed:`, (err as Error).message);
        continue;
      }

      // Critical skill failure — propagate error
      const pErr = err as PipelineError;
      pErr.stage = step.skill;

      send("work_log", workLog);
      opts.onProgress?.(workLog);
      throw pErr;
    }
  }

  // ── Finalize report ───────────────────────────────────────────────────────

  if (!report && ctx.state.report) {
    report = ctx.state.report;
  }
  if (!report && ctx.state.draft) {
    report = ctx.state.draft;
  }

  if (!report) {
    throw new Error("Orchestrator completed without producing a report");
  }

  // Ensure outputFormat is set
  if (!report.meta) report.meta = {} as Report["meta"];
  if (ctx.state.domainProfile) {
    report.meta.outputFormat = ctx.state.domainProfile.outputFormat;
  }

  // Compute final stats
  const findingsCount = report.findings?.length || 0;
  const avgCertainty =
    findingsCount > 0
      ? Math.round(
          report.findings.reduce((s, f) => s + (f.certainty || 0), 0) / findingsCount
        )
      : 0;

  const certaintyBuckets: CertaintyBuckets = { high: 0, moderate: 0, mixed: 0, weak: 0 };
  (report.findings || []).forEach((f) => {
    const c = f.certainty ?? 0;
    if (c >= 90) certaintyBuckets.high++;
    else if (c >= 70) certaintyBuckets.moderate++;
    else if (c >= 50) certaintyBuckets.mixed++;
    else certaintyBuckets.weak++;
  });

  send("progress", {
    stage: "complete",
    message: `Report complete — ${findingsCount} findings, avg certainty ${avgCertainty}%`,
    percent: 100,
    detail: `High: ${certaintyBuckets.high} | Moderate: ${certaintyBuckets.moderate} | Mixed: ${certaintyBuckets.mixed} | Weak: ${certaintyBuckets.weak}`,
    stats: {
      findingsCount,
      avgCertainty,
      certaintyBuckets,
    },
  });

  workLog.reasoning.push(
    `Completed: ${findingsCount} findings, avg certainty ${avgCertainty}%, ${workLog.invocations.length} skills executed`
  );
  send("work_log", workLog);
  opts.onProgress?.(workLog);

  send("report", report);

  return report;
}
