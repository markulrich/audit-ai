import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  DomainProfile,
  EvidenceItem,
  Report,
  SendFn,
  ReasoningConfig,
  Attachment,
} from "../../shared/types";

// Mock all agent modules before importing skills
vi.mock("../agents/classifier", () => ({
  classifyDomain: vi.fn().mockResolvedValue({
    result: {
      domain: "equity_research",
      domainLabel: "Equity Research",
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      focusAreas: ["financials"],
      timeframe: "current",
      outputFormat: "written_report",
      defaultOutputFormat: "written_report",
      sourceHierarchy: [],
      certaintyRubric: "factual_verification",
      evidenceStyle: "quantitative",
      contraryThreshold: "any_contradiction_lowers_score",
      toneTemplate: "investment_bank_equity_research",
      sections: [],
      reportMeta: { ratingOptions: [] },
    } satisfies DomainProfile,
    trace: { request: {}, response: {} },
  }),
}));

vi.mock("../agents/draft-answer", () => ({
  draftAnswer: vi.fn().mockResolvedValue({
    result: "NVIDIA is a leading semiconductor company...",
    trace: { request: {}, response: {} },
  }),
}));

vi.mock("../agents/researcher", () => ({
  research: vi.fn().mockResolvedValue({
    result: [
      { source: "SEC Filing", quote: "Revenue increased 122%", url: "https://sec.gov", category: "financial", authority: "primary" },
      { source: "Earnings Call", quote: "Strong datacenter growth", url: "https://nvidia.com", category: "financial", authority: "primary" },
    ] satisfies EvidenceItem[],
    trace: { request: {}, response: {} },
  }),
}));

vi.mock("../agents/synthesizer", () => ({
  synthesize: vi.fn().mockResolvedValue({
    result: {
      meta: { title: "NVIDIA (NVDA)" },
      sections: [{ id: "investment_thesis", title: "Investment Thesis", content: [] }],
      findings: [{ id: "f1", section: "investment_thesis", text: "Revenue grew", certainty: 85, explanation: { title: "Revenue", text: "Strong growth", supportingEvidence: [], contraryEvidence: [] } }],
    } satisfies Report,
    trace: { request: {}, response: {} },
  }),
}));

vi.mock("../agents/verifier", () => ({
  verify: vi.fn().mockResolvedValue({
    result: {
      meta: { title: "NVIDIA (NVDA)", overallCertainty: 82 },
      sections: [{ id: "investment_thesis", title: "Investment Thesis", content: [] }],
      findings: [{ id: "f1", section: "investment_thesis", text: "Revenue grew", certainty: 82, explanation: { title: "Revenue", text: "Strong growth", supportingEvidence: [], contraryEvidence: [] } }],
    } satisfies Report,
    trace: { request: {}, response: {} },
  }),
}));

vi.mock("../anthropic-client", () => ({
  tracedCreate: vi.fn().mockResolvedValue({
    response: {
      content: [{ type: "text", text: '[{"source":"Uploaded: file.csv","quote":"test data","url":"uploaded","category":"financial_data","authority":"primary_source"}]' }],
    },
    trace: { request: {}, response: {} },
  }),
  ANTHROPIC_MODEL: "claude-haiku-4-5",
}));

import { getSkill, listSkills, executeSkill } from "./index";
import type { SkillContext } from "./index";

function makeSendFn(): SendFn {
  return vi.fn();
}

function makeConfig(): ReasoningConfig {
  return {
    label: "X-Light",
    description: "Fast mode",
    evidenceMinItems: 10,
    totalFindings: "8-12",
    findingsPerSection: "1-2",
    supportingEvidenceMin: 2,
    explanationLength: "1-2 sentences",
    quoteLength: "short",
    keyStatsCount: 4,
    methodologyLength: "brief",
    methodologySources: "2-3",
    removalThreshold: 25,
  };
}

function makeContext(overrides?: Partial<SkillContext>): SkillContext {
  return {
    send: makeSendFn(),
    config: makeConfig(),
    state: { query: "Analyze NVIDIA (NVDA)" },
    ...overrides,
  };
}

describe("skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listSkills", () => {
    it("returns all 7 registered skills", () => {
      const skills = listSkills();
      expect(skills).toHaveLength(7);

      const names = skills.map((s) => s.name);
      expect(names).toContain("classify");
      expect(names).toContain("research");
      expect(names).toContain("analyze_attachment");
      expect(names).toContain("synthesize");
      expect(names).toContain("verify");
      expect(names).toContain("refine_section");
      expect(names).toContain("draft_answer");
    });

    it("each skill has a name and description", () => {
      const skills = listSkills();
      for (const skill of skills) {
        expect(skill.name).toBeTruthy();
        expect(skill.description).toBeTruthy();
        expect(skill.description.length).toBeGreaterThan(10);
      }
    });
  });

  describe("getSkill", () => {
    it("returns a function for known skills", () => {
      expect(getSkill("classify")).toBeTypeOf("function");
      expect(getSkill("research")).toBeTypeOf("function");
      expect(getSkill("synthesize")).toBeTypeOf("function");
      expect(getSkill("verify")).toBeTypeOf("function");
    });

    it("returns undefined for unknown skill", () => {
      expect(getSkill("nonexistent" as any)).toBeUndefined();
    });
  });

  describe("executeSkill", () => {
    it("executes classify skill and sets domain profile", async () => {
      const ctx = makeContext();
      const invocation = await executeSkill("classify", ctx, {});

      expect(invocation.skill).toBe("classify");
      expect(invocation.status).toBe("completed");
      expect(invocation.durationMs).toBeGreaterThanOrEqual(0);
      expect(invocation.completedAt).toBeDefined();
      expect(ctx.state.domainProfile).toBeDefined();
      expect(ctx.state.domainProfile!.ticker).toBe("NVDA");
    });

    it("executes research skill and sets evidence", async () => {
      const ctx = makeContext();
      // Need domain profile first
      ctx.state.domainProfile = {
        domain: "equity_research",
        domainLabel: "Equity Research",
        ticker: "NVDA",
        companyName: "NVIDIA Corporation",
        focusAreas: ["financials"],
        timeframe: "current",
        outputFormat: "written_report",
        defaultOutputFormat: "written_report",
        sourceHierarchy: [],
        certaintyRubric: "factual_verification",
        evidenceStyle: "quantitative",
        contraryThreshold: "any_contradiction_lowers_score",
        toneTemplate: "investment_bank_equity_research",
        sections: [],
        reportMeta: { ratingOptions: [] },
      };

      const invocation = await executeSkill("research", ctx, {});

      expect(invocation.status).toBe("completed");
      expect(ctx.state.evidence).toBeDefined();
      expect(ctx.state.evidence!.length).toBeGreaterThan(0);
    });

    it("research skill fails without domain profile", async () => {
      const ctx = makeContext();
      const invocation = await executeSkill("research", ctx, {});

      expect(invocation.status).toBe("failed");
      expect(invocation.error).toContain("domain profile");
    });

    it("executes synthesize skill and sets draft", async () => {
      const ctx = makeContext();
      ctx.state.domainProfile = { ticker: "NVDA" } as DomainProfile;
      ctx.state.evidence = [
        { source: "Test", quote: "Data", url: "https://test.com" },
      ];

      const invocation = await executeSkill("synthesize", ctx, {});

      expect(invocation.status).toBe("completed");
      expect(ctx.state.draft).toBeDefined();
      expect(ctx.state.draft!.meta.title).toBe("NVIDIA (NVDA)");
    });

    it("synthesize skill fails without evidence", async () => {
      const ctx = makeContext();
      ctx.state.domainProfile = { ticker: "NVDA" } as DomainProfile;
      ctx.state.evidence = [];

      const invocation = await executeSkill("synthesize", ctx, {});
      expect(invocation.status).toBe("failed");
      expect(invocation.error).toContain("evidence");
    });

    it("executes verify skill and sets report", async () => {
      const ctx = makeContext();
      ctx.state.domainProfile = { ticker: "NVDA" } as DomainProfile;
      ctx.state.draft = {
        meta: { title: "NVIDIA" },
        sections: [],
        findings: [{ id: "f1", section: "test", text: "test", certainty: 80, explanation: { title: "", text: "", supportingEvidence: [], contraryEvidence: [] } }],
      };

      const invocation = await executeSkill("verify", ctx, {});

      expect(invocation.status).toBe("completed");
      expect(ctx.state.report).toBeDefined();
    });

    it("verify skill fails without draft", async () => {
      const ctx = makeContext();
      ctx.state.domainProfile = { ticker: "NVDA" } as DomainProfile;

      const invocation = await executeSkill("verify", ctx, {});
      expect(invocation.status).toBe("failed");
      expect(invocation.error).toContain("draft report");
    });

    it("executes analyze_attachment skill", async () => {
      const ctx = makeContext();
      const attachment: Attachment = {
        id: "att-1",
        filename: "data.csv",
        mimeType: "text/csv",
        sizeBytes: 100,
        s3Key: "reports/test/att-1-data.csv",
        uploadedAt: new Date().toISOString(),
        extractedText: "name,value\nfoo,100\nbar,200",
      };

      const invocation = await executeSkill("analyze_attachment", ctx, { attachment });

      expect(invocation.status).toBe("completed");
      expect(ctx.state.evidence).toBeDefined();
      expect(ctx.state.evidence!.length).toBeGreaterThan(0);
      expect(ctx.state.attachmentInsights).toBeDefined();
    });

    it("analyze_attachment fails without attachment", async () => {
      const ctx = makeContext();
      const invocation = await executeSkill("analyze_attachment", ctx, {});

      expect(invocation.status).toBe("failed");
      expect(invocation.error).toContain("No attachment");
    });

    it("draft_answer skill fails without domain profile", async () => {
      const ctx = makeContext();
      const invocation = await executeSkill("draft_answer", ctx, {});

      expect(invocation.status).toBe("failed");
      expect(invocation.error).toContain("domain profile");
    });

    it("executes draft_answer skill with domain profile", async () => {
      const ctx = makeContext();
      ctx.state.domainProfile = { ticker: "NVDA" } as DomainProfile;

      const invocation = await executeSkill("draft_answer", ctx, {});

      expect(invocation.status).toBe("completed");
    });

    it("throws for unknown skill", async () => {
      const ctx = makeContext();
      await expect(
        executeSkill("nonexistent" as any, ctx, {})
      ).rejects.toThrow("Unknown skill");
    });

    it("sends skill_start and skill_complete events", async () => {
      const ctx = makeContext();
      await executeSkill("classify", ctx, {});

      const send = ctx.send as ReturnType<typeof vi.fn>;
      expect(send).toHaveBeenCalledWith("skill_start", expect.objectContaining({ skill: "classify" }));
      expect(send).toHaveBeenCalledWith("skill_complete", expect.objectContaining({ skill: "classify" }));
    });

    it("sends skill_error event on failure", async () => {
      const ctx = makeContext();
      // Research will fail because no domain profile
      await executeSkill("research", ctx, {});

      const send = ctx.send as ReturnType<typeof vi.fn>;
      expect(send).toHaveBeenCalledWith("skill_error", expect.objectContaining({ skill: "research" }));
    });

    it("tracks timing information", async () => {
      const ctx = makeContext();
      const invocation = await executeSkill("classify", ctx, {});

      expect(invocation.startedAt).toBeDefined();
      expect(invocation.completedAt).toBeDefined();
      expect(invocation.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("refine_section skill", () => {
    it("fails without a report", async () => {
      const ctx = makeContext();
      ctx.state.domainProfile = { ticker: "NVDA", domainLabel: "Equity Research" } as DomainProfile;

      const invocation = await executeSkill("refine_section", ctx, {
        sectionId: "investment_thesis",
        feedback: "Add more data",
      });

      expect(invocation.status).toBe("failed");
      expect(invocation.error).toContain("No report to refine");
    });

    it("fails for non-existent section", async () => {
      const ctx = makeContext();
      ctx.state.domainProfile = { ticker: "NVDA", domainLabel: "Equity Research" } as DomainProfile;
      ctx.state.report = {
        meta: { title: "Test" },
        sections: [{ id: "existing", title: "Existing", content: [] }],
        findings: [],
      };

      const invocation = await executeSkill("refine_section", ctx, {
        sectionId: "nonexistent",
        feedback: "Improve this",
      });

      expect(invocation.status).toBe("failed");
      expect(invocation.error).toContain("Section not found");
    });
  });
});
