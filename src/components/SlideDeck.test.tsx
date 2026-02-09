import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SlideDeck from "./SlideDeck";
import type { Report, Finding, Section, TraceEvent } from "../../shared/types";

// Mock useIsMobile to control mobile behavior
vi.mock("./shared/useIsMobile", () => ({
  useIsMobile: () => false,
}));

function makeFinding(id: string, section: string, text: string, certainty = 85): Finding {
  return {
    id,
    section,
    text,
    certainty,
    explanation: {
      title: `Explanation for ${id}`,
      text: `Detailed explanation for finding ${id}`,
      supportingEvidence: [
        { source: "Source A", quote: "Evidence quote", url: "https://example.com" },
      ],
      contraryEvidence: [],
    },
  };
}

function makeSection(id: string, title: string, findingIds: string[], opts?: Partial<Section>): Section {
  return {
    id,
    title,
    content: findingIds.map((fId) => ({ type: "finding" as const, id: fId })),
    ...opts,
  };
}

function makeReport(overrides?: Partial<Report>): Report {
  return {
    meta: {
      title: "Test Slide Deck",
      subtitle: "Q4 2025 Analysis",
      overallCertainty: 85,
      outputFormat: "slide_deck",
    },
    sections: [
      makeSection("title_slide", "Title", [], { layout: "title" }),
      makeSection("problem", "The Problem", ["f1", "f2"]),
      makeSection("solution", "Our Solution", ["f3"]),
    ],
    findings: [
      makeFinding("f1", "problem", "Market is fragmented"),
      makeFinding("f2", "problem", "Current solutions are slow", 72),
      makeFinding("f3", "solution", "Our platform unifies the workflow", 91),
    ],
    ...overrides,
  };
}

function createProps(overrides?: Partial<Parameters<typeof SlideDeck>[0]>) {
  return {
    data: makeReport(),
    traceData: [] as TraceEvent[],
    onBack: vi.fn(),
    slug: "test-deck",
    saveState: "idle" as const,
    ...overrides,
  };
}

describe("SlideDeck", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── Basic rendering ──────────────────────────────────────────────────────

  it("renders the deck title in the top bar", () => {
    render(<SlideDeck {...createProps()} />);
    // Title appears in top bar and also on the title slide heading
    const matches = screen.getAllByText("Test Slide Deck");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Back button", () => {
    render(<SlideDeck {...createProps()} />);
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("calls onBack when Back button is clicked", () => {
    const onBack = vi.fn();
    render(<SlideDeck {...createProps({ onBack })} />);
    fireEvent.click(screen.getByText("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders slide counter '1 / 3'", () => {
    render(<SlideDeck {...createProps()} />);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("renders Previous and Next buttons", () => {
    render(<SlideDeck {...createProps()} />);
    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
  });

  it("renders overall certainty badge", () => {
    render(<SlideDeck {...createProps()} />);
    // CertaintyBadge renders the percentage
    expect(screen.getByText(/85%/)).toBeInTheDocument();
  });

  it("shows 'Saved' indicator when saveState is saved", () => {
    render(<SlideDeck {...createProps({ saveState: "saved" })} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("does not show 'Saved' when saveState is idle", () => {
    render(<SlideDeck {...createProps({ saveState: "idle" })} />);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  // ── Title slide ────────────────────────────────────────────────────────

  it("renders title slide content from meta.title", () => {
    render(<SlideDeck {...createProps()} />);
    // Title slide shows meta.title as the main heading
    const headings = screen.getAllByText("Test Slide Deck");
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it("renders subtitle/tagline on title slide", () => {
    const data = makeReport();
    data.meta.tagline = "Comprehensive Equity Analysis";
    render(<SlideDeck {...createProps({ data })} />);
    expect(screen.getByText("Comprehensive Equity Analysis")).toBeInTheDocument();
  });

  it("renders company description on title slide", () => {
    const data = makeReport();
    data.meta.companyDescription = "AI-powered audit platform";
    render(<SlideDeck {...createProps({ data })} />);
    expect(screen.getByText("AI-powered audit platform")).toBeInTheDocument();
  });

  it("renders funding ask on title slide", () => {
    const data = makeReport();
    data.meta.fundingAsk = "Raising $5M Series A";
    render(<SlideDeck {...createProps({ data })} />);
    expect(screen.getByText("Raising $5M Series A")).toBeInTheDocument();
  });

  it("renders key stats on title slide", () => {
    const data = makeReport();
    data.meta.keyStats = [
      { label: "Revenue", value: "$10M" },
      { label: "Growth", value: "25%" },
    ];
    render(<SlideDeck {...createProps({ data })} />);
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("$10M")).toBeInTheDocument();
    expect(screen.getByText("Growth")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  // ── Slide navigation ──────────────────────────────────────────────────

  it("navigates to next slide when Next is clicked", () => {
    render(<SlideDeck {...createProps()} />);
    fireEvent.click(screen.getByText("Next"));
    // Should now show slide 2 / 3
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("navigates back with Previous button", () => {
    render(<SlideDeck {...createProps()} />);
    // Go to slide 2
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    // Go back to slide 1
    fireEvent.click(screen.getByText("Previous"));
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("disables Previous on first slide", () => {
    render(<SlideDeck {...createProps()} />);
    const prevBtn = screen.getByText("Previous");
    expect(prevBtn).toBeDisabled();
  });

  it("disables Next on last slide", () => {
    render(<SlideDeck {...createProps()} />);
    // Go to last slide (slide 3)
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    const nextBtn = screen.getByText("Next");
    expect(nextBtn).toBeDisabled();
  });

  // ── Thumbnail navigation ────────────────────────────────────────────

  it("renders thumbnail buttons for each section", () => {
    render(<SlideDeck {...createProps()} />);
    // 3 sections = 3 thumbnail buttons (plus Previous/Next/Back = other buttons)
    const thumbnails = screen.getAllByRole("button").filter(
      (btn) => btn.textContent?.match(/^\d+\./)
    );
    expect(thumbnails).toHaveLength(3);
  });

  it("navigates to specific slide via thumbnail", () => {
    render(<SlideDeck {...createProps()} />);
    // Click on the third thumbnail
    const thumbnails = screen.getAllByRole("button").filter(
      (btn) => btn.textContent?.match(/^3\./)
    );
    expect(thumbnails).toHaveLength(1);
    fireEvent.click(thumbnails[0]);
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });

  // ── Content slides ──────────────────────────────────────────────────

  it("renders findings as bullet cards on content slide", () => {
    render(<SlideDeck {...createProps()} />);
    // Navigate to "The Problem" slide
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("The Problem")).toBeInTheDocument();
    expect(screen.getByText("Market is fragmented")).toBeInTheDocument();
    expect(screen.getByText("Current solutions are slow")).toBeInTheDocument();
  });

  it("shows slide title from SLIDE_TITLES map", () => {
    render(<SlideDeck {...createProps()} />);
    fireEvent.click(screen.getByText("Next")); // problem slide
    expect(screen.getByText("The Problem")).toBeInTheDocument();
  });

  it("shows 'No verified findings' message for empty content slide", () => {
    const data = makeReport();
    data.sections = [
      makeSection("title_slide", "Title", [], { layout: "title" }),
      makeSection("empty_section", "Empty", []),
    ];
    render(<SlideDeck {...createProps({ data })} />);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("No verified findings for this slide.")).toBeInTheDocument();
  });

  // ── Finding interactions ──────────────────────────────────────────────

  it("opens explanation panel when finding is clicked", () => {
    render(<SlideDeck {...createProps()} />);
    fireEvent.click(screen.getByText("Next")); // Go to problem slide

    // Click on a finding
    const findingBtn = screen.getByRole("button", { name: /Market is fragmented/ });
    fireEvent.click(findingBtn);

    // Explanation panel should appear
    expect(screen.getByRole("complementary", { name: "Explanation panel" })).toBeInTheDocument();
    expect(screen.getByText("Explanation for f1")).toBeInTheDocument();
  });

  it("shows certainty percentage on finding bullets", () => {
    render(<SlideDeck {...createProps()} />);
    fireEvent.click(screen.getByText("Next")); // Go to problem slide
    // 85% may match both the overall certainty badge and finding bullet
    expect(screen.getAllByText("85%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("activates finding via keyboard Enter", () => {
    render(<SlideDeck {...createProps()} />);
    fireEvent.click(screen.getByText("Next"));

    const findingBtn = screen.getByRole("button", { name: /Market is fragmented/ });
    fireEvent.keyDown(findingBtn, { key: "Enter" });

    expect(screen.getByRole("complementary", { name: "Explanation panel" })).toBeInTheDocument();
  });

  // ── Speaker notes ──────────────────────────────────────────────────

  it("shows speaker notes toggle when section has notes", () => {
    const data = makeReport();
    data.sections[1].speakerNotes = "Key talking points for this slide";
    render(<SlideDeck {...createProps({ data })} />);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Speaker Notes")).toBeInTheDocument();
  });

  it("does not show speaker notes toggle when section has no notes", () => {
    render(<SlideDeck {...createProps()} />);
    expect(screen.queryByText("Speaker Notes")).not.toBeInTheDocument();
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  it("handles empty sections array", () => {
    const data = makeReport();
    data.sections = [];
    const { container } = render(<SlideDeck {...createProps({ data })} />);
    expect(container).toBeTruthy();
  });

  it("handles empty findings array", () => {
    const data = makeReport();
    data.findings = [];
    render(<SlideDeck {...createProps({ data })} />);
    const matches = screen.getAllByText("Test Slide Deck");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("handles missing meta.title with fallback", () => {
    const data = makeReport();
    data.meta.title = "";
    render(<SlideDeck {...createProps({ data })} />);
    expect(screen.getByText("Slide Deck")).toBeInTheDocument();
  });

  it("calculates overall certainty when meta.overallCertainty is absent", () => {
    const data = makeReport();
    delete data.meta.overallCertainty;
    // Findings have certainties: 85, 72, 91 → average ~83
    render(<SlideDeck {...createProps({ data })} />);
    expect(screen.getByText(/83%/)).toBeInTheDocument();
  });

  it("handles subtitle on content slides", () => {
    const data = makeReport();
    data.sections[1].subtitle = "Critical market challenges";
    render(<SlideDeck {...createProps({ data })} />);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Critical market challenges")).toBeInTheDocument();
  });

  it("filters out findings not in findingsMap on content slides", () => {
    const data = makeReport();
    // Add a reference to a non-existent finding
    data.sections[1].content.push({ type: "finding", id: "f999" });
    render(<SlideDeck {...createProps({ data })} />);
    fireEvent.click(screen.getByText("Next"));
    // Only real findings should render, not the orphaned ref
    expect(screen.getByText("Market is fragmented")).toBeInTheDocument();
    expect(screen.queryByText(/f999/)).not.toBeInTheDocument();
  });

  it("updates document title on mount", () => {
    render(<SlideDeck {...createProps()} />);
    expect(document.title).toBe("Test Slide Deck — DoublyAI");
  });

  it("restores document title on unmount", () => {
    const originalTitle = document.title;
    const { unmount } = render(<SlideDeck {...createProps()} />);
    expect(document.title).toBe("Test Slide Deck — DoublyAI");
    unmount();
    expect(document.title).toBe(originalTitle);
  });
});
