import { classifyDomain } from "./agents/classifier.js";
import { research } from "./agents/researcher.js";
import { synthesize } from "./agents/synthesizer.js";
import { verify } from "./agents/verifier.js";
import { ANTHROPIC_MODEL } from "./anthropic-client.js";
import { getReasoningConfig } from "./reasoning-levels.js";

/**
 * Runs the full DoublyAI pipeline with SSE progress updates.
 *
 * Stages:
 *   1. Classify — determine domain profile
 *   2. Research — gather evidence from sources
 *   3. Synthesize — draft findings + report structure
 *   4. Verify — adversarial review, add contrary evidence, assign certainty
 *
 * @param {string} query - The user's research query
 * @param {Function} send - SSE event sender: send(eventName, data)
 * @param {Function} isAborted - Returns true if the client disconnected
 */
export async function runPipeline(query, send, isAborted = () => false, reasoningLevel) {
  const pipelineStartTime = Date.now();
  const config = getReasoningConfig(reasoningLevel);

  send("progress", {
    stage: "config",
    message: `Reasoning level: ${config.label}`,
    percent: 0,
    detail: `${config.description} | Evidence: ${config.evidenceMinItems}+ items | Findings: ${config.totalFindings} | Model: ${config.synthesizerModel || "default"}`,
  });

  /** Tag an error with the pipeline stage it came from and emit error trace. */
  function tagError(err, stage) {
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
  send("progress", {
    stage: "classifying",
    message: "Analyzing your query...",
    percent: 5,
    detail: `Sending query to ${ANTHROPIC_MODEL} to identify domain, ticker, and focus areas`,
    substeps: [
      { text: "Extracting company name and ticker symbol", status: "active" },
      { text: "Identifying research domain", status: "pending" },
      { text: "Determining focus areas", status: "pending" },
    ],
  });

  let domainProfile, classifierTrace;
  try {
    const classifierResult = await classifyDomain(query, send, config);
    domainProfile = classifierResult.result;
    classifierTrace = classifierResult.trace;
  } catch (err) {
    throw tagError(err, "classifier");
  }
  if (isAborted()) return;

  send("progress", {
    stage: "classified",
    message: `Identified ${domainProfile.companyName} (${domainProfile.ticker})`,
    percent: 10,
    domainProfile,
    detail: `Domain: ${domainProfile.domainLabel} | Ticker: ${domainProfile.ticker} | Focus: ${domainProfile.focusAreas.join(", ") || "general"}`,
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

  // ── Stage 2: Research ───────────────────────────────────────────────────────
  send("progress", {
    stage: "researching",
    message: `Gathering evidence on ${domainProfile.companyName} (${domainProfile.ticker})...`,
    percent: 15,
    detail: `Collecting ${config.evidenceMinItems}+ data points across financials, products, competition, risks, and analyst sentiment. Using ${config.researcherModel || ANTHROPIC_MODEL} with ${config.researcherMaxTokens.toLocaleString()} max output tokens.`,
    substeps: [
      { text: "SEC filings and earnings releases", status: "active" },
      { text: "Analyst consensus and price targets", status: "active" },
      { text: "Product announcements and roadmap", status: "active" },
      { text: "Competitive positioning and market share", status: "active" },
      { text: "Industry trends and macro factors", status: "active" },
      { text: "Risk factors (regulatory, geopolitical)", status: "active" },
    ],
  });

  let evidence, researcherTrace;
  try {
    const researcherResult = await research(query, domainProfile, send, config);
    evidence = researcherResult.result;
    researcherTrace = researcherResult.trace;
  } catch (err) {
    throw tagError(err, "researcher");
  }
  if (isAborted()) return;

  // Compute evidence category breakdown
  const categoryCounts = {};
  if (Array.isArray(evidence)) {
    evidence.forEach((e) => {
      const cat = e.category || "uncategorized";
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
  }

  send("progress", {
    stage: "researched",
    message: `Gathered ${Array.isArray(evidence) ? evidence.length : 0} evidence items`,
    percent: 40,
    detail: Object.entries(categoryCounts)
      .map(([cat, count]) => `${cat.replace(/_/g, " ")}: ${count}`)
      .join(" | "),
    stats: {
      model: researcherTrace.request?.model || ANTHROPIC_MODEL,
      durationMs: researcherTrace.timing?.durationMs,
      inputTokens: researcherTrace.response?.usage?.input_tokens,
      outputTokens: researcherTrace.response?.usage?.output_tokens,
      evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
    },
    evidencePreview: Array.isArray(evidence)
      ? evidence.slice(0, 5).map((e) => ({
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
  send("progress", {
    stage: "synthesizing",
    message: "Drafting findings and report structure...",
    percent: 50,
    detail: `Transforming ${Array.isArray(evidence) ? evidence.length : 0} evidence items into structured equity research report with ${config.synthesizerModel || ANTHROPIC_MODEL}. Target: ${config.totalFindings} findings across 8 sections.`,
    substeps: [
      { text: "Investment thesis", status: "active" },
      { text: "Price action and financial performance", status: "active" },
      { text: "Product, technology, and competitive landscape", status: "active" },
      { text: "Industry trends, risks, and analyst consensus", status: "active" },
      { text: "Weaving findings into natural prose", status: "active" },
    ],
  });

  let draft, synthesizerTrace;
  try {
    const synthesizerResult = await synthesize(query, domainProfile, evidence, send, config);
    draft = synthesizerResult.result;
    synthesizerTrace = synthesizerResult.trace;
  } catch (err) {
    throw tagError(err, "synthesizer");
  }
  if (isAborted()) return;

  // Compute section breakdown
  const sectionBreakdown = (draft.sections || []).map((s) => {
    const findingCount = (s.content || []).filter(
      (c) => c.type === "finding"
    ).length;
    return `${s.title || s.id}: ${findingCount}`;
  });

  send("progress", {
    stage: "synthesized",
    message: `Drafted ${draft.findings?.length || 0} findings across ${draft.sections?.length || 0} sections`,
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

  let report, verifierTrace;
  try {
    const verifierResult = await verify(query, domainProfile, draft, send, config);
    report = verifierResult.result;
    verifierTrace = verifierResult.trace;
  } catch (err) {
    throw tagError(err, "verifier");
  }
  if (isAborted()) return;

  const findingsCount = report.findings?.length || 0;
  const avgCertainty =
    findingsCount > 0
      ? Math.round(
          report.findings.reduce((s, f) => s + (f.certainty || 0), 0) /
            findingsCount
        )
      : 0;

  const removedCount = (draft.findings?.length || 0) - findingsCount;
  const certaintyBuckets = { high: 0, moderate: 0, mixed: 0, weak: 0 };
  (report.findings || []).forEach((f) => {
    if (f.certainty >= 90) certaintyBuckets.high++;
    else if (f.certainty >= 70) certaintyBuckets.moderate++;
    else if (f.certainty >= 50) certaintyBuckets.mixed++;
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

  // ── Stage 5: Deliver ────────────────────────────────────────────────────────
  const pipelineDurationMs = Date.now() - pipelineStartTime;

  send("trace", {
    stage: "pipeline_summary",
    agent: "Pipeline",
    trace: {
      timing: { durationMs: pipelineDurationMs },
    },
    intermediateOutput: {
      query,
      totalStages: 4,
      totalFindings: findingsCount,
      avgCertainty,
    },
  });

  send("report", report);
}
