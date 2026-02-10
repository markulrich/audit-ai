import { classifyDomain } from "./agents/classifier";
import { draftAnswer } from "./agents/draft-answer";
import { research } from "./agents/researcher";
import { synthesize } from "./agents/synthesizer";
import { verify } from "./agents/verifier";
import { ANTHROPIC_MODEL } from "./anthropic-client";
import { getReasoningConfig } from "./reasoning-levels";

import type {
  SendFn,
  PipelineError,
  TraceData,
  DomainProfile,
  EvidenceItem,
  Report,
  ReasoningConfig,
  CertaintyBuckets,
  ConversationContext,
} from "../shared/types";

/**
 * Runs the full DoublyAI pipeline with SSE progress updates.
 *
 * Stages:
 *   1. Classify — determine domain profile
 *   2. Research — gather evidence from sources
 *   3. Synthesize — draft findings + report structure
 *   4. Verify — adversarial review, add contrary evidence, assign certainty
 *
 * When conversationContext is provided, agents receive the previous report
 * and message history so they can build on prior work.
 */
export async function runPipeline(
  query: string,
  send: SendFn,
  isAborted: () => boolean = () => false,
  reasoningLevel?: string,
  conversationContext?: ConversationContext,
  preClassified?: { domainProfile: DomainProfile; trace: TraceData }
): Promise<void> {
  const pipelineStartTime: number = Date.now();
  const config: ReasoningConfig = getReasoningConfig(reasoningLevel ?? "x-light");

  send("progress", {
    stage: "config",
    message: `Reasoning level: ${config.label}`,
    percent: 0,
    detail: `${config.description} | Evidence: ${config.evidenceMinItems}+ items | Findings: ${config.totalFindings} | Model: ${config.synthesizerModel || "default"}`,
  });

  /** Tag an error with the pipeline stage it came from and emit error trace. */
  function tagError(err: PipelineError, stage: string): PipelineError {
    err.stage = stage;
    // Emit error trace so frontend can show raw LLM output for failed stages
    if (err.agentTrace || err.rawOutput) {
      send("trace", {
        stage,
        agent: stage.charAt(0).toUpperCase() + stage.slice(1),
        status: "error",
        trace: err.agentTrace || {},
        rawOutput: err.rawOutput || "",
      });
    }
    return err;
  }

  // ── Stage 1: Classify ───────────────────────────────────────────────────────
  let domainProfile: DomainProfile;
  let classifierTrace: TraceData;

  if (preClassified) {
    // Classifier was already run (e.g. from /api/classify endpoint)
    domainProfile = preClassified.domainProfile;
    classifierTrace = preClassified.trace;

    send("progress", {
      stage: "classified",
      message: `Identified ${domainProfile.companyName} (${domainProfile.ticker})`,
      percent: 10,
      domainProfile,
      detail: `Domain: ${domainProfile.domainLabel} | Ticker: ${domainProfile.ticker} | Format: ${domainProfile.outputFormat} | Focus: ${domainProfile.focusAreas.join(", ") || "general"} (pre-classified)`,
      stats: {
        model: classifierTrace.request?.model || ANTHROPIC_MODEL,
        durationMs: classifierTrace.timing?.durationMs,
        inputTokens: classifierTrace.response?.usage?.input_tokens,
        outputTokens: classifierTrace.response?.usage?.output_tokens,
      },
    });

    send("trace", {
      stage: "classifier",
      agent: "Classifier",
      trace: classifierTrace,
      intermediateOutput: domainProfile,
    });
  } else {
    send("progress", {
      stage: "classifying",
      message: "Analyzing your query...",
      percent: 5,
      detail: `Sending query to ${ANTHROPIC_MODEL} to identify domain, ticker, and focus areas`,
      substeps: [
        { text: "Extracting company name and ticker symbol", status: "active" },
        { text: "Identifying research domain", status: "pending" },
        { text: "Determining output format", status: "pending" },
        { text: "Determining focus areas", status: "pending" },
      ],
    });

    try {
      const classifierResult = await classifyDomain(query, send, config, conversationContext);
      domainProfile = classifierResult.result;
      classifierTrace = classifierResult.trace;
    } catch (err) {
      throw tagError(err as PipelineError, "classifier");
    }
    if (isAborted()) return;

    send("progress", {
      stage: "classified",
      message: `Identified ${domainProfile.companyName} (${domainProfile.ticker})`,
      percent: 10,
      domainProfile,
      detail: `Domain: ${domainProfile.domainLabel} | Ticker: ${domainProfile.ticker} | Format: ${domainProfile.outputFormat} | Focus: ${domainProfile.focusAreas.join(", ") || "general"}`,
      stats: {
        model: classifierTrace.request?.model || ANTHROPIC_MODEL,
        durationMs: classifierTrace.timing?.durationMs,
        inputTokens: classifierTrace.response?.usage?.input_tokens,
        outputTokens: classifierTrace.response?.usage?.output_tokens,
      },
    });

    send("trace", {
      stage: "classifier",
      agent: "Classifier",
      trace: classifierTrace,
      intermediateOutput: domainProfile,
    });
  }

  const isPitch = domainProfile.domain === "pitch_deck";
  const isSlides = domainProfile.outputFormat === "slide_deck";

  // ── Stage 2 & 3: Draft Answer + Research ────────────────────────────────────
  // When parallelDraftAndResearch is enabled, these run concurrently.
  // Otherwise they run sequentially (draft answer first, then research).

  const researchSubsteps = isPitch
    ? [
        { text: "Market research and TAM/SAM/SOM", status: "active" },
        { text: "Competitive intelligence", status: "active" },
        { text: "Company and product data", status: "active" },
        { text: "Traction and growth metrics", status: "active" },
        { text: "Industry trends and customer data", status: "active" },
        { text: "Risk factors and challenges", status: "active" },
      ]
    : [
        { text: "SEC filings and earnings releases", status: "active" },
        { text: "Analyst consensus and price targets", status: "active" },
        { text: "Product announcements and roadmap", status: "active" },
        { text: "Competitive positioning and market share", status: "active" },
        { text: "Industry trends and macro factors", status: "active" },
        { text: "Risk factors (regulatory, geopolitical)", status: "active" },
      ];

  let draftAnswerText: string = "";
  let draftAnswerTrace: TraceData;
  let evidence: EvidenceItem[];
  let researcherTrace: TraceData;

  if (config.parallelDraftAndResearch) {
    // Run both in parallel for speed
    send("progress", {
      stage: "researching",
      message: `Gathering evidence on ${domainProfile.companyName} (${domainProfile.ticker})...`,
      percent: 12,
      detail: `Collecting ${config.evidenceMinItems}+ data points (draft answer running in parallel). Using ${config.researcherModel || ANTHROPIC_MODEL}.`,
      substeps: researchSubsteps,
    });

    const [draftResult, researchResult] = await Promise.allSettled([
      draftAnswer(query, domainProfile, send),
      research(query, domainProfile, send, config, conversationContext),
    ]);

    // Handle draft answer (non-critical)
    if (draftResult.status === "fulfilled") {
      draftAnswerText = draftResult.value.result;
      draftAnswerTrace = draftResult.value.trace;
    } else {
      draftAnswerTrace = {};
      console.warn("Draft answer failed (non-critical):", draftResult.reason?.message);
    }

    // Handle research (critical)
    if (researchResult.status === "fulfilled") {
      evidence = researchResult.value.result;
      researcherTrace = researchResult.value.trace;
    } else {
      throw tagError(researchResult.reason as PipelineError, "researcher");
    }

    if (isAborted()) return;

    // Emit draft answer progress
    send("progress", {
      stage: "answer_drafted",
      message: "Draft answer ready",
      percent: 14,
      draftAnswer: draftAnswerText,
      stats: {
        model: draftAnswerTrace?.request?.model || "claude-haiku-4-5",
        durationMs: draftAnswerTrace?.timing?.durationMs,
        inputTokens: draftAnswerTrace?.response?.usage?.input_tokens,
        outputTokens: draftAnswerTrace?.response?.usage?.output_tokens,
      },
    });

    send("trace", {
      stage: "draft_answer",
      agent: "DraftAnswer",
      trace: draftAnswerTrace || {},
      intermediateOutput: draftAnswerText,
    });
  } else {
    // Sequential: draft answer first, then research
    send("progress", {
      stage: "drafting_answer",
      message: `Generating quick draft answer for ${domainProfile.companyName}...`,
      percent: 12,
      detail: `Fast Haiku call to produce an immediate draft answer while the full pipeline runs`,
    });

    try {
      const draftResult = await draftAnswer(query, domainProfile, send);
      draftAnswerText = draftResult.result;
      draftAnswerTrace = draftResult.trace;
    } catch (err) {
      // Draft answer is non-critical — log and continue
      draftAnswerTrace = {};
      console.warn("Draft answer failed (non-critical):", (err as Error).message);
    }
    if (isAborted()) return;

    send("progress", {
      stage: "answer_drafted",
      message: "Draft answer ready",
      percent: 14,
      draftAnswer: draftAnswerText,
      stats: {
        model: draftAnswerTrace?.request?.model || "claude-haiku-4-5",
        durationMs: draftAnswerTrace?.timing?.durationMs,
        inputTokens: draftAnswerTrace?.response?.usage?.input_tokens,
        outputTokens: draftAnswerTrace?.response?.usage?.output_tokens,
      },
    });

    send("trace", {
      stage: "draft_answer",
      agent: "DraftAnswer",
      trace: draftAnswerTrace || {},
      intermediateOutput: draftAnswerText,
    });

    send("progress", {
      stage: "researching",
      message: `Gathering evidence on ${domainProfile.companyName} (${domainProfile.ticker})...`,
      percent: 15,
      detail: `Collecting ${config.evidenceMinItems}+ data points across ${isPitch ? "market, competition, traction, and financials" : "financials, products, competition, risks, and analyst sentiment"}. Using ${config.researcherModel || ANTHROPIC_MODEL}.`,
      substeps: researchSubsteps,
    });

    try {
      const researcherResult = await research(query, domainProfile, send, config, conversationContext);
      evidence = researcherResult.result;
      researcherTrace = researcherResult.trace;
    } catch (err) {
      throw tagError(err as PipelineError, "researcher");
    }
    if (isAborted()) return;
  }

  // Compute evidence category breakdown
  const categoryCounts: Record<string, number> = {};
  if (Array.isArray(evidence)) {
    evidence.forEach((e: EvidenceItem) => {
      const cat: string = e.category || "uncategorized";
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
  }

  send("progress", {
    stage: "researched",
    message: `Gathered ${Array.isArray(evidence) ? evidence.length : 0} evidence items`,
    percent: 40,
    detail: Object.entries(categoryCounts)
      .map(([cat, count]: [string, number]) => `${cat.replace(/_/g, " ")}: ${count}`)
      .join(" | "),
    stats: {
      model: researcherTrace.request?.model || ANTHROPIC_MODEL,
      durationMs: researcherTrace.timing?.durationMs,
      inputTokens: researcherTrace.response?.usage?.input_tokens,
      outputTokens: researcherTrace.response?.usage?.output_tokens,
      evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
    },
    evidencePreview: Array.isArray(evidence)
      ? evidence.slice(0, 5).map((e: EvidenceItem) => ({
          source: e.source,
          category: e.category,
          quote: e.quote?.slice(0, 100) + (e.quote?.length > 100 ? "..." : ""),
        }))
      : [],
  });

  send("trace", {
    stage: "researcher",
    agent: "Researcher",
    trace: researcherTrace,
    intermediateOutput: evidence,
  });

  // ── Stage 3: Synthesize ─────────────────────────────────────────────────────
  const synthesisMessage = isSlides ? "Designing slides..." : "Drafting findings and report structure...";
  const synthesisSubsteps = isPitch
    ? [
        { text: "Problem and solution slides", status: "active" },
        { text: "Market opportunity and business model", status: "active" },
        { text: "Traction and competitive landscape", status: "active" },
        { text: "Team, financials, and funding ask", status: "active" },
        { text: isSlides ? "Formatting findings as bullet points" : "Weaving findings into natural prose", status: "active" },
      ]
    : [
        { text: "Investment thesis", status: "active" },
        { text: "Price action and financial performance", status: "active" },
        { text: "Product, technology, and competitive landscape", status: "active" },
        { text: "Industry trends, risks, and analyst consensus", status: "active" },
        { text: isSlides ? "Formatting findings as bullet points" : "Weaving findings into natural prose", status: "active" },
      ];

  const sectionCount = isPitch ? 10 : 8;

  send("progress", {
    stage: "synthesizing",
    message: synthesisMessage,
    percent: 50,
    detail: `Transforming ${Array.isArray(evidence) ? evidence.length : 0} evidence items into ${isSlides ? "slide deck" : "structured equity research report"} with ${config.synthesizerModel || ANTHROPIC_MODEL}. Target: ${config.totalFindings} findings across ${sectionCount} ${isSlides ? "slides" : "sections"}.`,
    substeps: synthesisSubsteps,
  });

  let draft: Report;
  let synthesizerTrace: TraceData;
  try {
    const synthesizerResult = await synthesize(query, domainProfile, evidence, send, config, conversationContext);
    draft = synthesizerResult.result;
    synthesizerTrace = synthesizerResult.trace;
  } catch (err) {
    throw tagError(err as PipelineError, "synthesizer");
  }
  if (isAborted()) return;

  // Compute section breakdown
  const sectionBreakdown: string[] = (draft.sections || []).map((s) => {
    const findingCount: number = (s.content || []).filter(
      (c) => c.type === "finding"
    ).length;
    return `${s.title || s.id}: ${findingCount}`;
  });

  send("progress", {
    stage: "synthesized",
    message: `Drafted ${draft.findings?.length || 0} findings across ${draft.sections?.length || 0} ${isSlides ? "slides" : "sections"}`,
    percent: 70,
    detail: sectionBreakdown.join(" | "),
    stats: {
      model: synthesizerTrace.request?.model || ANTHROPIC_MODEL,
      durationMs: synthesizerTrace.timing?.durationMs,
      inputTokens: synthesizerTrace.response?.usage?.input_tokens,
      outputTokens: synthesizerTrace.response?.usage?.output_tokens,
      findingsCount: draft.findings?.length || 0,
      sectionsCount: draft.sections?.length || 0,
      rating: draft.meta?.rating,
    },
  });

  send("trace", {
    stage: "synthesizer",
    agent: "Synthesizer",
    trace: synthesizerTrace,
    intermediateOutput: draft,
  });

  // ── Stage 4: Verify ─────────────────────────────────────────────────────────
  let report: Report;
  let verifierTrace: TraceData;
  let removedCount: number;

  if (config.skipVerifier) {
    // Skip the verifier LLM call — assign default certainty scores programmatically.
    // This keeps ALL findings (no LLM can remove them) and saves an entire round-trip.
    const DEFAULT_CERTAINTY = 75;

    report = {
      ...draft,
      findings: (draft.findings || []).map((f) => ({
        ...f,
        certainty: f.certainty || DEFAULT_CERTAINTY,
        explanation: {
          ...f.explanation,
          contraryEvidence: f.explanation?.contraryEvidence || [],
        },
      })),
    };

    if (!report.meta) report.meta = {} as Report["meta"];
    const findingsLen = report.findings.length;
    report.meta.overallCertainty = findingsLen > 0
      ? Math.round(report.findings.reduce((s, f) => s + (f.certainty || DEFAULT_CERTAINTY), 0) / findingsLen)
      : 0;
    report.meta.methodology = {
      explanation: {
        title: "Report Generation Methodology",
        text: "This report was generated using AI analysis without adversarial verification (x-light mode).",
        supportingEvidence: [{ source: "AI Pipeline", quote: "Generated via classifier, researcher, and synthesizer agents", url: "internal" }],
        contraryEvidence: [{ source: "AI Limitations", quote: "AI-generated content may contain inaccuracies. Not financial advice.", url: "general" }],
      },
    };

    removedCount = 0;
    verifierTrace = {
      timing: { durationMs: 0 },
      parsedOutput: { skipped: true, reason: "skipVerifier enabled" },
    };

    send("progress", {
      stage: "verified",
      message: `Assigned default certainty to ${findingsLen} findings (verifier skipped)`,
      percent: 95,
      detail: `Verifier skipped for speed — all ${findingsLen} findings kept with default ${DEFAULT_CERTAINTY}% certainty`,
      stats: {
        findingsCount: findingsLen,
        avgCertainty: report.meta.overallCertainty,
        removedCount: 0,
      },
    });

    send("trace", {
      stage: "verifier",
      agent: "Verifier",
      trace: verifierTrace,
      intermediateOutput: null,
    });
  } else {
    send("progress", {
      stage: "verifying",
      message: `Adversarially verifying ${draft.findings?.length || 0} findings...`,
      percent: 75,
      detail: `Challenging every claim against known facts. Assigning certainty scores (25-99%), adding contrary evidence, removing unverifiable findings (<25%). Using ${config.verifierModel || ANTHROPIC_MODEL}.`,
      substeps: [
        { text: "Cross-checking financial numbers", status: "active" },
        { text: "Validating dates and fiscal calendars", status: "active" },
        { text: "Scoring source authority", status: "active" },
        { text: "Finding contradictions and caveats", status: "active" },
        { text: "Removing weak findings (<25% certainty)", status: "active" },
      ],
    });

    try {
      const verifierResult = await verify(query, domainProfile, draft, send, config, conversationContext);
      report = verifierResult.result;
      verifierTrace = verifierResult.trace;
    } catch (err) {
      throw tagError(err as PipelineError, "verifier");
    }
    if (isAborted()) return;

    const findingsCount: number = report.findings?.length || 0;
    const avgCertainty: number =
      findingsCount > 0
        ? Math.round(
            report.findings.reduce((s: number, f) => s + (f.certainty || 0), 0) /
              findingsCount
          )
        : 0;

    removedCount = (draft.findings?.length || 0) - findingsCount;
    const certaintyBuckets: CertaintyBuckets = { high: 0, moderate: 0, mixed: 0, weak: 0 };
    (report.findings || []).forEach((f) => {
      const c = f.certainty ?? 0;
      if (c >= 90) certaintyBuckets.high++;
      else if (c >= 70) certaintyBuckets.moderate++;
      else if (c >= 50) certaintyBuckets.mixed++;
      else certaintyBuckets.weak++;
    });

    send("progress", {
      stage: "verified",
      message: `Verified ${findingsCount} findings — avg certainty ${avgCertainty}%`,
      percent: 95,
      detail: `High (90%+): ${certaintyBuckets.high} | Moderate (70-89%): ${certaintyBuckets.moderate} | Mixed (50-69%): ${certaintyBuckets.mixed} | Weak (<50%): ${certaintyBuckets.weak}${removedCount > 0 ? ` | Removed: ${removedCount}` : ""}`,
      stats: {
        model: verifierTrace.request?.model || ANTHROPIC_MODEL,
        durationMs: verifierTrace.timing?.durationMs,
        inputTokens: verifierTrace.response?.usage?.input_tokens,
        outputTokens: verifierTrace.response?.usage?.output_tokens,
        findingsCount,
        avgCertainty,
        removedCount,
        certaintyBuckets,
      },
    });

    send("trace", {
      stage: "verifier",
      agent: "Verifier",
      trace: verifierTrace,
      intermediateOutput: null, // final report sent separately
    });
  }

  // Ensure outputFormat is set on the final report
  if (!report.meta) report.meta = {} as Report["meta"];
  report.meta.outputFormat = domainProfile.outputFormat;

  const findingsCount: number = report.findings?.length || 0;
  const avgCertainty: number =
    findingsCount > 0
      ? Math.round(
          report.findings.reduce((s: number, f) => s + (f.certainty || 0), 0) /
            findingsCount
        )
      : 0;

  // ── Stage 5: Deliver ────────────────────────────────────────────────────────
  const pipelineDurationMs: number = Date.now() - pipelineStartTime;

  send("trace", {
    stage: "pipeline_summary",
    agent: "Pipeline",
    trace: {
      timing: { durationMs: pipelineDurationMs },
    },
    intermediateOutput: {
      query,
      totalStages: config.skipVerifier ? 4 : 5,
      totalFindings: findingsCount,
      avgCertainty,
    },
  });

  send("report", report);
}
