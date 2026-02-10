import type { Report, Finding, ContentItem } from "../shared/types";

/**
 * Checks whether a finding has a usable explanation object.
 */
function hasExplanation(finding: Finding): boolean {
  const expl = finding.explanation;
  if (!expl || typeof expl !== "object") return false;
  if (!expl.title || typeof expl.title !== "string") return false;
  if (!expl.text || typeof expl.text !== "string") return false;
  return true;
}

/**
 * Strips finding references from section content when the underlying
 * finding lacks an explanation. Collapses adjacent text nodes and
 * removes empty sections (preserving title_slide).
 *
 * Call this once before delivering the final report.
 */
export function stripFindingsWithoutExplanations(report: Report): string[] {
  const validIds = new Set(
    (report.findings || []).filter(hasExplanation).map((f) => f.id)
  );
  const removedIds = (report.findings || [])
    .filter((f) => !validIds.has(f.id))
    .map((f) => f.id);

  if (removedIds.length === 0) return [];

  // Remove the findings themselves
  report.findings = report.findings.filter((f) => validIds.has(f.id));

  // Clean section content refs
  for (const section of report.sections || []) {
    const cleaned: ContentItem[] = [];
    for (const item of section.content || []) {
      if (item.type === "finding" && !validIds.has(item.id)) continue;
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

  report.sections = (report.sections || []).filter(
    (s) =>
      s.id === "title_slide" ||
      (s.content || []).some((item) => item.type === "finding")
  );

  return removedIds;
}
