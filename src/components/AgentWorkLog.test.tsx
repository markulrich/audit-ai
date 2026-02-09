import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import AgentWorkLog from "./AgentWorkLog";
import type { AgentWorkLog as WorkLogType } from "../../shared/types";

describe("AgentWorkLog", () => {
  it("renders nothing when workLog is null", () => {
    const { container } = render(<AgentWorkLog workLog={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when workLog has empty plan and invocations", () => {
    const workLog: WorkLogType = { plan: [], invocations: [], reasoning: [] };
    const { container } = render(<AgentWorkLog workLog={workLog} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the plan header", () => {
    const workLog: WorkLogType = {
      plan: [
        { skill: "classify", description: "Classify query", input: {}, status: "completed" },
        { skill: "research", description: "Research evidence", input: {}, status: "running" },
      ],
      invocations: [],
      reasoning: [],
    };

    render(<AgentWorkLog workLog={workLog} />);

    expect(screen.getByText("Agent Plan")).toBeInTheDocument();
  });

  it("shows progress count and percentage", () => {
    const workLog: WorkLogType = {
      plan: [
        { skill: "classify", description: "Classify query", input: {}, status: "completed" },
        { skill: "research", description: "Research evidence", input: {}, status: "completed" },
        { skill: "synthesize", description: "Synthesize report", input: {}, status: "running" },
        { skill: "verify", description: "Verify report", input: {}, status: "pending" },
      ],
      invocations: [],
      reasoning: [],
    };

    render(<AgentWorkLog workLog={workLog} />);

    expect(screen.getByText("2/4 steps (50%)")).toBeInTheDocument();
  });

  it("renders skill labels for each step", () => {
    const workLog: WorkLogType = {
      plan: [
        { skill: "classify", description: "Classify query", input: {}, status: "completed" },
        { skill: "research", description: "Research evidence", input: {}, status: "pending" },
        { skill: "analyze_attachment", description: "Analyze file", input: {}, status: "pending" },
      ],
      invocations: [],
      reasoning: [],
    };

    render(<AgentWorkLog workLog={workLog} />);

    expect(screen.getByText("Classify")).toBeInTheDocument();
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Analyze Attachment")).toBeInTheDocument();
  });

  it("renders step descriptions", () => {
    const workLog: WorkLogType = {
      plan: [
        { skill: "classify", description: "Identify domain and company", input: {}, status: "completed" },
      ],
      invocations: [],
      reasoning: [],
    };

    render(<AgentWorkLog workLog={workLog} />);

    expect(screen.getByText("Identify domain and company")).toBeInTheDocument();
  });

  it("renders status labels for each step", () => {
    const workLog: WorkLogType = {
      plan: [
        { skill: "classify", description: "Classify", input: {}, status: "completed" },
        { skill: "research", description: "Research", input: {}, status: "running" },
        { skill: "synthesize", description: "Synthesize", input: {}, status: "pending" },
        { skill: "verify", description: "Verify", input: {}, status: "failed" },
      ],
      invocations: [],
      reasoning: [],
    };

    render(<AgentWorkLog workLog={workLog} />);

    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("shows the latest reasoning text", () => {
    const workLog: WorkLogType = {
      plan: [
        { skill: "classify", description: "Classify", input: {}, status: "completed" },
      ],
      invocations: [],
      reasoning: [
        "Starting pipeline",
        "Classification complete — identified NVIDIA (NVDA)",
      ],
    };

    render(<AgentWorkLog workLog={workLog} />);

    expect(screen.getByText("Classification complete — identified NVIDIA (NVDA)")).toBeInTheDocument();
  });

  it("shows invocation duration stats", () => {
    const workLog: WorkLogType = {
      plan: [
        { skill: "classify", description: "Classify", input: {}, status: "completed" },
        { skill: "research", description: "Research", input: {}, status: "completed" },
      ],
      invocations: [
        {
          skill: "classify",
          input: {},
          startedAt: "2026-02-09T00:00:00Z",
          completedAt: "2026-02-09T00:00:01Z",
          durationMs: 1500,
          status: "completed",
        },
        {
          skill: "research",
          input: {},
          startedAt: "2026-02-09T00:00:01Z",
          completedAt: "2026-02-09T00:00:05Z",
          durationMs: 4200,
          status: "completed",
        },
      ],
      reasoning: [],
    };

    render(<AgentWorkLog workLog={workLog} />);

    expect(screen.getByText("1.5s")).toBeInTheDocument();
    expect(screen.getByText("4.2s")).toBeInTheDocument();
  });

  it("hides failed invocations from duration stats", () => {
    const workLog: WorkLogType = {
      plan: [
        { skill: "classify", description: "Classify", input: {}, status: "completed" },
        { skill: "draft_answer", description: "Draft", input: {}, status: "failed" },
      ],
      invocations: [
        {
          skill: "classify",
          input: {},
          startedAt: "2026-02-09T00:00:00Z",
          completedAt: "2026-02-09T00:00:01Z",
          durationMs: 1000,
          status: "completed",
        },
        {
          skill: "draft_answer",
          input: {},
          startedAt: "2026-02-09T00:00:01Z",
          completedAt: "2026-02-09T00:00:01Z",
          durationMs: 500,
          status: "failed",
        },
      ],
      reasoning: [],
    };

    render(<AgentWorkLog workLog={workLog} />);

    // Only classify duration should show
    expect(screen.getByText("1.0s")).toBeInTheDocument();
    // Draft answer should not show duration
    expect(screen.queryByText("0.5s")).not.toBeInTheDocument();
  });

  it("handles 0% progress when no steps completed", () => {
    const workLog: WorkLogType = {
      plan: [
        { skill: "classify", description: "Classify", input: {}, status: "pending" },
        { skill: "research", description: "Research", input: {}, status: "pending" },
      ],
      invocations: [],
      reasoning: [],
    };

    render(<AgentWorkLog workLog={workLog} />);

    expect(screen.getByText("0/2 steps (0%)")).toBeInTheDocument();
  });

  it("handles 100% progress when all steps completed", () => {
    const workLog: WorkLogType = {
      plan: [
        { skill: "classify", description: "Classify", input: {}, status: "completed" },
        { skill: "research", description: "Research", input: {}, status: "completed" },
      ],
      invocations: [],
      reasoning: [],
    };

    render(<AgentWorkLog workLog={workLog} />);

    expect(screen.getByText("2/2 steps (100%)")).toBeInTheDocument();
  });
});
