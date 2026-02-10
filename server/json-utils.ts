/**
 * Shared JSON parsing utilities for agent response handling.
 *
 * These functions handle the common case where LLM responses are truncated
 * (max_tokens) or wrapped in commentary text. All agents use these instead
 * of maintaining their own copies.
 */

/**
 * Attempt to repair truncated JSON by closing all open brackets and braces.
 * This handles the common case where the model hits max_tokens mid-output.
 *
 * Strategy: walk the text tracking open structures, then progressively
 * trim from the end to find a clean cut point (not inside a string or
 * key-value pair), and close all remaining open structures.
 */
export function repairTruncatedJson(text: string): string | null {
  // Find a clean cut point by trimming back to the last complete value
  // Try several strategies, from least to most aggressive:
  const candidates: string[] = [
    text,
    // Strip trailing incomplete string (unmatched quote at end)
    text.replace(/,?\s*"[^"]*$/, ""),
    // Strip trailing incomplete key-value pair
    text.replace(/,?\s*"[^"]*"\s*:\s*"?[^"{}[\]]*$/, ""),
    // Strip back to the last closing brace/bracket
    text.replace(/[^}\]]*$/, ""),
  ];

  for (const candidate of candidates) {
    if (!candidate || candidate.length < 2) continue;

    const closers: string[] = [];
    let inString = false;
    let escape = false;

    for (let i = 0; i < candidate.length; i++) {
      const ch: string = candidate[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\" && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") closers.push("}");
      else if (ch === "[") closers.push("]");
      else if (ch === "}" || ch === "]") closers.pop();
    }

    // If we're stuck inside a string, this cut point isn't clean
    if (inString) continue;
    if (closers.length === 0) continue;

    const repaired: string = candidate + closers.reverse().join("");
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      // This cut point didn't produce valid JSON, try the next one
    }
  }

  return null;
}

/**
 * Extract a JSON object from text with surrounding commentary by finding
 * balanced brace pairs. Returns the largest valid JSON object found,
 * which handles the case where commentary text contains small valid
 * JSON snippets before the actual report payload.
 */
export function extractJsonObject(text: string): string | null {
  let best: string | null = null;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < text.length; j++) {
      const ch: string = text[j];
      if (escape) { escape = false; continue; }
      if (ch === "\\" && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate: string = text.slice(i, j + 1);
          try {
            JSON.parse(candidate);
            if (!best || candidate.length > best.length) {
              best = candidate;
            }
          } catch {
            // Not valid JSON at this position
          }
          break;
        }
      }
    }
  }
  return best;
}

/**
 * Strip markdown code fences from LLM output.
 */
export function stripCodeFences(text: string): string {
  return text.replace(/```json\n?|\n?```/g, "").trim();
}
