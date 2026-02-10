import { tracedCreate, type CreateMessageParams } from "../anthropic-client";
import type {
  DomainProfile,
  Report,
  Finding,
  Section,
  ContentItem,
  ReasoningConfig,
  SendFn,
  AgentResult,
  TraceData,
  PipelineError,
  ConversationContext,
} from "../../shared/types";

/**
 * Computes a dynamic removal threshold based on the quality distribution
 * of verified findings. When evidence quality is high, we can be more
 * selective. When quality is low, we keep everything and let the certainty
 * scores tell the story.
 *
 * The key insight: the more high-certainty findings you have, the higher
 * the bar should be for what gets included. This prevents low-quality
 * findings from diluting an otherwise strong report.
 */
export function computeDynamicThreshold(findings: Finding[]): number {
  if (findings.length === 0) return 0;

  const scores = findings.map((f) => f.certainty || 0).sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)];

  // High-quality report: be more selective
  if (median >= 85) return 40;
  if (median >= 70) return 30;
  if (median >= 50) return 20;
  // Low-quality evidence overall: keep everything, show uncertainty
  return 0;
}

/**
 * Removes finding references from section content arrays when the finding
 * has been deleted. Also collapses adjacent text nodes
 * and removes sections that have no findings left.
 *
 * Preserves title_slide sections even if they have no findings (they typically
 * have text-only content in slide deck format).
 */
function cleanOrphanedRefs(report: Report): void {
  const findingIds = new Set((report.findings || []).map((f) => f.id));

  for (const section of report.sections || []) {
    // Remove orphaned finding refs and collapse adjacent text nodes
    const cleaned: ContentItem[] = [];
    for (const item of section.content || []) {
      if (item.type === "finding" && !findingIds.has(item.id)) continue;
      // Merge adjacent text nodes
      if (
        item.type === "text" &&
        cleaned.length > 0 &&
        cleaned[cleaned.length - 1].type === "text"
      ) {
        (cleaned[cleaned.length - 1] as Extract<ContentItem, { type: "text" }>).value += item.value;
      } else {
        cleaned.push(item);
      }
    }
    section.content = cleaned;
  }

  // Remove sections that have zero findings, but preserve title_slide sections
  report.sections = (report.sections || []).filter((s) =>
    s.id === "title_slide" ||
    (s.content || []).some((item) => item.type === "finding")
  );
}

/**
 * Verification Agent — the adversarial skeptic.
 *
 * Reviews every finding, searches for contradictions,
 * assigns certainty scores, and removes weak findings.
 *
 * THIS AGENT'S JOB IS TO LOWER CERTAINTY, NOT RAISE IT.
 */
export async function verify(
  query: string,
  domainProfile: DomainProfile,
  draft: Report,
  send: SendFn | undefined,
  config: Partial<ReasoningConfig> = {},
  conversationContext?: ConversationContext,
): Promise<AgentResult<Report>> {
  const { ticker, companyName } = domainProfile;
  const methodologyLength = config.methodologyLength || "3-5 sentences";
  const methodologySources = config.methodologySources || "3-4";

  const isSlides = domainProfile.outputFormat === "slide_deck";
  const formatLabel = isSlides ? "slide deck" : "equity research report";

  // Build conversation context for follow-ups
  let contextSection = "";
  if (conversationContext?.previousReport) {
    const recentMessages = (conversationContext.messageHistory || [])
      .slice(-4)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    contextSection = `
CONVERSATION CONTEXT:
This is a follow-up verification. The user has been iterating on this report.

Recent conversation:
${recentMessages}

Pay special attention to areas the user mentioned — they may have flagged specific concerns.`;
  }

  const slideFieldInstruction = isSlides
    ? `
IMPORTANT: This is a slide deck. You MUST preserve these slide-specific fields on each section:
- "layout": the slide layout type (title, content, two-column, stats, bullets)
- "subtitle": the slide subtitle text
- "speakerNotes": presenter notes for the slide
Do NOT remove or modify these fields.
`
    : "";

  const params = {
    ...(config.verifierModel && { model: config.verifierModel }),
    system: `You are an adversarial fact-checker reviewing a draft ${formatLabel} on ${companyName} (${ticker}).

Be skeptical. Challenge every claim. Your job is to catch errors before they reach the client.
${contextSection}${slideFieldInstruction}
For each finding:
1. Verify factual accuracy against your knowledge
2. Add contradicting evidence or caveats as "contraryEvidence"
3. Assign a certainty score (1-99%):
   - 95-99%: Factual, 3+ corroborating sources, 0 contradictions
   - 85-94%: Strong, 2+ sources agree
   - 70-84%: Moderate, credible with caveats or forward-looking
   - 50-69%: Mixed, significant uncertainty
   - 25-49%: Weak or speculative
   - 1-24%: Very weak, mostly unverifiable — but still include in output

Output schema (frontend depends on exact placement):
- "certainty" at finding ROOT level (not inside explanation)
- "contraryEvidence" INSIDE explanation object, same format as supportingEvidence: { source, quote, url }
- URLs: full URLs using the source's known URL patterns. Preserve URLs from the input draft. For new contrary evidence, construct realistic full URLs. For non-specific sources use "general"/"various"/"derived"

Also:
- Add "overallCertainty" to meta (arithmetic mean of remaining finding scores)
- Keep ALL findings in the output — do not remove any, even very low scoring ones. The system will filter based on overall evidence quality.
- You may improve explanation text to add context or corrections
- Don't change meta or section structure (except removing deleted finding refs)

Add a "methodology" object to meta:
{ "methodology": { "explanation": { "title": "Report Generation Methodology", "text": "${methodologyLength} summary of methodology, corrections, and key caveats", "supportingEvidence": [${methodologySources} key source categories], "contraryEvidence": [AI limitations disclaimer, not-financial-advice disclaimer] } } }

Return complete report JSON. No markdown fences.`,
    messages: [
      {
        role: "user" as const,
        content: `Review this draft ${formatLabel} on ${companyName} (${ticker}). Be skeptical — find errors, weak claims, and missing caveats.\n\n${JSON.stringify(draft, null, 2)}`,
      },
    ],
  };

  // Emit pre-call trace so frontend can show request details while LLM is working
  if (send) {
    send("trace", {
      stage: "verifier",
      agent: "Verifier",
      status: "pending",
      trace: {
        request: {
          model: params.model || "(default)",
          max_tokens: "(model max)",
          system: params.system,
          messages: params.messages,
        },
      },
    });
  }

  const { response, trace } = await tracedCreate(params as CreateMessageParams);

  // Track which findings were removed and certainty changes for the trace
  const preFindingIds = new Set((draft.findings || []).map((f) => f.id));

  try {
    const firstBlock = response.content?.[0];
    const text = firstBlock?.type === "text" ? firstBlock.text : undefined;
    if (!text) throw new Error("Empty verifier response");
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    const report: Report = JSON.parse(cleaned);

    // Ensure meta exists
    if (!report.meta) report.meta = {} as Report["meta"];

    // If verifier returned 0 findings, fall back to draft findings with low certainty
    if (!report.findings?.length && draft.findings?.length) {
      report.findings = draft.findings.map((f) => ({
        ...f,
        certainty: f.certainty || 15,
        explanation: {
          ...f.explanation,
          contraryEvidence: f.explanation?.contraryEvidence || [
            { source: "Verification", quote: "Could not verify — verifier returned no findings", url: "internal" },
          ],
        },
      }));
      report.sections = draft.sections || report.sections;
    }

    // Apply dynamic threshold based on evidence quality distribution
    const dynamicThreshold = computeDynamicThreshold(report.findings || []);
    if (dynamicThreshold > 0 && report.findings?.length > 0) {
      const filtered = report.findings.filter((f) => (f.certainty || 0) >= dynamicThreshold);
      // Never produce an empty report — if threshold would remove everything, keep all
      if (filtered.length > 0) {
        report.findings = filtered;
      }
    }

    // Compute overallCertainty from remaining findings
    if (report.findings?.length > 0) {
      report.meta.overallCertainty = Math.round(
        report.findings.reduce((s: number, f: Finding) => s + (f.certainty || 50), 0) /
          report.findings.length
      );
    }

    // Clean orphaned finding refs from section content arrays
    cleanOrphanedRefs(report);

    // Build verification diff for trace
    const postFindingIds = new Set((report.findings || []).map((f) => f.id));
    const removedFindings = [...preFindingIds].filter((id) => !postFindingIds.has(id));
    const certaintySummary = (report.findings || []).map((f) => ({
      id: f.id,
      certainty: f.certainty,
      contraryCount: f.explanation?.contraryEvidence?.length || 0,
    }));

    return {
      result: report,
      trace: {
        ...trace,
        parsedOutput: {
          findingsCount: report.findings?.length || 0,
          overallCertainty: report.meta?.overallCertainty,
          dynamicThreshold,
          removedFindings,
          certaintySummary,
        },
      },
    };
  } catch (e) {
    const error = e as PipelineError;
    console.error("Verification agent parse error:", error.message);
    const rawFirstBlock = response.content?.[0];
    const rawText = rawFirstBlock?.type === "text" ? rawFirstBlock.text : "";
    // Try to extract a valid JSON object from the response by finding
    // balanced brace pairs and attempting to parse each one. This avoids
    // the greedy regex pitfall of matching across unrelated braces.
    let extracted: any = null;
    for (let i = 0; i < rawText.length; i++) {
      if (rawText[i] !== "{") continue;
      // Find the matching closing brace using depth counting
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let j = i; j < rawText.length; j++) {
        const ch = rawText[j];
        if (escape) { escape = false; continue; }
        if (ch === "\\" && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === "{") depth++;
        if (ch === "}") {
          depth--;
          if (depth === 0) {
            try {
              const candidate = JSON.parse(rawText.slice(i, j + 1));
              if (!extracted || candidate.findings) extracted = candidate;
              if (candidate.findings) break;
            } catch {
              // Not valid JSON, try the next '{'
            }
            break;
          }
        }
      }
      if (extracted?.findings) break;
    }
    if (extracted) {
      try {
        const report: Report = extracted;
        if (!report.meta) report.meta = {} as Report["meta"];

        // Apply dynamic threshold based on evidence quality
        const dynamicThreshold = computeDynamicThreshold(report.findings || []);
        if (dynamicThreshold > 0 && report.findings?.length > 0) {
          const filtered = report.findings.filter((f) => (f.certainty || 0) >= dynamicThreshold);
          if (filtered.length > 0) {
            report.findings = filtered;
          }
        }

        if (report.findings?.length > 0) {
          report.meta.overallCertainty = Math.round(
            report.findings.reduce((s: number, f: Finding) => s + (f.certainty || 50), 0) /
              report.findings.length
          );
        }
        cleanOrphanedRefs(report);
        return {
          result: report,
          trace: { ...trace, parseWarning: "Extracted via regex fallback", parsedOutput: { dynamicThreshold } },
        };
      } catch (parseErr) {
        console.error("Verification agent regex fallback parse error:", (parseErr as PipelineError).message);
      }
    }
    // Last resort: return draft with default certainty scores
    console.warn("Verification failed, returning draft with default scores");
    draft.findings = (draft.findings || []).map((f) => ({
      ...f,
      certainty: f.certainty || 60,
      explanation: {
        ...f.explanation,
        contraryEvidence: f.explanation?.contraryEvidence || [],
      },
    }));
    if (!draft.meta) draft.meta = {} as Report["meta"];
    draft.meta.overallCertainty =
      draft.findings.length > 0
        ? Math.round(
            draft.findings.reduce((s: number, f: Finding) => s + (f.certainty ?? 0), 0) /
              draft.findings.length
          )
        : 0;
    cleanOrphanedRefs(draft);
    return {
      result: draft,
      trace: { ...trace, parseWarning: "Verification failed, used draft with default scores" },
    };
  }
}
