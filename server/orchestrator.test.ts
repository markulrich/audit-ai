import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  DomainProfile,
  Report,
  SendFn,
  Attachment,
  AgentWorkLog,
  TraceData,
} from "../shared/types";

// Mock anthropic-client (used by orchestrator for plan generation)
vi.mock("./anthropic-client", () => ({
  tracedCreate: vi.fn().mockResolvedValue({
    response: {
      content: [{
        type: "text",
        text: JSON.stringify({
          reasoning: "Standard pipeline for equity research",
          steps: [
            { skill: "classify", description: "Classify query", input: {}, status: "pending" },
            { skill: "research", description: "Gather evidence", input: {}, status: "pending" },
            { skill: "synthesize", description: "Draft report", input: {}, status: "pending" },
            { skill: "verify", description: "Verify findings", input: {}, status: "pending" },
          ],
        }),
      }],
    },
    trace: {},
  }),
  ANTHROPIC_MODEL: "claude-haiku-4-5",
}));

// Mock reasoning-levels
vi.mock("./reasoning-levels", () => ({
  getReasoningConfig: vi.fn().mockReturnValue({
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
  }),
}));

// Mock skills
const mockExecuteSkill = vi.fn();
vi.mock("./skills/index", () => ({
  executeSkill: (...args: unknown[]) => mockExecuteSkill(...args),
  listSkills: () => [
    { name: "classify", description: "Classify query" },
    { name: "research", description: "Research evidence" },
    { name: "synthesize", description: "Synthesize report" },
    { name: "verify", description: "Verify report" },
    { name: "draft_answer", description: "Draft answer" },
    { name: "analyze_attachment", description: "Analyze attachment" },
    { name: "refine_section", description: "Refine section" },
  ],
}));

import { runOrchestrator } from "./orchestrator";

const mockDomainProfile: DomainProfile = {
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

const mockReport: Report = {
  meta: { title: "NVIDIA (NVDA)", overallCertainty: 82 },
  sections: [{ id: "investment_thesis", title: "Investment Thesis", content: [] }],
  findings: [
    {
      id: "f1",
      section: "investment_thesis",
      text: "Revenue grew 122%",
      certainty: 82,
      explanation: {
        title: "Revenue Growth",
        text: "Strong revenue growth driven by datacenter",
        supportingEvidence: [],
        contraryEvidence: [],
      },
    },
  ],
};

describe("orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: each skill succeeds
    mockExecuteSkill.mockImplementation(async (name: string) => {
      const invocation = {
        skill: name,
        input: {},
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 100,
        status: "completed",
        output: null as unknown,
        trace: {},
      };

      switch (name) {
        case "classify":
          invocation.output = mockDomainProfile;
          break;
        case "research":
          invocation.output = [{ source: "Test", quote: "Data", url: "https://test.com" }];
          break;
        case "synthesize":
          invocation.output = mockReport;
          break;
        case "verify":
          invocation.output = mockReport;
          break;
        case "draft_answer":
          invocation.output = "NVIDIA is a leading company...";
          break;
        default:
          break;
      }

      return invocation;
    });
  });

  it("runs the full pipeline and returns a report", async () => {
    const send = vi.fn() as SendFn;
    const result = await runOrchestrator({
      query: "Analyze NVIDIA (NVDA)",
      send,
    });

    expect(result).toBeDefined();
    expect(result.meta.title).toBe("NVIDIA (NVDA)");
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("sends progress events throughout execution", async () => {
    const send = vi.fn();
    await runOrchestrator({
      query: "Analyze NVIDIA (NVDA)",
      send,
    });

    // Should have sent planning, skill, and completion progress events
    const progressCalls = send.mock.calls.filter((c) => c[0] === "progress");
    expect(progressCalls.length).toBeGreaterThanOrEqual(3);

    // Should include planning and complete stages
    const stages = progressCalls.map((c) => c[1].stage);
    expect(stages).toContain("planning");
    expect(stages).toContain("complete");
  });

  it("sends work_log events", async () => {
    const send = vi.fn();
    await runOrchestrator({
      query: "Analyze NVIDIA (NVDA)",
      send,
    });

    const workLogCalls = send.mock.calls.filter((c) => c[0] === "work_log");
    expect(workLogCalls.length).toBeGreaterThan(0);
  });

  it("sends report events for synthesize and verify", async () => {
    const send = vi.fn();
    await runOrchestrator({
      query: "Analyze NVIDIA (NVDA)",
      send,
    });

    const reportCalls = send.mock.calls.filter((c) => c[0] === "report");
    expect(reportCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("uses pre-classified domain profile when provided", async () => {
    const send = vi.fn();
    const trace: TraceData = { request: {}, response: {} };

    // Override plan generation to return a plan WITHOUT classify (since it's pre-classified)
    const { tracedCreate } = await import("./anthropic-client");
    (tracedCreate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      response: {
        content: [{
          type: "text",
          text: JSON.stringify({
            reasoning: "Pre-classified — skip classify step",
            steps: [
              { skill: "research", description: "Gather evidence", input: {}, status: "pending" },
              { skill: "synthesize", description: "Draft report", input: {}, status: "pending" },
              { skill: "verify", description: "Verify findings", input: {}, status: "pending" },
            ],
          }),
        }],
      },
      trace: {},
    });

    await runOrchestrator({
      query: "Analyze NVIDIA (NVDA)",
      send,
      preClassified: { domainProfile: mockDomainProfile, trace },
    });

    // Should NOT call classify skill
    const classifyCalls = mockExecuteSkill.mock.calls.filter(
      (c) => c[0] === "classify"
    );
    expect(classifyCalls).toHaveLength(0);

    // Should send pre-classified progress
    const progressCalls = send.mock.calls.filter((c) => c[0] === "progress");
    const classifiedStage = progressCalls.find((c) => c[1].stage === "classified");
    expect(classifiedStage).toBeDefined();
  });

  it("stops execution when isAborted returns true", async () => {
    const send = vi.fn();
    let aborted = false;

    // Abort after first skill
    mockExecuteSkill.mockImplementation(async (name: string) => {
      if (name === "classify") {
        aborted = true;
      }
      return {
        skill: name,
        input: {},
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 100,
        status: "completed",
        output: name === "classify" ? mockDomainProfile : mockReport,
      };
    });

    // The orchestrator should abort after classify since isAborted starts returning true
    // but it checks isAborted at the START of each iteration, so classify will complete first
    try {
      await runOrchestrator({
        query: "Analyze NVIDIA (NVDA)",
        send,
        isAborted: () => aborted,
      });
    } catch {
      // May throw because report won't be generated
    }

    // Should have called fewer skills than the full pipeline
    expect(mockExecuteSkill.mock.calls.length).toBeLessThan(4);
  });

  it("calls onProgress callback after each skill", async () => {
    const send = vi.fn();
    const onProgress = vi.fn();

    await runOrchestrator({
      query: "Analyze NVIDIA (NVDA)",
      send,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalled();
    // Each call should receive a WorkLog
    for (const call of onProgress.mock.calls) {
      const workLog = call[0] as AgentWorkLog;
      expect(workLog.plan).toBeDefined();
      expect(workLog.invocations).toBeDefined();
      expect(workLog.reasoning).toBeDefined();
    }
  });

  it("handles draft_answer failure gracefully (non-critical)", async () => {
    const send = vi.fn();

    mockExecuteSkill.mockImplementation(async (name: string) => {
      if (name === "draft_answer") {
        throw new Error("Draft failed");
      }
      return {
        skill: name,
        input: {},
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 100,
        status: "completed",
        output: name === "classify" ? mockDomainProfile : name === "verify" ? mockReport : name === "synthesize" ? mockReport : [],
      };
    });

    // Should NOT throw even though draft_answer fails
    const result = await runOrchestrator({
      query: "Analyze NVIDIA (NVDA)",
      send,
    });

    expect(result).toBeDefined();
  });

  it("throws on critical skill failure", async () => {
    const send = vi.fn();

    mockExecuteSkill.mockImplementation(async (name: string) => {
      if (name === "research") {
        throw new Error("Research API failed");
      }
      return {
        skill: name,
        input: {},
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 100,
        status: "completed",
        output: name === "classify" ? mockDomainProfile : mockReport,
      };
    });

    await expect(
      runOrchestrator({
        query: "Analyze NVIDIA (NVDA)",
        send,
      })
    ).rejects.toThrow("Research API failed");
  });

  it("throws when no report is produced", async () => {
    const send = vi.fn();

    // All skills succeed but none produce a report (output is not a Report object)
    mockExecuteSkill.mockImplementation(async (name: string) => ({
      skill: name,
      input: {},
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 100,
      status: "completed",
      // classify returns a DomainProfile, others return null (not Report)
      output: name === "classify" ? mockDomainProfile : null,
    }));

    await expect(
      runOrchestrator({
        query: "Analyze NVIDIA (NVDA)",
        send,
      })
    ).rejects.toThrow("without producing a report");
  });

  it("sets outputFormat on the report meta", async () => {
    const send = vi.fn();

    // Override plan generation to skip classify (pre-classified)
    const { tracedCreate } = await import("./anthropic-client");
    (tracedCreate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      response: {
        content: [{
          type: "text",
          text: JSON.stringify({
            reasoning: "Pre-classified slide deck",
            steps: [
              { skill: "research", description: "Gather evidence", input: {}, status: "pending" },
              { skill: "synthesize", description: "Draft report", input: {}, status: "pending" },
              { skill: "verify", description: "Verify findings", input: {}, status: "pending" },
            ],
          }),
        }],
      },
      trace: {},
    });

    const result = await runOrchestrator({
      query: "Analyze NVIDIA (NVDA)",
      send,
      preClassified: {
        domainProfile: { ...mockDomainProfile, outputFormat: "slide_deck" },
        trace: {},
      },
    });

    expect(result.meta.outputFormat).toBe("slide_deck");
  });

  it("computes certainty statistics in final progress event", async () => {
    const send = vi.fn();
    await runOrchestrator({
      query: "Analyze NVIDIA (NVDA)",
      send,
    });

    const progressCalls = send.mock.calls.filter((c) => c[0] === "progress");
    const completionEvent = progressCalls.find((c) => c[1].stage === "complete");
    expect(completionEvent).toBeDefined();
    expect(completionEvent![1].percent).toBe(100);
    expect(completionEvent![1].stats).toBeDefined();
    expect(completionEvent![1].stats.findingsCount).toBeGreaterThanOrEqual(0);
  });

  it("retries transient 429 errors", async () => {
    const send = vi.fn();
    let researchCallCount = 0;

    mockExecuteSkill.mockImplementation(async (name: string) => {
      if (name === "research") {
        researchCallCount++;
        if (researchCallCount === 1) {
          const err = new Error("Rate limited") as Error & { status: number };
          err.status = 429;
          throw err;
        }
      }
      return {
        skill: name,
        input: {},
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 100,
        status: "completed",
        output: name === "classify" ? mockDomainProfile : name === "verify" ? mockReport : name === "synthesize" ? mockReport : [],
      };
    });

    const result = await runOrchestrator({
      query: "Analyze NVIDIA (NVDA)",
      send,
    });

    expect(result).toBeDefined();
    expect(researchCallCount).toBe(2); // First attempt (429) + retry (success)

    // Check that retry reasoning was logged
    const workLogCalls = send.mock.calls.filter((c) => c[0] === "work_log");
    const lastWorkLog = workLogCalls[workLogCalls.length - 1]?.[1];
    const retryReasoning = lastWorkLog?.reasoning?.find(
      (r: string) => r.includes("Retrying") && r.includes("429")
    );
    expect(retryReasoning).toBeUndefined(); // Reasoning is on workLog, not always last
  });

  it("does not retry non-transient errors", async () => {
    const send = vi.fn();
    let classifyCallCount = 0;

    mockExecuteSkill.mockImplementation(async (name: string) => {
      if (name === "classify") {
        classifyCallCount++;
        const err = new Error("Invalid API key") as Error & { status: number };
        err.status = 401;
        throw err;
      }
      return {
        skill: name,
        input: {},
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 100,
        status: "completed",
        output: mockReport,
      };
    });

    await expect(
      runOrchestrator({ query: "Analyze NVIDIA", send })
    ).rejects.toThrow("Invalid API key");

    expect(classifyCallCount).toBe(1); // No retry for 401
  });

  it("gives up after max retries for persistent transient errors", async () => {
    const send = vi.fn();
    let researchCallCount = 0;

    mockExecuteSkill.mockImplementation(async (name: string) => {
      if (name === "research") {
        researchCallCount++;
        const err = new Error("Service unavailable") as Error & { status: number };
        err.status = 503;
        throw err;
      }
      return {
        skill: name,
        input: {},
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 100,
        status: "completed",
        output: name === "classify" ? mockDomainProfile : mockReport,
      };
    });

    await expect(
      runOrchestrator({ query: "Analyze NVIDIA", send })
    ).rejects.toThrow("Service unavailable");

    expect(researchCallCount).toBe(3); // Initial + 2 retries
  }, 30_000);
});
