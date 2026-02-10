import { tracedCreate, type CreateMessageParams } from "../anthropic-client";
import type {
  DomainProfile,
  Report,
  Finding,
  Section,
  ContentItem,
  EvidenceItem,
  ReasoningConfig,
  SendFn,
  AgentResult,
  TraceData,
  PipelineError,
  ConversationContext,
} from "../../shared/types";

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
 * Reviews every finding against the raw evidence collected by the researcher,
 * searches for contradictions, assigns certainty scores, and may remove
 * findings that have no evidence backing.
 *
 * THIS AGENT'S JOB IS TO LOWER CERTAINTY, NOT RAISE IT.
 *
 * The verifier receives both the draft report AND the raw evidence so it can
 * judge whether findings accurately represent the collected data and whether
 * there's sufficient evidence to support each claim.
 */
export async function verify(
  query: string,
  domainProfile: DomainProfile,
  draft: Report,
  evidence: EvidenceItem[],
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

  const verifiedCount = Array.isArray(evidence) ? evidence.filter((e) => e.verified).length : 0;
  const evidenceSummary = Array.isArray(evidence) && evidence.length > 0
    ? `\n\nRAW EVIDENCE (${evidence.length} items, ${verifiedCount} verified from real web sources):\n${JSON.stringify(evidence, null, 2)}\n\nEvidence items with "verified": true have real URLs — the quote was extracted from actual web content. Items without verified: true are unverified LLM knowledge (url will be "general"/"various"/"derived"). Weight verified evidence much more heavily when scoring certainty.`
    : "";

  const params = {
    ...(config.verifierModel && { model: config.verifierModel }),
    system: `You are an adversarial fact-checker reviewing a draft ${formatLabel} on ${companyName} (${ticker}).

Be skeptical. Challenge every claim. Your job is to catch errors before they reach the client.
${contextSection}${slideFieldInstruction}
You are given both the draft report AND the raw evidence that was collected. Use the evidence to judge each finding:

For each finding:
1. Check if the finding is supported by the raw evidence provided
2. Verify factual accuracy against your knowledge
3. Add contradicting evidence or caveats as "contraryEvidence"
4. Assign a certainty score (1-99%):
   - 95-99%: Factual, backed by 3+ corroborating evidence items, 0 contradictions
   - 85-94%: Strong, 2+ evidence items agree
   - 70-84%: Moderate, credible with caveats or forward-looking
   - 50-69%: Mixed, significant uncertainty or weak evidence
   - 25-49%: Weak or speculative, little evidence support
   - 1-24%: Very weak, no real evidence backing

CRITICAL RULES FOR REMOVAL:
- The more high-certainty findings you have, the HIGHER your bar should be for keeping weaker ones. If most findings are 85%+, remove anything below ~40%. If most findings are moderate (60-80%), keep everything above ~25%.
- If evidence quality is poor overall (few items, weak sources), keep ALL findings but score them low. A report full of 30-50% findings is better than an empty report.
- NEVER remove all findings. The report must always contain results — even if certainty is very low.

Output schema (frontend depends on exact placement):
- "certainty" at finding ROOT level (not inside explanation)
- "contraryEvidence" INSIDE explanation object, same format as supportingEvidence: { source, quote, url }
- URLs: full URLs using the source's known URL patterns. Preserve URLs from the input draft. For new contrary evidence, construct realistic full URLs. For non-specific sources use "general"/"various"/"derived"

Also:
- Add "overallCertainty" to meta (arithmetic mean of remaining finding scores)
- You may improve explanation text to add context or corrections
- Don't change meta or section structure (except removing deleted finding refs)

Add a "methodology" object to meta:
{ "methodology": { "explanation": { "title": "Report Generation Methodology", "text": "${methodologyLength} summary of methodology, corrections, and key caveats", "supportingEvidence": [${methodologySources} key source categories], "contraryEvidence": [AI limitations disclaimer, not-financial-advice disclaimer] } } }

Return complete report JSON. No markdown fences.`,
    messages: [
      {
        role: "user" as const,
        content: `Review this draft ${formatLabel} on ${companyName} (${ticker}). Be skeptical — find errors, weak claims, and missing caveats.${evidenceSummary}\n\nDRAFT REPORT:\n${JSON.stringify(draft, null, 2)}`,
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

    // Compute overallCertainty from findings
    if (!report.meta.overallCertainty && report.findings?.length > 0) {
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
        if (!report.meta.overallCertainty && report.findings?.length > 0) {
          report.meta.overallCertainty = Math.round(
            report.findings.reduce((s: number, f: Finding) => s + (f.certainty || 50), 0) /
              report.findings.length
          );
        }
        cleanOrphanedRefs(report);
        return {
          result: report,
          trace: { ...trace, parseWarning: "Extracted via regex fallback" },
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
