/**
 * Worker Process — runs on a dedicated Fly Machine for each report.
 *
 * This is the entry point when a machine is spun up for a report job.
 * It implements a Claude tool_use agent loop where Claude decides which
 * "skills" (tools) to invoke to build the report.
 *
 * Flow:
 * 1. Load job config from S3 (query, attachments, conversation context)
 * 2. Define tools (skills) for Claude's tool_use
 * 3. Run the agent loop: Claude plans → calls tools → builds report
 * 4. Save progress and final report to S3
 * 5. Expose a small HTTP API for the main server to poll progress
 * 6. Auto-exit when done
 *
 * The agent loop uses Anthropic's native tool_use feature:
 *   - Each skill is registered as a tool with a JSON schema
 *   - Claude receives the tools and decides which to call
 *   - Results are fed back to Claude for the next iteration
 *   - This continues until Claude produces the final report
 */

import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import type {
  Report,
  ReportJob,
  DomainProfile,
  EvidenceItem,
  Attachment,
  ProgressEvent,
  TraceEvent,
  AgentWorkLog,
  SkillInvocation,
  ReasoningConfig,
} from "../shared/types";
import { getJobState, putJobState } from "./storage";
import { getReasoningConfig } from "./reasoning-levels";
import { classifyDomain } from "./agents/classifier";
import { draftAnswer } from "./agents/draft-answer";
import { research } from "./agents/researcher";
import { synthesize } from "./agents/synthesizer";
import { verify } from "./agents/verifier";
import { saveReport } from "./storage";

const JOB_ID = process.env.JOB_ID!;
const REPORT_SLUG = process.env.REPORT_SLUG!;
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8080", 10);

if (!JOB_ID || !REPORT_SLUG) {
  console.error("[worker] Missing JOB_ID or REPORT_SLUG environment variables");
  process.exit(1);
}

// ── Worker state ────────────────────────────────────────────────────────────

interface WorkerState {
  status: "initializing" | "running" | "completed" | "failed";
  progress: ProgressEvent[];
  traceEvents: TraceEvent[];
  workLog: AgentWorkLog;
  currentReport: Report | null;
  error: string | null;
}

const state: WorkerState = {
  status: "initializing",
  progress: [],
  traceEvents: [],
  workLog: { plan: [], invocations: [], reasoning: [] },
  currentReport: null,
  error: null,
};

// ── Claude Tool Definitions ─────────────────────────────────────────────────

const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "classify_query",
    description:
      "Classify the user's research query to identify the domain (equity_research, pitch_deck), " +
      "company/ticker, output format (written_report, slide_deck), and focus areas. " +
      "Call this first to understand what kind of report to generate.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The user's research query" },
      },
      required: ["query"],
    },
  },
  {
    name: "research_evidence",
    description:
      "Gather comprehensive evidence and data points from authoritative sources. " +
      "Returns structured evidence items with sources, quotes, URLs, and categories. " +
      "Should gather 20-60 evidence items depending on reasoning level.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The research query" },
        focus_areas: {
          type: "array",
          items: { type: "string" },
          description: "Specific areas to focus research on",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "analyze_attachment",
    description:
      "Extract data points, insights, and evidence from an uploaded file attachment. " +
      "Call this for each attachment before synthesizing the report.",
    input_schema: {
      type: "object" as const,
      properties: {
        attachment_id: { type: "string", description: "The attachment ID" },
        filename: { type: "string", description: "The filename" },
        content: {
          type: "string",
          description: "The extracted text content of the file",
        },
      },
      required: ["attachment_id", "filename", "content"],
    },
  },
  {
    name: "generate_draft_answer",
    description:
      "Generate a quick 2-4 paragraph preliminary answer to show the user while " +
      "the full report is being built. Call this early in the process.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The user's query" },
      },
      required: ["query"],
    },
  },
  {
    name: "synthesize_report",
    description:
      "Draft the full structured report with findings, sections, and content arrays " +
      "from the gathered evidence. Each finding has explanations with supporting evidence.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The original query" },
        evidence_summary: {
          type: "string",
          description: "Summary of key evidence gathered",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "verify_report",
    description:
      "Adversarially fact-check the report: lower certainty scores, add contrary evidence, " +
      "remove weak claims (certainty < 25%). Assigns final certainty scores to each finding.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The original query" },
      },
      required: ["query"],
    },
  },
  {
    name: "refine_section",
    description:
      "Improve a specific section of the report based on feedback or new evidence.",
    input_schema: {
      type: "object" as const,
      properties: {
        section_id: { type: "string", description: "The section ID to refine" },
        feedback: { type: "string", description: "What to improve" },
      },
      required: ["section_id", "feedback"],
    },
  },
  {
    name: "finalize_report",
    description:
      "Mark the report as complete. Call this when all findings have been verified " +
      "and the report is ready for delivery.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of the completed report",
        },
      },
      required: ["summary"],
    },
  },
];

// ── Tool execution ──────────────────────────────────────────────────────────

/** Accumulated data from tool executions */
let domainProfile: DomainProfile | null = null;
let evidence: EvidenceItem[] = [];
let draftReport: Report | null = null;
let finalReport: Report | null = null;
let config: ReasoningConfig;
let jobData: ReportJob;

function emitProgress(event: ProgressEvent): void {
  state.progress.push(event);
  // Persist progress to S3 periodically
  persistState().catch(() => {});
}

function emitTrace(trace: TraceEvent): void {
  state.traceEvents.push(trace);
}

type ToolResult = string;

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolResult> {
  const invocation: SkillInvocation = {
    skill: toolName as SkillInvocation["skill"],
    input: toolInput,
    startedAt: new Date().toISOString(),
    status: "running",
  };

  const startTime = Date.now();

  try {
    let result: string;

    switch (toolName) {
      case "classify_query": {
        emitProgress({
          stage: "classifying",
          message: "Classifying research query...",
          percent: 5,
        });

        const classResult = await classifyDomain(
          toolInput.query as string,
          (event, data) => {
            emitProgress(data as ProgressEvent);
          },
          config
        );

        domainProfile = classResult.result;
        emitTrace({
          stage: "classifier",
          agent: "Classifier",
          trace: classResult.trace,
          intermediateOutput: domainProfile,
        });

        emitProgress({
          stage: "classified",
          message: `Identified ${domainProfile.companyName} (${domainProfile.ticker})`,
          percent: 10,
          domainProfile,
        });

        result = JSON.stringify({
          domain: domainProfile.domain,
          ticker: domainProfile.ticker,
          companyName: domainProfile.companyName,
          outputFormat: domainProfile.outputFormat,
          focusAreas: domainProfile.focusAreas,
          sections: domainProfile.sections,
        });
        break;
      }

      case "research_evidence": {
        if (!domainProfile) {
          return "Error: Must classify query first before researching";
        }

        emitProgress({
          stage: "researching",
          message: "Gathering evidence from sources...",
          percent: 20,
        });

        const researchResult = await research(
          toolInput.query as string,
          domainProfile,
          (event, data) => {
            if (event === "progress") emitProgress(data as ProgressEvent);
          },
          config,
          jobData.conversationContext
        );

        evidence = researchResult.result;
        emitTrace({
          stage: "researcher",
          agent: "Researcher",
          trace: researchResult.trace,
        });

        emitProgress({
          stage: "researched",
          message: `Gathered ${evidence.length} evidence items`,
          percent: 45,
          stats: { evidenceCount: evidence.length },
        });

        result = `Gathered ${evidence.length} evidence items from sources including: ${evidence
          .slice(0, 5)
          .map((e) => e.source)
          .join(", ")}`;
        break;
      }

      case "analyze_attachment": {
        const content = toolInput.content as string;
        const filename = toolInput.filename as string;

        emitProgress({
          stage: "analyzing_attachment",
          message: `Analyzing ${filename}...`,
          percent: 15,
        });

        // Parse extracted evidence from the attachment content
        // (The actual analysis was done during upload — here we just add to pool)
        evidence.push({
          source: `Uploaded: ${filename}`,
          quote: content.slice(0, 500),
          url: "uploaded",
          category: "primary_source",
          authority: "primary_source",
        });

        result = `Analyzed ${filename}: extracted content added to evidence pool (${evidence.length} total items)`;
        break;
      }

      case "generate_draft_answer": {
        if (!domainProfile) {
          return "Error: Must classify query first";
        }

        const draftResult = await draftAnswer(
          toolInput.query as string,
          domainProfile,
          (event, data) => {
            if (event === "progress") emitProgress(data as ProgressEvent);
          }
        );

        emitProgress({
          stage: "answer_drafted",
          message: "Draft answer ready",
          percent: 12,
          draftAnswer: draftResult.result,
        });

        result = `Draft answer generated: ${(draftResult.result as string).slice(0, 200)}...`;
        break;
      }

      case "synthesize_report": {
        if (!domainProfile) {
          return "Error: Must classify query first";
        }
        if (evidence.length === 0) {
          return "Error: No evidence gathered yet — run research_evidence first";
        }

        emitProgress({
          stage: "synthesizing",
          message: "Drafting findings and report structure...",
          percent: 55,
        });

        const synthResult = await synthesize(
          toolInput.query as string,
          domainProfile,
          evidence,
          (event, data) => {
            if (event === "progress") emitProgress(data as ProgressEvent);
          },
          config,
          jobData.conversationContext
        );

        draftReport = synthResult.result;
        state.currentReport = draftReport;
        emitTrace({
          stage: "synthesizer",
          agent: "Synthesizer",
          trace: synthResult.trace,
        });

        emitProgress({
          stage: "synthesized",
          message: `Draft report: ${draftReport.findings.length} findings across ${draftReport.sections.length} sections`,
          percent: 75,
          stats: {
            findingsCount: draftReport.findings.length,
            sectionsCount: draftReport.sections.length,
          },
        });

        result = `Report drafted: ${draftReport.findings.length} findings, ${draftReport.sections.length} sections`;
        break;
      }

      case "verify_report": {
        if (!domainProfile) {
          return "Error: Must classify query first";
        }
        if (!draftReport) {
          return "Error: No draft report — run synthesize_report first";
        }

        emitProgress({
          stage: "verifying",
          message: "Adversarial verification and certainty scoring...",
          percent: 80,
        });

        const verifyResult = await verify(
          toolInput.query as string,
          domainProfile,
          draftReport,
          (event, data) => {
            if (event === "progress") emitProgress(data as ProgressEvent);
          },
          config,
          jobData.conversationContext
        );

        finalReport = verifyResult.result;
        // Ensure outputFormat is set
        if (!finalReport.meta) finalReport.meta = {} as Report["meta"];
        finalReport.meta.outputFormat = domainProfile.outputFormat;

        state.currentReport = finalReport;
        emitTrace({
          stage: "verifier",
          agent: "Verifier",
          trace: verifyResult.trace,
        });

        const avgCertainty =
          finalReport.findings.length > 0
            ? Math.round(
                finalReport.findings.reduce((s, f) => s + (f.certainty || 0), 0) /
                  finalReport.findings.length
              )
            : 0;

        emitProgress({
          stage: "verified",
          message: `Verified: ${finalReport.findings.length} findings, avg certainty ${avgCertainty}%`,
          percent: 95,
          stats: {
            findingsCount: finalReport.findings.length,
            avgCertainty,
          },
        });

        result = `Report verified: ${finalReport.findings.length} findings, average certainty ${avgCertainty}%`;
        break;
      }

      case "refine_section": {
        // Section refinement is handled by re-running synthesize on that section
        result = "Section refinement requested — will be implemented in follow-up iterations";
        break;
      }

      case "finalize_report": {
        const report = finalReport || draftReport;
        if (!report) {
          return "Error: No report to finalize";
        }

        emitProgress({
          stage: "complete",
          message: toolInput.summary as string,
          percent: 100,
        });

        // Save to S3
        try {
          await saveReport(report, REPORT_SLUG);
        } catch (err) {
          console.warn("[worker] Auto-save failed:", (err as Error).message);
        }

        result = `Report finalized and saved: ${toolInput.summary}`;
        break;
      }

      default:
        result = `Unknown tool: ${toolName}`;
    }

    invocation.completedAt = new Date().toISOString();
    invocation.durationMs = Date.now() - startTime;
    invocation.status = "completed";
    invocation.output = result;
    state.workLog.invocations.push(invocation);

    return result;
  } catch (err) {
    invocation.completedAt = new Date().toISOString();
    invocation.durationMs = Date.now() - startTime;
    invocation.status = "failed";
    invocation.error = (err as Error).message;
    state.workLog.invocations.push(invocation);

    return `Error in ${toolName}: ${(err as Error).message}`;
  }
}

// ── Claude Agent Loop ───────────────────────────────────────────────────────

async function runAgentLoop(): Promise<void> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 120_000,
    maxRetries: 2,
  });

  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  // Build the system prompt
  const attachmentInfo =
    jobData.attachments.length > 0
      ? `\n\nThe user has uploaded ${jobData.attachments.length} attachments:\n${jobData.attachments
          .map((a: Attachment) => `- ${a.filename} (${a.mimeType}, ${(a.sizeBytes / 1024).toFixed(1)}KB)`)
          .join("\n")}\nAnalyze each attachment before synthesizing the report.`
      : "";

  const conversationInfo =
    jobData.conversationContext?.previousReport
      ? `\n\nThis is a follow-up query. The previous report had ${jobData.conversationContext.previousReport.findings?.length || 0} findings.`
      : "";

  const systemPrompt = `You are a research report agent. Your job is to produce a comprehensive, professional-grade research report by using the tools available to you.

IMPORTANT: You must follow this workflow:
1. First, call classify_query to understand the domain and company
2. If attachments are present, call analyze_attachment for each one
3. Optionally call generate_draft_answer for a quick preview
4. Call research_evidence to gather comprehensive evidence
5. Call synthesize_report to create the structured report
6. Call verify_report for adversarial fact-checking and certainty scoring
7. Call finalize_report when the report is complete

Reasoning level: ${config.label} — ${config.description}${attachmentInfo}${conversationInfo}

Always complete the full workflow. Do not stop early.`;

  // Build the initial user message
  let userContent = `Generate a research report for: ${jobData.query}`;
  if (jobData.attachments.length > 0) {
    userContent += `\n\nAttachments to analyze:\n${jobData.attachments
      .map(
        (a: Attachment) =>
          `- ${a.filename} (${a.mimeType}): ${a.extractedText?.slice(0, 500) || "no text extracted"}`
      )
      .join("\n")}`;
  }

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userContent },
  ];

  state.workLog.reasoning.push("Starting agent loop with Claude tool_use");

  // Agent loop: Claude calls tools until it stops
  const MAX_ITERATIONS = 20;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    console.log(`[worker] Agent iteration ${iteration + 1}/${MAX_ITERATIONS}`);

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    // Process the response
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ContentBlockParam & { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        block.type === "tool_use"
    );

    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );

    // Log any text reasoning from Claude
    for (const text of textBlocks) {
      if (text.text.trim()) {
        state.workLog.reasoning.push(text.text.trim().slice(0, 500));
      }
    }

    // If no tool calls, Claude is done
    if (toolUseBlocks.length === 0) {
      state.workLog.reasoning.push("Agent completed — no more tool calls");
      break;
    }

    // Execute each tool call
    const toolResults: Anthropic.MessageParam = {
      role: "user",
      content: [],
    };

    for (const toolUse of toolUseBlocks) {
      console.log(`[worker] Executing tool: ${toolUse.name}`);
      const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);

      (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Add assistant response and tool results to messages
    messages.push({ role: "assistant", content: response.content });
    messages.push(toolResults);

    // Check stop reason
    if (response.stop_reason === "end_turn") {
      state.workLog.reasoning.push("Agent ended turn");
      break;
    }

    // Persist progress after each iteration
    await persistState();
  }
}

// ── State persistence ───────────────────────────────────────────────────────

async function persistState(): Promise<void> {
  try {
    const job = await getJobState(JOB_ID);
    if (!job) return;

    job.progress = state.progress;
    job.traceEvents = state.traceEvents;
    job.workLog = state.workLog;
    job.currentReport = state.currentReport;
    job.status = state.status === "completed" ? "completed" : state.status === "failed" ? "failed" : "running";
    job.updatedAt = new Date().toISOString();

    if (state.status === "completed" || state.status === "failed") {
      job.completedAt = new Date().toISOString();
    }
    if (state.error) {
      job.error = { message: state.error };
    }

    await putJobState(JOB_ID, job);
  } catch (err) {
    console.warn("[worker] Failed to persist state:", (err as Error).message);
  }
}

// ── Health/status HTTP API ──────────────────────────────────────────────────

const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: state.status, jobId: JOB_ID });
});

app.get("/state", (_req, res) => {
  res.json({
    status: state.status,
    jobId: JOB_ID,
    slug: REPORT_SLUG,
    progress: state.progress,
    traceEvents: state.traceEvents,
    workLog: state.workLog,
    currentReport: state.currentReport,
    error: state.error,
  });
});

// SSE endpoint for real-time progress
app.get("/events", (_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  // Replay current state
  for (const prog of state.progress) {
    res.write(`event: progress\ndata: ${JSON.stringify(prog)}\n\n`);
  }
  for (const trace of state.traceEvents) {
    res.write(`event: trace\ndata: ${JSON.stringify(trace)}\n\n`);
  }
  if (state.workLog.plan.length > 0 || state.workLog.invocations.length > 0) {
    res.write(`event: work_log\ndata: ${JSON.stringify(state.workLog)}\n\n`);
  }
  if (state.currentReport) {
    res.write(`event: report\ndata: ${JSON.stringify(state.currentReport)}\n\n`);
  }
  if (state.status === "completed") {
    res.write(`event: done\ndata: ${JSON.stringify({ success: true })}\n\n`);
    res.end();
    return;
  }
  if (state.status === "failed") {
    res.write(`event: error\ndata: ${JSON.stringify({ message: state.error })}\n\n`);
    res.end();
    return;
  }

  // For live updates, poll state changes
  const interval = setInterval(() => {
    if (state.status === "completed" || state.status === "failed") {
      if (state.currentReport) {
        res.write(`event: report\ndata: ${JSON.stringify(state.currentReport)}\n\n`);
      }
      if (state.status === "completed") {
        res.write(`event: done\ndata: ${JSON.stringify({ success: true })}\n\n`);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: state.error })}\n\n`);
      }
      clearInterval(interval);
      res.end();
    } else {
      // Heartbeat
      res.write(": heartbeat\n\n");
    }
  }, 2000);

  res.on("close", () => clearInterval(interval));
});

// ── Main entry ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[worker] Starting worker for job ${JOB_ID}, report ${REPORT_SLUG}`);

  // Start HTTP server for health checks and progress
  app.listen(WORKER_PORT, "0.0.0.0", () => {
    console.log(`[worker] Health API on port ${WORKER_PORT}`);
  });

  try {
    // Load job from S3
    const job = await getJobState(JOB_ID);
    if (!job) {
      throw new Error(`Job ${JOB_ID} not found in S3`);
    }

    jobData = job;
    config = getReasoningConfig(job.reasoningLevel || "x-light");

    state.status = "running";
    await persistState();

    // Run the Claude tool_use agent loop
    await runAgentLoop();

    // Mark as complete
    state.status = "completed";
    state.currentReport = finalReport || draftReport;
    await persistState();

    console.log("[worker] Report generation complete");

    // Give time for any connected SSE clients to receive final events
    setTimeout(() => {
      console.log("[worker] Shutting down");
      process.exit(0);
    }, 5000);
  } catch (err) {
    console.error("[worker] Fatal error:", err);
    state.status = "failed";
    state.error = (err as Error).message;
    await persistState();

    setTimeout(() => process.exit(1), 5000);
  }
}

// Graceful shutdown handler
function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    console.log(`[worker] Received ${signal}, shutting down gracefully...`);

    if (state.status === "running") {
      state.status = "failed";
      state.error = `Worker interrupted by ${signal}`;
      await persistState();
    }

    process.exit(signal === "SIGTERM" ? 0 : 1);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Only run main if this is the worker process (not imported)
if (process.env.WORKER_MODE === "true") {
  setupGracefulShutdown();
  main();
}

export { main as runWorker };
