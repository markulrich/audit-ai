import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ExplanationPanel from "./ExplanationPanel";
import type { Finding, MethodologyData } from "../../../shared/types";

function makeFinding(overrides?: Partial<Finding>): Finding {
  return {
    id: "f1",
    section: "investment_thesis",
    text: "Revenue grew 25% year over year",
    certainty: 85,
    explanation: {
      title: "Strong Revenue Growth",
      text: "The company demonstrated significant revenue growth driven by cloud services.",
      supportingEvidence: [
        { source: "SEC Filing", quote: "Revenue increased to $10B", url: "https://sec.gov/filing" },
      ],
      contraryEvidence: [
        { source: "Analyst Report", quote: "Growth may slow next quarter", url: "https://example.com/report" },
      ],
    },
    ...overrides,
  };
}

const defaultMethodology: MethodologyData = {
  explanation: {
    title: "Research Methodology",
    text: "Multi-agent pipeline analysis with adversarial verification.",
    supportingEvidence: [
      { source: "Pipeline", quote: "4-stage verification process", url: "internal" },
    ],
    contraryEvidence: [],
  },
};

describe("ExplanationPanel", () => {
  const baseProps = {
    activeData: makeFinding(),
    isOverview: false,
    findingIndex: 0,
    total: 5,
    onNavigate: vi.fn(),
    overallCertainty: 82,
    findingsCount: 5,
    overviewData: defaultMethodology,
  };

  it("renders nothing when activeData is null", () => {
    const { container } = render(
      <ExplanationPanel {...baseProps} activeData={null} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders Explanation header", () => {
    render(<ExplanationPanel {...baseProps} />);
    expect(screen.getByText("Explanation")).toBeInTheDocument();
  });

  it("renders with complementary role and aria-label", () => {
    render(<ExplanationPanel {...baseProps} />);
    expect(screen.getByRole("complementary", { name: "Explanation panel" })).toBeInTheDocument();
  });

  it("renders finding title from explanation", () => {
    render(<ExplanationPanel {...baseProps} />);
    expect(screen.getByText("Strong Revenue Growth")).toBeInTheDocument();
  });

  it("renders finding text in italic block", () => {
    render(<ExplanationPanel {...baseProps} />);
    expect(screen.getByText(/Revenue grew 25% year over year/)).toBeInTheDocument();
  });

  it("renders explanation text", () => {
    render(<ExplanationPanel {...baseProps} />);
    expect(screen.getByText(/demonstrated significant revenue growth/)).toBeInTheDocument();
  });

  it("renders certainty badge", () => {
    render(<ExplanationPanel {...baseProps} />);
    expect(screen.getByText("Certainty")).toBeInTheDocument();
    // CertaintyBadge renders the percentage
    expect(screen.getByText(/85%/)).toBeInTheDocument();
  });

  it("displays finding navigation '1 of 5'", () => {
    render(<ExplanationPanel {...baseProps} findingIndex={0} total={5} />);
    expect(screen.getByText("1 of 5")).toBeInTheDocument();
  });

  it("displays navigation for middle finding '3 of 10'", () => {
    render(<ExplanationPanel {...baseProps} findingIndex={2} total={10} />);
    expect(screen.getByText("3 of 10")).toBeInTheDocument();
  });

  it("renders prev and next navigation buttons", () => {
    render(<ExplanationPanel {...baseProps} />);
    expect(screen.getByLabelText("Previous finding")).toBeInTheDocument();
    expect(screen.getByLabelText("Next finding")).toBeInTheDocument();
  });

  it("calls onNavigate(-1) when prev button clicked", () => {
    const onNavigate = vi.fn();
    render(<ExplanationPanel {...baseProps} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByLabelText("Previous finding"));
    expect(onNavigate).toHaveBeenCalledWith(-1);
  });

  it("calls onNavigate(1) when next button clicked", () => {
    const onNavigate = vi.fn();
    render(<ExplanationPanel {...baseProps} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByLabelText("Next finding"));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it("renders supporting evidence section", () => {
    render(<ExplanationPanel {...baseProps} />);
    expect(screen.getByText("Supporting Evidence (1)")).toBeInTheDocument();
    expect(screen.getByText("SEC Filing")).toBeInTheDocument();
  });

  it("renders contrary evidence section", () => {
    render(<ExplanationPanel {...baseProps} />);
    expect(screen.getByText("Contrary Evidence (1)")).toBeInTheDocument();
    expect(screen.getByText("Analyst Report")).toBeInTheDocument();
  });

  it("renders FeedbackWidget", () => {
    render(<ExplanationPanel {...baseProps} />);
    expect(screen.getByText("Rate this explanation")).toBeInTheDocument();
  });

  // Overview mode tests
  it("shows 'Overview' label in overview mode", () => {
    render(
      <ExplanationPanel
        {...baseProps}
        activeData={{ explanation: {} }}
        isOverview={true}
      />
    );
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });

  it("shows methodology title in overview mode", () => {
    render(
      <ExplanationPanel
        {...baseProps}
        activeData={{ explanation: {} }}
        isOverview={true}
        overviewData={defaultMethodology}
      />
    );
    expect(screen.getByText("Research Methodology")).toBeInTheDocument();
  });

  it("shows methodology text in overview mode", () => {
    render(
      <ExplanationPanel
        {...baseProps}
        activeData={{ explanation: {} }}
        isOverview={true}
        overviewData={defaultMethodology}
      />
    );
    expect(screen.getByText(/Multi-agent pipeline analysis/)).toBeInTheDocument();
  });

  it("shows overall certainty in overview mode", () => {
    render(
      <ExplanationPanel
        {...baseProps}
        activeData={{ explanation: {} }}
        isOverview={true}
        overallCertainty={78}
      />
    );
    expect(screen.getByText(/78%/)).toBeInTheDocument();
  });

  it("shows fallback methodology text when overviewData is undefined", () => {
    render(
      <ExplanationPanel
        {...baseProps}
        activeData={{ explanation: {} }}
        isOverview={true}
        overviewData={undefined}
        overallCertainty={82}
        findingsCount={15}
      />
    );
    expect(screen.getByText(/multi-agent pipeline/)).toBeInTheDocument();
    // 82% appears in both CertaintyBadge and fallback text
    expect(screen.getAllByText(/82%/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows fallback title 'Report Methodology' when overviewData has no title", () => {
    render(
      <ExplanationPanel
        {...baseProps}
        activeData={{ explanation: {} }}
        isOverview={true}
        overviewData={undefined}
      />
    );
    expect(screen.getByText("Report Methodology")).toBeInTheDocument();
  });

  it("shows fallback title 'Explanation' when finding has no explanation title", () => {
    const finding = makeFinding();
    finding.explanation.title = "";
    render(
      <ExplanationPanel
        {...baseProps}
        activeData={finding}
        isOverview={false}
      />
    );
    // The header always says "Explanation" and when title is empty, the h3 also falls back to "Explanation"
    const matches = screen.getAllByText("Explanation");
    expect(matches.length).toBeGreaterThanOrEqual(2); // header + h3 fallback
  });

  it("uses finding certainty in non-overview mode", () => {
    const finding = makeFinding({ certainty: 92 });
    render(
      <ExplanationPanel
        {...baseProps}
        activeData={finding}
        isOverview={false}
        overallCertainty={50}
      />
    );
    // Should show the finding's 92%, not the overall 50%
    expect(screen.getByText(/92%/)).toBeInTheDocument();
  });
});
