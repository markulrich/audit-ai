/**
 * Shared validation functions for report data structures.
 * Used by server endpoints and can be imported by tests.
 */

import type { ContentItem, Finding, Section, Report } from "./types";

// ── Content Array Validation ────────────────────────────────────────────────

/** Validate a single content item */
export function validateContentItem(item: unknown): { valid: boolean; error?: string } {
  if (!item || typeof item !== "object") {
    return { valid: false, error: "Content item must be an object" };
  }

  const i = item as Record<string, unknown>;

  if (!("type" in i) || typeof i.type !== "string") {
    return { valid: false, error: "Content item must have a string 'type' field" };
  }

  switch (i.type) {
    case "finding":
      if (!("id" in i) || typeof i.id !== "string" || i.id.length === 0) {
        return { valid: false, error: "Finding ref must have a non-empty string 'id'" };
      }
      break;
    case "text":
      if (!("value" in i) || typeof i.value !== "string") {
        return { valid: false, error: "Text content must have a string 'value' field" };
      }
      break;
    case "break":
      // No additional fields required
      break;
    default:
      return { valid: false, error: `Unknown content item type: "${i.type}"` };
  }

  return { valid: true };
}

/** Validate a content array */
export function validateContentArray(content: unknown): { valid: boolean; errors: string[] } {
  if (!Array.isArray(content)) {
    return { valid: false, errors: ["Content must be an array"] };
  }

  const errors: string[] = [];

  for (let idx = 0; idx < content.length; idx++) {
    const result = validateContentItem(content[idx]);
    if (!result.valid) {
      errors.push(`content[${idx}]: ${result.error}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Finding Validation ──────────────────────────────────────────────────────

/** Validate a single finding */
export function validateFinding(finding: unknown): { valid: boolean; errors: string[] } {
  if (!finding || typeof finding !== "object") {
    return { valid: false, errors: ["Finding must be an object"] };
  }

  const f = finding as Record<string, unknown>;
  const errors: string[] = [];

  if (!f.id || typeof f.id !== "string") {
    errors.push("Finding must have a string 'id'");
  }

  if (!f.section || typeof f.section !== "string") {
    errors.push("Finding must have a string 'section'");
  }

  if (!f.text || typeof f.text !== "string") {
    errors.push("Finding must have a string 'text'");
  }

  if ("certainty" in f && f.certainty !== undefined) {
    if (typeof f.certainty !== "number" || f.certainty < 0 || f.certainty > 100) {
      errors.push("Finding certainty must be a number between 0 and 100");
    }
  }

  if (!f.explanation || typeof f.explanation !== "object") {
    errors.push("Finding must have an 'explanation' object");
  } else {
    const exp = f.explanation as Record<string, unknown>;
    if (typeof exp.title !== "string") errors.push("Finding explanation must have a string 'title'");
    if (typeof exp.text !== "string") errors.push("Finding explanation must have a string 'text'");
    if (!Array.isArray(exp.supportingEvidence)) errors.push("Finding explanation must have 'supportingEvidence' array");
    if (!Array.isArray(exp.contraryEvidence)) errors.push("Finding explanation must have 'contraryEvidence' array");
  }

  return { valid: errors.length === 0, errors };
}

// ── Section Validation ──────────────────────────────────────────────────────

/** Validate a section */
export function validateSection(section: unknown): { valid: boolean; errors: string[] } {
  if (!section || typeof section !== "object") {
    return { valid: false, errors: ["Section must be an object"] };
  }

  const s = section as Record<string, unknown>;
  const errors: string[] = [];

  if (!s.id || typeof s.id !== "string") {
    errors.push("Section must have a string 'id'");
  }

  if (!s.title || typeof s.title !== "string") {
    errors.push("Section must have a string 'title'");
  }

  if ("layout" in s && s.layout !== undefined) {
    const validLayouts = ["title", "content", "two-column", "stats", "bullets"];
    if (!validLayouts.includes(s.layout as string)) {
      errors.push(`Section layout must be one of: ${validLayouts.join(", ")}`);
    }
  }

  if ("content" in s) {
    const contentResult = validateContentArray(s.content);
    if (!contentResult.valid) {
      errors.push(...contentResult.errors.map((e) => `section.${e}`));
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Cross-Referencing Validation ────────────────────────────────────────────

/** Check that all finding refs in content arrays point to existing findings */
export function validateFindingRefs(
  sections: Section[],
  findings: Finding[]
): { valid: boolean; orphanedRefs: string[]; unusedFindings: string[] } {
  const findingIds = new Set(findings.map((f) => f.id));
  const referencedIds = new Set<string>();
  const orphanedRefs: string[] = [];

  for (const section of sections) {
    for (const item of section.content) {
      if (item.type === "finding") {
        referencedIds.add(item.id);
        if (!findingIds.has(item.id)) {
          orphanedRefs.push(item.id);
        }
      }
    }
  }

  const unusedFindings = findings
    .map((f) => f.id)
    .filter((id) => !referencedIds.has(id));

  return {
    valid: orphanedRefs.length === 0,
    orphanedRefs,
    unusedFindings,
  };
}

// ── Report Payload Validation ───────────────────────────────────────────────

/** Validate a complete report payload */
export function validateReportPayload(report: unknown): { valid: boolean; error?: string } {
  if (!report || typeof report !== "object") {
    return { valid: false, error: "Report must be an object" };
  }

  const r = report as Record<string, unknown>;

  if (!("meta" in r) || !r.meta || typeof r.meta !== "object") {
    return { valid: false, error: "Report must have a meta object" };
  }

  if (!("sections" in r) || !Array.isArray(r.sections)) {
    return { valid: false, error: "Report must have a sections array" };
  }

  if (!("findings" in r) || !Array.isArray(r.findings)) {
    return { valid: false, error: "Report must have a findings array" };
  }

  if (r.findings.length > 200) {
    return { valid: false, error: "Report has too many findings (max 200)" };
  }

  if (r.sections.length > 50) {
    return { valid: false, error: "Report has too many sections (max 50)" };
  }

  return { valid: true };
}

// ── Input Validation ────────────────────────────────────────────────────────

const MAX_QUERY_LENGTH = 5000;

/** Validate a slug */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

/** Validate a user query */
export function validateQuery(query: unknown): { valid: boolean; error?: string } {
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return { valid: false, error: "Query must be at least 3 characters" };
  }
  if ((query as string).length > MAX_QUERY_LENGTH) {
    return { valid: false, error: `Query too long (max ${MAX_QUERY_LENGTH} chars)` };
  }
  return { valid: true };
}

/** Validate a reasoning level */
const VALID_REASONING_LEVELS = ["x-light", "light", "heavy", "x-heavy"];
export function isValidReasoningLevel(level: string): boolean {
  return VALID_REASONING_LEVELS.includes(level);
}
