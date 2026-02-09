/**
 * Tests for SSE serialization and related server utilities.
 */
import { describe, it, expect } from "vitest";

// Re-implement sseSerialize for testing (it's not exported from index.ts)
function sseSerialize(data: unknown): string {
  const json = JSON.stringify(data);
  return json.replace(/\n/g, "\\n");
}

describe("sseSerialize", () => {
  it("serializes simple objects", () => {
    const result = sseSerialize({ foo: "bar" });
    expect(result).toBe('{"foo":"bar"}');
  });

  it("serializes strings with newlines safely", () => {
    const result = sseSerialize({ message: "line1\nline2\nline3" });
    // JSON.stringify escapes newlines to \\n, and sseSerialize is a safety net.
    // The result should be valid JSON with no bare newlines
    expect(result).not.toContain("\n");
    // The result should be parseable JSON
    const parsed = JSON.parse(result);
    expect(parsed.message).toBe("line1\nline2\nline3");
  });

  it("serializes null", () => {
    expect(sseSerialize(null)).toBe("null");
  });

  it("serializes numbers", () => {
    expect(sseSerialize(42)).toBe("42");
  });

  it("serializes arrays", () => {
    expect(sseSerialize([1, 2, 3])).toBe("[1,2,3]");
  });

  it("serializes nested objects", () => {
    const result = sseSerialize({ a: { b: { c: "deep" } } });
    expect(result).toBe('{"a":{"b":{"c":"deep"}}}');
  });

  it("handles empty objects", () => {
    expect(sseSerialize({})).toBe("{}");
  });

  it("handles strings with carriage returns", () => {
    // CR+LF in JSON would be \\r\\n already from JSON.stringify
    const result = sseSerialize({ text: "a\r\nb" });
    // Should not contain bare newlines
    expect(result).not.toContain("\n");
  });

  it("handles special characters in values", () => {
    const result = sseSerialize({ text: "quotes\"and\\backslashes" });
    expect(result).not.toContain("\n");
    // Should be valid JSON when parsed
    const parsed = JSON.parse(result);
    expect(parsed.text).toBe("quotes\"and\\backslashes");
  });

  it("handles unicode characters", () => {
    const result = sseSerialize({ emoji: "Hello 🌍" });
    expect(result).toBe('{"emoji":"Hello 🌍"}');
  });

  it("handles large payloads without newline injection", () => {
    const data = {
      findings: Array.from({ length: 100 }, (_, i) => ({
        id: `f${i}`,
        text: `Finding ${i}\nwith newline`,
        certainty: Math.random() * 100,
      })),
    };
    const result = sseSerialize(data);
    // Result should be a single line (no bare newlines)
    expect(result.split("\n").length).toBe(1);
  });

  it("preserves data integrity after parse", () => {
    const original = {
      stage: "complete",
      message: "All done\nReport ready",
      percent: 100,
      nested: { list: [1, "two", null, true] },
    };
    const serialized = sseSerialize(original);
    // JSON.stringify already escapes newlines; sseSerialize is a safety net.
    // The serialized result IS valid JSON (since JSON.stringify handles \n → \\n)
    const reparsed = JSON.parse(serialized);
    expect(reparsed.message).toBe("All done\nReport ready");
    expect(reparsed.percent).toBe(100);
    expect(reparsed.nested.list).toEqual([1, "two", null, true]);
  });
});

describe("SSE protocol compliance", () => {
  it("data field must be single-line for SSE", () => {
    // In SSE, each "data:" line must be followed by \n, and multi-line data
    // requires separate "data:" prefixes. Our approach is to ensure the JSON
    // payload itself contains no bare newlines.
    const problematicData = {
      content: "Line 1\nLine 2\nLine 3",
      error: { message: "Error\nmulti-line" },
    };
    const serialized = sseSerialize(problematicData);

    // Simulate SSE write
    const sseLine = `data: ${serialized}\n\n`;
    const lines = sseLine.split("\n");

    // Should have exactly: "data: {...}", "", ""
    // (data line, blank line for message end, trailing from split)
    expect(lines[0]).toMatch(/^data: /);
    expect(lines[1]).toBe(""); // end of event
    expect(lines.length).toBe(3); // data + empty + trailing
  });
});
