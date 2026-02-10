import { describe, it, expect } from "vitest";
import { repairTruncatedJson, extractJsonObject, stripCodeFences } from "./json-utils";

describe("stripCodeFences", () => {
  it("removes ```json and ``` fences", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("returns unchanged text when no fences", () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });

  it("trims whitespace", () => {
    expect(stripCodeFences("  \n  hello  \n  ")).toBe("hello");
  });
});

describe("extractJsonObject", () => {
  it("extracts a simple JSON object", () => {
    const result = extractJsonObject('Here is the result: {"a":1}');
    expect(result).toBe('{"a":1}');
  });

  it("extracts a nested JSON object", () => {
    const obj = { meta: { title: "Test" }, findings: [{ id: "f1" }] };
    const text = `Some commentary\n${JSON.stringify(obj)}\nMore text`;
    const result = extractJsonObject(text);
    expect(JSON.parse(result!)).toEqual(obj);
  });

  it("returns null when no valid JSON object exists", () => {
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject("{invalid json}")).toBeNull();
  });

  it("skips invalid brace pairs and finds valid JSON", () => {
    const result = extractJsonObject('{not valid} and then {"a":1}');
    expect(result).toBe('{"a":1}');
  });

  it("prefers the largest valid JSON object", () => {
    const small = '{"x":1}';
    const large = '{"meta":{"title":"Report"},"findings":[{"id":"f1","certainty":80}]}';
    const text = `Here ${small} is the report:\n${large}`;
    const result = extractJsonObject(text);
    expect(result).toBe(large);
  });

  it("handles JSON with string values containing braces", () => {
    const obj = { text: "value with {braces} inside" };
    const result = extractJsonObject(`Commentary: ${JSON.stringify(obj)}`);
    expect(JSON.parse(result!)).toEqual(obj);
  });

  it("handles JSON with escaped quotes in strings", () => {
    const obj = { text: 'value with "quotes" inside' };
    const result = extractJsonObject(`Prefix ${JSON.stringify(obj)} suffix`);
    expect(JSON.parse(result!)).toEqual(obj);
  });
});

describe("repairTruncatedJson", () => {
  it("repairs JSON truncated mid-value", () => {
    const truncated = '{"findings":[{"id":"f1","text":"hello';
    const result = repairTruncatedJson(truncated);
    expect(result).not.toBeNull();
    expect(() => JSON.parse(result!)).not.toThrow();
  });

  it("repairs JSON truncated after a complete value", () => {
    const truncated = '{"findings":[{"id":"f1"},{"id":"f2"';
    const result = repairTruncatedJson(truncated);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.findings).toBeDefined();
  });

  it("returns null for text that cannot be repaired", () => {
    expect(repairTruncatedJson("not json at all")).toBeNull();
    expect(repairTruncatedJson("")).toBeNull();
  });

  it("repairs JSON truncated at a key-value boundary", () => {
    const truncated = '{"a":1,"b":';
    const result = repairTruncatedJson(truncated);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.a).toBe(1);
  });
});
