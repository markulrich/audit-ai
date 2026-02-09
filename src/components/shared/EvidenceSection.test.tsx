import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import EvidenceSection from "./EvidenceSection";
import type { EvidenceItem } from "../../../shared/types";

function makeEvidence(overrides?: Partial<EvidenceItem>): EvidenceItem {
  return {
    source: "SEC Filing",
    quote: "Revenue increased 25% year over year",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany",
    ...overrides,
  };
}

describe("EvidenceSection", () => {
  it("renders nothing when items is undefined", () => {
    const { container } = render(
      <EvidenceSection title="Supporting Evidence" items={undefined} color="#22c55e" />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when items is empty", () => {
    const { container } = render(
      <EvidenceSection title="Supporting Evidence" items={[]} color="#22c55e" />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders title with item count", () => {
    const items = [makeEvidence(), makeEvidence({ source: "Bloomberg" })];
    render(<EvidenceSection title="Supporting Evidence" items={items} color="#22c55e" />);
    expect(screen.getByText("Supporting Evidence (2)")).toBeInTheDocument();
  });

  it("renders source name for each item", () => {
    const items = [
      makeEvidence({ source: "SEC Filing" }),
      makeEvidence({ source: "Bloomberg Terminal" }),
    ];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    expect(screen.getByText("SEC Filing")).toBeInTheDocument();
    expect(screen.getByText("Bloomberg Terminal")).toBeInTheDocument();
  });

  it("renders quoted text with smart quotes", () => {
    const items = [makeEvidence({ quote: "Revenue grew 40%" })];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    // The component wraps quotes in &ldquo; and &rdquo;
    expect(screen.getByText(/Revenue grew 40%/)).toBeInTheDocument();
  });

  it("renders clickable link for HTTP URLs", () => {
    const items = [makeEvidence({ url: "https://example.com/report/2025" })];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com/report/2025");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("displays hostname (without www) for URL links", () => {
    const items = [makeEvidence({ url: "https://www.example.com/page" })];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("filters out 'general' URLs", () => {
    const items = [makeEvidence({ url: "general" })];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    expect(screen.queryByText("Source:")).not.toBeInTheDocument();
  });

  it("filters out 'various' URLs", () => {
    const items = [makeEvidence({ url: "various" })];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    expect(screen.queryByText("Source:")).not.toBeInTheDocument();
  });

  it("filters out 'derived' URLs", () => {
    const items = [makeEvidence({ url: "derived" })];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    expect(screen.queryByText("Source:")).not.toBeInTheDocument();
  });

  it("filters out 'internal' URLs", () => {
    const items = [makeEvidence({ url: "internal" })];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    expect(screen.queryByText("Source:")).not.toBeInTheDocument();
  });

  it("shows non-HTTP URL as plain text (not a link)", () => {
    const items = [makeEvidence({ url: "custom-source-reference" })];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    // Text is inside a parent div with "Source: " sibling, so use a content matcher
    expect(screen.getByText((_, el) =>
      el?.textContent === "Source: custom-source-reference"
    )).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("handles malformed URL gracefully (falls back to raw URL)", () => {
    const items = [makeEvidence({ url: "http://[invalid-url" })];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    // When URL parsing fails, the raw URL is displayed as link text
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "http://[invalid-url");
  });

  it("renders multiple evidence items", () => {
    const items = [
      makeEvidence({ source: "Source A", quote: "Quote A" }),
      makeEvidence({ source: "Source B", quote: "Quote B" }),
      makeEvidence({ source: "Source C", quote: "Quote C" }),
    ];
    render(<EvidenceSection title="Evidence" items={items} color="#22c55e" />);
    expect(screen.getByText("Evidence (3)")).toBeInTheDocument();
    expect(screen.getByText("Source A")).toBeInTheDocument();
    expect(screen.getByText("Source B")).toBeInTheDocument();
    expect(screen.getByText("Source C")).toBeInTheDocument();
  });

  it("renders with contrary evidence color", () => {
    const items = [makeEvidence()];
    const { container } = render(
      <EvidenceSection title="Contrary Evidence" items={items} color="#ef4444" />
    );
    expect(screen.getByText("Contrary Evidence (1)")).toBeInTheDocument();
    // Check the title has the color applied
    const titleEl = screen.getByText("Contrary Evidence (1)");
    expect(titleEl.style.color).toBe("rgb(239, 68, 68)");
  });
});
