import { classifyDomain } from "./agents/classifier.js";
import { research } from "./agents/researcher.js";
import { synthesize } from "./agents/synthesizer.js";
import { verify } from "./agents/verifier.js";

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
export async function runPipeline(query, send, isAborted = () => false) {
  const pipelineStartTime = Date.now();

  // ── Stage 1: Classify ───────────────────────────────────────────────────────
  send("progress", {
    stage: "classifying",
    message: "Analyzing your query...",
    percent: 5,
  });

  const { result: domainProfile, trace: classifierTrace } =
    await classifyDomain(query);
  if (isAborted()) return;

  send("progress", {
    stage: "classified",
    message: `Detected domain: ${domainProfile.domainLabel}`,
    percent: 10,
    domainProfile,
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
    message: `Researching ${domainProfile.domainLabel}...`,
    percent: 15,
  });

  const { result: evidence, trace: researcherTrace } = await research(
    query,
    domainProfile
  );
  if (isAborted()) return;

  send("progress", {
    stage: "researched",
    message: `Gathered ${Array.isArray(evidence) ? evidence.length : 0} evidence items`,
    percent: 40,
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
  });

  const { result: draft, trace: synthesizerTrace } = await synthesize(
    query,
    domainProfile,
    evidence
  );
  if (isAborted()) return;

  send("progress", {
    stage: "synthesized",
    message: `Drafted ${draft.findings?.length || 0} findings across ${draft.sections?.length || 0} sections`,
    percent: 70,
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
    message: "Adversarially verifying each finding...",
    percent: 75,
  });

  const { result: report, trace: verifierTrace } = await verify(
    query,
    domainProfile,
    draft
  );
  if (isAborted()) return;

  const findingsCount = report.findings?.length || 0;
  const avgCertainty =
    findingsCount > 0
      ? Math.round(
          report.findings.reduce((s, f) => s + (f.certainty || 0), 0) /
            findingsCount
        )
      : 0;

  send("progress", {
    stage: "verified",
    message: `Verified ${findingsCount} findings. Average certainty: ${avgCertainty}%`,
    percent: 95,
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
