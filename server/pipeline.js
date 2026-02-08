import { classifyDomain } from "./agents/classifier.js";
import { research } from "./agents/researcher.js";
import { synthesize } from "./agents/synthesizer.js";
import { verify } from "./agents/verifier.js";
import { saveArtifact, updateConversation, saveReport } from "./db/storage.js";

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
 * @param {string|null} conversationId - Database conversation ID (null if DB disabled)
 */
export async function runPipeline(query, send, isAborted = () => false, conversationId = null) {
  // ── Stage 1: Classify ───────────────────────────────────────────────────────
  send("progress", {
    stage: "classifying",
    message: "Analyzing your query...",
    percent: 5,
  });

  const domainProfile = await classifyDomain(query);
  if (isAborted()) return;

  // Persist classification
  if (conversationId) {
    await updateConversation(conversationId, {
      domain: domainProfile.domain,
      ticker: domainProfile.ticker,
      companyName: domainProfile.companyName,
    });
    await saveArtifact(conversationId, "classified", domainProfile);
  }

  send("progress", {
    stage: "classified",
    message: `Detected domain: ${domainProfile.domainLabel}`,
    percent: 10,
    domainProfile,
  });

  // ── Stage 2: Research ───────────────────────────────────────────────────────
  send("progress", {
    stage: "researching",
    message: `Researching ${domainProfile.domainLabel}...`,
    percent: 15,
  });

  const evidence = await research(query, domainProfile);
  if (isAborted()) return;

  if (conversationId) {
    await saveArtifact(conversationId, "researched", { count: evidence?.length || 0, evidence });
  }

  send("progress", {
    stage: "researched",
    message: `Gathered ${Array.isArray(evidence) ? evidence.length : 0} evidence items`,
    percent: 40,
  });

  // ── Stage 3: Synthesize ─────────────────────────────────────────────────────
  send("progress", {
    stage: "synthesizing",
    message: "Drafting findings and report structure...",
    percent: 50,
  });

  const draft = await synthesize(query, domainProfile, evidence);
  if (isAborted()) return;

  if (conversationId) {
    await saveArtifact(conversationId, "synthesized", draft);
  }

  send("progress", {
    stage: "synthesized",
    message: `Drafted ${draft.findings?.length || 0} findings across ${draft.sections?.length || 0} sections`,
    percent: 70,
  });

  // ── Stage 4: Verify ─────────────────────────────────────────────────────────
  send("progress", {
    stage: "verifying",
    message: "Adversarially verifying each finding...",
    percent: 75,
  });

  const report = await verify(query, domainProfile, draft);
  if (isAborted()) return;

  if (conversationId) {
    await saveArtifact(conversationId, "verified", { findingsCount: report.findings?.length || 0 });
    await saveReport(conversationId, report);
    await updateConversation(conversationId, { status: "completed" });
  }

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

  // ── Stage 5: Deliver ────────────────────────────────────────────────────────
  send("report", report);
}
