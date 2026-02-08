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
} from "../../shared/types";

/**
 * Removes finding references from section content arrays when the finding
 * has been deleted (e.g., certainty < 25%). Also collapses adjacent text nodes
 * and removes sections that have no findings left.
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

  // Remove sections that have zero findings
  report.sections = (report.sections || []).filter((s) =>
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
  config: Partial<ReasoningConfig> = {}
): Promise<AgentResult<Report>> {
  const { ticker, companyName } = domainProfile;
  const methodologyLength = config.methodologyLength || "3-5 sentences";
  const methodologySources = config.methodologySources || "3-4";
  const removalThreshold = config.removalThreshold ?? 25;

  const params = {
    ...(config.verifierModel && { model: config.verifierModel }),
    system: `You are an adversarial fact-checker and research quality auditor. Your job is to find problems with every finding in a draft equity research report.

COMPANY: ${companyName} (${ticker})

YOUR MANDATE: Be skeptical. Challenge everything. Your reputation depends on catching errors before they reach the client.

FOR EACH FINDING, YOU MUST:

1. VERIFY the claim against your knowledge. Is it factually accurate? Are the numbers correct?
2. SEARCH for contradicting evidence or alternative interpretations. Add these as "contraryEvidence".
3. ASSESS source quality. Is this from an official filing (high) or an opinion piece (low)?
4. ASSIGN a certainty score (1-99%) using this rubric:

   95-99%: FACTUAL — Directly from audited SEC filings or official company releases.
           REQUIRES: 3+ independent corroborating sources AND 0 contradicting evidence.
           If a finding has ANY contrary evidence, it CANNOT be 95%+.

   85-94%: STRONG — Multiple credible sources agree. Minor caveats may exist.
           REQUIRES: 2+ corroborating sources.

   70-84%: MODERATE — Credible but with meaningful caveats, or forward-looking estimates.
           Common for: analyst estimates, market projections, company guidance.

   50-69%: MIXED — Significant uncertainty or contradicting sources.
           Common for: market share estimates (methodology varies), geopolitical risk assessments.

   25-49%: WEAK — Limited sourcing, speculative, or contradicted by stronger evidence.

   <${removalThreshold}%:   REMOVE — Finding is unverifiable or likely incorrect. Remove it entirely.${removalThreshold === 0 ? " (Currently disabled — keep ALL findings regardless of certainty score.)" : ""}

5. For each finding, populate the contraryEvidence array INSIDE the explanation object. Even strong findings should have at least one nuance, caveat, or alternative interpretation. Only truly factual findings from audited filings (95%+) may have an empty contraryEvidence array.

IMPORTANT CHECKS:
- Do the financial numbers match known earnings? (Revenue, EPS, growth rates)
- Are dates correct? (Fiscal year calendars, earnings dates)
- Are market share figures from credible methodology?
- Are forward-looking estimates labeled as such?
- Are manufacturer performance claims flagged as unverified?
- Are analyst consensus figures from recent data?
- Does the finding have enough supporting evidence? Findings with <3 supporting evidence items should be scored lower.

CRITICAL OUTPUT SCHEMA — The frontend depends on these exact field locations:

Each finding in the output MUST have this structure:
{
  "id": "f1",
  "section": "investment_thesis",
  "text": "The original finding sentence",
  "certainty": 85,
  "explanation": {
    "title": "Short Title",
    "text": "2-4 sentences of context and significance...",
    "supportingEvidence": [
      { "source": "Source Name", "quote": "Exact data point or quote", "url": "domain.com" }
    ],
    "contraryEvidence": [
      { "source": "Source Name", "quote": "Contradicting data point, caveat, or alternative interpretation", "url": "domain.com" }
    ]
  }
}

FIELD PLACEMENT IS CRITICAL:
- "certainty" goes at the FINDING ROOT level (NOT inside explanation)
- "contraryEvidence" goes INSIDE the "explanation" object (alongside supportingEvidence)
- "contraryEvidence" items use the same { source, quote, url } format as supportingEvidence
- For non-specific sources, use url: "general" (common knowledge), "various" (multiple sources), or "derived" (calculations)

ALSO:
- Add "overallCertainty" to meta (arithmetic mean of all remaining finding certainty scores, rounded to integer)
- ${removalThreshold > 0 ? `REMOVE any finding with certainty < ${removalThreshold}% from both the findings array AND the section content arrays` : "Do NOT remove any findings — keep all findings in the report regardless of certainty score"}
- You may also improve the explanation "text" field to add additional context, correct inaccuracies, or note important caveats
- Do NOT change the meta, sections structure, or content arrays (except to remove deleted finding refs)

METHODOLOGY OVERVIEW — Add a "methodology" object to meta with this structure:
{
  "methodology": {
    "explanation": {
      "title": "Report Generation Methodology",
      "text": "A ${methodologyLength} summary of how the report was generated. Mention the date, the overall certainty score, the number of findings, the scoring methodology, and any key corrections you made during verification. Use \\n\\n for paragraph breaks.",
      "supportingEvidence": [
        { "source": "Primary Source Category", "quote": "What this source contributed to the report", "url": "domain.com" }
      ],
      "contraryEvidence": [
        { "source": "AI Limitations", "quote": "This report was generated by an AI model. Some data may be dated. Real-time prices change continuously.", "url": "general" },
        { "source": "Not Financial Advice", "quote": "AI-generated research cannot replace human analyst judgment or fiduciary responsibility.", "url": "general" }
      ]
    }
  }
}
The supportingEvidence should list the ${methodologySources} most important source categories used (e.g., official filings, market data providers, analyst consensus aggregators). The contraryEvidence should note AI limitations and the not-financial-advice disclaimer. The text field should mention any specific corrections you made (e.g., "Revenue figure corrected from $X to $Y based on official filings").

Return the complete report JSON. No markdown fences. No commentary.`,
    messages: [
      {
        role: "user" as const,
        content: `Review this draft equity research report on ${companyName} (${ticker}). Be ruthlessly skeptical. Find every error, every weak claim, every missing caveat.\n\n${JSON.stringify(draft, null, 2)}`,
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

    // Ensure meta and overallCertainty exist
    if (!report.meta) report.meta = {} as Report["meta"];
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
