import { describe, it, expect } from "vitest";
import type { Report, Finding } from "../shared/types";
import { stripFindingsWithoutExplanations } from "./finding-validation";

function goodFinding(id: string): Finding {
  return {
    id,
    section: "investment_thesis",
    text: "Claim",
    certainty: 85,
    explanation: {
      title: "Title",
      text: "Explanation text.",
      supportingEvidence: [{ source: "S", quote: "Q", url: "https://example.com" }],
      contraryEvidence: [],
    },
  };
}

function makeReport(findings: Finding[]): Report {
  return {
    meta: { title: "Test" },
    sections: [
      {
        id: "investment_thesis",
        title: "Investment Thesis",
        content: findings.map((f) => ({ type: "finding" as const, id: f.id })),
      },
    ],
    findings,
  };
}

describe("stripFindingsWithoutExplanations", () => {
  it("returns empty when all findings have explanations", () => {
    const report = makeReport([goodFinding("f1"), goodFinding("f2")]);
    expect(stripFindingsWithoutExplanations(report)).toEqual([]);
    expect(report.findings).toHaveLength(2);
  });

  it("removes findings with missing explanation", () => {
    const bad = goodFinding("f2");
    (bad as any).explanation = undefined;
    const report = makeReport([goodFinding("f1"), bad]);

    const removed = stripFindingsWithoutExplanations(report);

    expect(removed).toEqual(["f2"]);
    expect(report.findings).toHaveLength(1);
    const refIds = report.sections[0].content
      .filter((c) => c.type === "finding")
      .map((c) => (c as { id: string }).id);
    expect(refIds).toEqual(["f1"]);
  });

  it("removes findings with empty title", () => {
    const bad = goodFinding("f1");
    bad.explanation.title = "";
    const report = makeReport([bad]);

    expect(stripFindingsWithoutExplanations(report)).toEqual(["f1"]);
    expect(report.findings).toHaveLength(0);
  });

  it("removes findings with empty text", () => {
    const bad = goodFinding("f1");
    bad.explanation.text = "";
    const report = makeReport([bad]);

    expect(stripFindingsWithoutExplanations(report)).toEqual(["f1"]);
  });

  it("preserves title_slide sections even when empty", () => {
    const bad = goodFinding("f1");
    (bad as any).explanation = null;
    const report: Report = {
      meta: { title: "T" },
      sections: [
        { id: "title_slide", title: "Title", content: [{ type: "text", value: "Intro" }] },
        { id: "s1", title: "S1", content: [{ type: "finding", id: "f1" }] },
      ],
      findings: [bad],
    };

    stripFindingsWithoutExplanations(report);
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0].id).toBe("title_slide");
  });
});
