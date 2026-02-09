import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import Report from "./Report";
import type { Report as ReportData, TraceEvent, Finding, Section } from "../../shared/types";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    section: "investment_thesis",
    text: "Revenue grew 30% year over year",
    certainty: 85,
    explanation: {
      title: "Revenue Growth",
      text: "The company reported strong revenue growth in Q4.",
      supportingEvidence: [
        { source: "SEC Filing", quote: "Revenue was $30B", url: "https://sec.gov/filing" },
      ],
      contraryEvidence: [],
    },
    ...overrides,
  };
}

function makeSection(overrides: Partial<Section> = {}): Section {
  return {
    id: "investment_thesis",
    title: "Investment Thesis",
    content: [
      { type: "finding", id: "f1" },
      { type: "text", value: " supports the thesis." },
    ],
    ...overrides,
  };
}

function makeReport(overrides: Partial<ReportData> = {}): ReportData {
  return {
    meta: {
      title: "NVIDIA (NVDA) Research Report",
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      exchangeName: "NASDAQ",
      overallCertainty: 85,
      outputFormat: "written_report",
      keyStats: [
        { label: "Market Cap", value: "$3.2T" },
        { label: "P/E Ratio", value: "65x" },
      ],
    } as ReportData["meta"],
    sections: [makeSection()],
    findings: [makeFinding()],
    ...overrides,
  };
}

function createProps(overrides: Partial<Parameters<typeof Report>[0]> = {}) {
  return {
    data: makeReport(),
    traceData: [] as TraceEvent[],
    onBack: vi.fn(),
    slug: "nvda-test",
    saveState: "idle" as const,
    ...overrides,
  };
}

describe("Report", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the report title", () => {
    render(<Report {...createProps()} />);
    expect(screen.getByText("NVIDIA (NVDA) Research Report")).toBeInTheDocument();
  });

  it("renders section titles", () => {
    render(<Report {...createProps()} />);
    expect(screen.getByText("Investment Thesis")).toBeInTheDocument();
  });

  it("renders finding text inline", () => {
    render(<Report {...createProps()} />);
    expect(screen.getByText("Revenue grew 30% year over year")).toBeInTheDocument();
  });

  it("renders text content between findings", () => {
    render(<Report {...createProps()} />);
    expect(screen.getByText(/supports the thesis/)).toBeInTheDocument();
  });

  it("renders key stats", () => {
    render(<Report {...createProps()} />);
    expect(screen.getByText("Market Cap")).toBeInTheDocument();
    expect(screen.getByText("$3.2T")).toBeInTheDocument();
  });

  it("renders overall certainty", () => {
    render(<Report {...createProps()} />);
    // Multiple elements show 85% (certainty badges, methodology text, etc.)
    const matches = screen.getAllByText(/85%/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders finding as clickable span", () => {
    render(<Report {...createProps()} />);
    const findingSpan = screen.getByText("Revenue grew 30% year over year");
    expect(findingSpan).toHaveAttribute("role", "button");
    expect(findingSpan).toHaveAttribute("tabindex", "0");
  });

  it("shows explanation panel when finding is clicked", () => {
    render(<Report {...createProps()} />);
    const findingSpan = screen.getByText("Revenue grew 30% year over year");
    fireEvent.click(findingSpan);

    // After clicking, the explanation panel should show
    expect(screen.getByText("Revenue Growth")).toBeInTheDocument();
    expect(screen.getByText(/strong revenue growth/)).toBeInTheDocument();
  });

  it("renders multiple sections", () => {
    const data = makeReport({
      sections: [
        makeSection(),
        makeSection({
          id: "key_risks",
          title: "Key Risks",
          content: [{ type: "finding", id: "f2" }],
        }),
      ],
      findings: [
        makeFinding(),
        makeFinding({
          id: "f2",
          section: "key_risks",
          text: "Competition from AMD is intensifying",
          certainty: 72,
        }),
      ],
    });
    render(<Report {...createProps({ data })} />);

    expect(screen.getByText("Investment Thesis")).toBeInTheDocument();
    expect(screen.getByText("Key Risks")).toBeInTheDocument();
    expect(screen.getByText("Competition from AMD is intensifying")).toBeInTheDocument();
  });

  it("renders sections with break content items", () => {
    const data = makeReport({
      sections: [
        makeSection({
          content: [
            { type: "finding", id: "f1" },
            { type: "break" },
            { type: "text", value: "Additional context here." },
          ],
        }),
      ],
    });
    render(<Report {...createProps({ data })} />);
    expect(screen.getByText(/Additional context here/)).toBeInTheDocument();
  });

  it("handles sections with text-only content alongside findings", () => {
    const data = makeReport({
      sections: [
        makeSection({
          content: [
            { type: "text", value: "Intro text. " },
            { type: "finding", id: "f1" },
          ],
        }),
      ],
      findings: [makeFinding()],
    });
    render(<Report {...createProps({ data })} />);
    expect(screen.getByText(/Intro text/)).toBeInTheDocument();
  });

  it("handles empty sections array with empty state message", () => {
    const data = makeReport({ sections: [], findings: [] });
    const { container } = render(<Report {...createProps({ data })} />);
    // Should show the empty state message or the title
    expect(container.textContent).toContain("NVIDIA");
  });

  it("handles missing meta gracefully", () => {
    const data = makeReport({
      meta: { title: "Minimal" } as ReportData["meta"],
    });
    const { container } = render(<Report {...createProps({ data })} />);
    expect(container.textContent).toContain("Minimal");
  });

  it("handles orphaned finding refs gracefully (no crash)", () => {
    // When a section has a ref to a non-existent finding, the component should
    // either skip it or render without crashing. Sections without valid findings
    // may be filtered out by the Report component.
    const data = makeReport({
      sections: [
        makeSection({
          content: [
            { type: "finding", id: "f_nonexistent" },
            { type: "text", value: " after orphan" },
          ],
        }),
      ],
      findings: [], // No findings to match
    });
    // Should not throw
    const { container } = render(<Report {...createProps({ data })} />);
    expect(container).toBeTruthy();
  });

  it("renders findings with different certainty levels", () => {
    const data = makeReport({
      sections: [
        makeSection({
          content: [
            { type: "finding", id: "f1" },
            { type: "text", value: " " },
            { type: "finding", id: "f2" },
            { type: "text", value: " " },
            { type: "finding", id: "f3" },
          ],
        }),
      ],
      findings: [
        makeFinding({ id: "f1", certainty: 95, text: "High certainty claim" }),
        makeFinding({ id: "f2", certainty: 60, text: "Medium certainty claim" }),
        makeFinding({ id: "f3", certainty: 30, text: "Low certainty claim" }),
      ],
    });
    render(<Report {...createProps({ data })} />);

    expect(screen.getByText("High certainty claim")).toBeInTheDocument();
    expect(screen.getByText("Medium certainty claim")).toBeInTheDocument();
    expect(screen.getByText("Low certainty claim")).toBeInTheDocument();
  });

  it("renders finding aria-label with certainty percentage", () => {
    render(<Report {...createProps()} />);
    const span = screen.getByText("Revenue grew 30% year over year");
    expect(span.getAttribute("aria-label")).toContain("85%");
  });
});
