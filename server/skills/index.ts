/**
 * Skills Registry — modular capabilities that the agent orchestrator can invoke.
 *
 * Each skill wraps one of the original pipeline agents (or adds new capabilities)
 * into a self-contained, invocable unit. The agent orchestrator decides which skills
 * to use and in what order based on the task.
 *
 * Skills:
 * - classify: Identify domain, ticker, output format
 * - research: Gather evidence from sources
 * - analyze_attachment: Extract insights from uploaded files
 * - synthesize: Draft findings and report structure
 * - verify: Adversarial fact-checking and certainty scoring
 * - refine_section: Improve a specific section based on feedback
 * - draft_answer: Quick preview answer
 */

import type {
  SkillName,
  SkillInvocation,
  SendFn,
  ReasoningConfig,
  ConversationContext,
  DomainProfile,
  EvidenceItem,
  Report,
  Attachment,
  TraceData,
} from "../../shared/types";

import { classifyDomain } from "../agents/classifier";
import { draftAnswer } from "../agents/draft-answer";
import { research } from "../agents/researcher";
import { synthesize } from "../agents/synthesizer";
import { verify } from "../agents/verifier";
import { tracedCreate } from "../anthropic-client";

// ── Skill execution context ─────────────────────────────────────────────────

export interface SkillContext {
  send: SendFn;
  config: ReasoningConfig;
  conversationContext?: ConversationContext;
  /** Accumulated state from prior skill invocations */
  state: {
    query: string;
    domainProfile?: DomainProfile;
    evidence?: EvidenceItem[];
    draft?: Report;
    report?: Report;
    attachments?: Attachment[];
    attachmentInsights?: string[];
  };
}

// ── Skill result ────────────────────────────────────────────────────────────

export interface SkillResult {
  output: unknown;
  trace?: TraceData;
}

// ── Skill definitions ───────────────────────────────────────────────────────

export type SkillFn = (
  ctx: SkillContext,
  input: Record<string, unknown>
) => Promise<SkillResult>;

const skillRegistry = new Map<SkillName, SkillFn>();

/** Register a skill */
function registerSkill(name: SkillName, fn: SkillFn): void {
  skillRegistry.set(name, fn);
}

/** Get a skill by name */
export function getSkill(name: SkillName): SkillFn | undefined {
  return skillRegistry.get(name);
}

/** List all available skills with descriptions */
export function listSkills(): Array<{ name: SkillName; description: string }> {
  return [
    { name: "classify", description: "Identify domain, company, ticker, output format from the query" },
    { name: "research", description: "Gather 40+ evidence items with sources for the identified domain" },
    { name: "analyze_attachment", description: "Extract insights and data from an uploaded file attachment" },
    { name: "synthesize", description: "Draft findings and structured report from evidence" },
    { name: "verify", description: "Adversarially fact-check findings, assign certainty scores, remove weak claims" },
    { name: "refine_section", description: "Improve a specific report section based on feedback or new evidence" },
    { name: "draft_answer", description: "Generate a quick preview answer while the full pipeline runs" },
  ];
}

/** Execute a skill and track the invocation */
export async function executeSkill(
  name: SkillName,
  ctx: SkillContext,
  input: Record<string, unknown>
): Promise<SkillInvocation> {
  const fn = getSkill(name);
  if (!fn) {
    throw new Error(`Unknown skill: ${name}`);
  }

  const invocation: SkillInvocation = {
    skill: name,
    input,
    startedAt: new Date().toISOString(),
    status: "running",
  };

  ctx.send("skill_start", { skill: name, input: Object.keys(input) });

  try {
    const startTime = Date.now();
    const result = await fn(ctx, input);
    const durationMs = Date.now() - startTime;

    invocation.completedAt = new Date().toISOString();
    invocation.durationMs = durationMs;
    invocation.status = "completed";
    invocation.output = result.output;
    invocation.trace = result.trace;

    ctx.send("skill_complete", {
      skill: name,
      durationMs,
      outputSummary: summarizeOutput(name, result.output),
    });

    return invocation;
  } catch (err) {
    invocation.completedAt = new Date().toISOString();
    invocation.status = "failed";
    invocation.error = (err as Error).message;

    ctx.send("skill_error", { skill: name, error: (err as Error).message });

    return invocation;
  }
}

function summarizeOutput(skill: SkillName, output: unknown): string {
  if (!output) return "no output";
  switch (skill) {
    case "classify": {
      const dp = output as DomainProfile;
      return `${dp.companyName} (${dp.ticker}) — ${dp.domain} / ${dp.outputFormat}`;
    }
    case "research": {
      const items = output as EvidenceItem[];
      return `${items.length} evidence items`;
    }
    case "synthesize": {
      const r = output as Report;
      return `${r.findings?.length || 0} findings, ${r.sections?.length || 0} sections`;
    }
    case "verify": {
      const r = output as Report;
      return `${r.findings?.length || 0} findings verified, avg certainty ${r.meta?.overallCertainty || "?"}%`;
    }
    case "analyze_attachment":
      return typeof output === "string" ? output.slice(0, 100) : "analyzed";
    case "refine_section":
      return "section refined";
    case "draft_answer":
      return typeof output === "string" ? output.slice(0, 80) + "..." : "draft ready";
    default:
      return "done";
  }
}

// ── Register all skills ─────────────────────────────────────────────────────

// Classify skill
registerSkill("classify", async (ctx, _input) => {
  const result = await classifyDomain(ctx.state.query, ctx.send, ctx.config, ctx.conversationContext);
  ctx.state.domainProfile = result.result;
  return { output: result.result, trace: result.trace };
});

// Draft answer skill
registerSkill("draft_answer", async (ctx, _input) => {
  if (!ctx.state.domainProfile) {
    throw new Error("Cannot draft answer without domain profile — run classify first");
  }
  const result = await draftAnswer(ctx.state.query, ctx.state.domainProfile, ctx.send);
  return { output: result.result, trace: result.trace };
});

// Research skill
registerSkill("research", async (ctx, _input) => {
  if (!ctx.state.domainProfile) {
    throw new Error("Cannot research without domain profile — run classify first");
  }
  const result = await research(
    ctx.state.query,
    ctx.state.domainProfile,
    ctx.send,
    ctx.config,
    ctx.conversationContext
  );
  ctx.state.evidence = result.result;
  return { output: result.result, trace: result.trace };
});

// Analyze attachment skill
registerSkill("analyze_attachment", async (ctx, input) => {
  const attachment = input.attachment as Attachment | undefined;
  if (!attachment) {
    throw new Error("No attachment provided");
  }

  const extractedText = attachment.extractedText || "[No text extracted]";

  // Use Claude to analyze the attachment content
  const systemPrompt = `You are an expert analyst. You have been given the contents of a file uploaded by the user as part of a research task. Extract all relevant data points, key metrics, claims, and insights that could be used in a research report.

Be specific and quantitative where possible. Format your output as a JSON array of evidence items:
[
  {
    "source": "Uploaded: ${attachment.filename}",
    "quote": "specific data point or insight",
    "url": "uploaded",
    "category": "financial_data|market_data|company_info|competitive_intel|other",
    "authority": "primary_source"
  }
]`;

  const { response, trace } = await tracedCreate({
    model: ctx.config.researcherModel || "claude-haiku-4-5",
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Analyze this file and extract evidence items:\n\nFilename: ${attachment.filename}\nType: ${attachment.mimeType}\nContent:\n${extractedText.slice(0, 50_000)}`,
      },
    ],
  });

  const responseText = response.content?.[0]?.type === "text" ? response.content[0].text : "[]";

  let insights: EvidenceItem[] = [];
  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      insights = JSON.parse(jsonMatch[0]);
    }
  } catch {
    insights = [{
      source: `Uploaded: ${attachment.filename}`,
      quote: responseText.slice(0, 500),
      url: "uploaded",
      category: "other",
      authority: "primary_source",
    }];
  }

  // Merge attachment evidence into the global evidence pool
  if (!ctx.state.evidence) ctx.state.evidence = [];
  ctx.state.evidence.push(...insights);

  if (!ctx.state.attachmentInsights) ctx.state.attachmentInsights = [];
  ctx.state.attachmentInsights.push(
    `File "${attachment.filename}": ${insights.length} data points extracted`
  );

  return { output: insights, trace };
});

// Synthesize skill
registerSkill("synthesize", async (ctx, _input) => {
  if (!ctx.state.domainProfile) {
    throw new Error("Cannot synthesize without domain profile");
  }
  if (!ctx.state.evidence || ctx.state.evidence.length === 0) {
    throw new Error("Cannot synthesize without evidence — run research first");
  }

  const result = await synthesize(
    ctx.state.query,
    ctx.state.domainProfile,
    ctx.state.evidence,
    ctx.send,
    ctx.config,
    ctx.conversationContext
  );
  ctx.state.draft = result.result;
  return { output: result.result, trace: result.trace };
});

// Verify skill
registerSkill("verify", async (ctx, _input) => {
  if (!ctx.state.domainProfile) {
    throw new Error("Cannot verify without domain profile");
  }
  if (!ctx.state.draft) {
    throw new Error("Cannot verify without draft report — run synthesize first");
  }

  const result = await verify(
    ctx.state.query,
    ctx.state.domainProfile,
    ctx.state.draft,
    ctx.send,
    ctx.config,
    ctx.conversationContext
  );
  ctx.state.report = result.result;
  return { output: result.result, trace: result.trace };
});

// Refine section skill
registerSkill("refine_section", async (ctx, input) => {
  const sectionId = input.sectionId as string;
  const feedback = input.feedback as string;
  const report = ctx.state.report || ctx.state.draft;

  if (!report) {
    throw new Error("No report to refine — run synthesize or verify first");
  }
  if (!ctx.state.domainProfile) {
    throw new Error("Cannot refine without domain profile");
  }

  const section = report.sections.find((s) => s.id === sectionId);
  if (!section) {
    throw new Error(`Section not found: ${sectionId}`);
  }

  const sectionFindings = report.findings.filter((f) => f.section === sectionId);

  const systemPrompt = `You are a research report editor. You need to improve a specific section of a ${ctx.state.domainProfile.domainLabel} report based on user feedback.

Current section: "${section.title}" (id: ${sectionId})
Current findings in this section: ${JSON.stringify(sectionFindings, null, 2)}
Current content structure: ${JSON.stringify(section.content, null, 2)}

User feedback: ${feedback}

Return a JSON object with:
{
  "updatedFindings": [...],  // Updated finding objects (same schema as input)
  "updatedContent": [...]     // Updated content array
}

Keep the same finding IDs. You may adjust text, certainty, evidence, or add/remove findings.`;

  const { response, trace } = await tracedCreate({
    model: ctx.config.synthesizerModel || "claude-haiku-4-5",
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Refine the "${section.title}" section. Feedback: ${feedback}`,
      },
    ],
  });

  const responseText = response.content?.[0]?.type === "text" ? response.content[0].text : "{}";

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const updates = JSON.parse(jsonMatch[0]);

      if (updates.updatedFindings) {
        // Replace findings for this section
        const otherFindings = report.findings.filter((f) => f.section !== sectionId);
        report.findings = [...otherFindings, ...updates.updatedFindings];
      }
      if (updates.updatedContent) {
        section.content = updates.updatedContent;
      }
    }
  } catch {
    // If parsing fails, keep original
  }

  ctx.state.report = report;
  return { output: report, trace };
});
