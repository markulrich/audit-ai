import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import CertaintyBadge from "./CertaintyBadge";

describe("CertaintyBadge", () => {
  it("renders the certainty percentage", () => {
    render(<CertaintyBadge value={85} />);
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("renders the certainty label", () => {
    render(<CertaintyBadge value={85} />);
    expect(screen.getByText("Moderate-High")).toBeInTheDocument();
  });

  it("has correct aria-label", () => {
    render(<CertaintyBadge value={85} />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAttribute("aria-label", "Certainty: 85%, Moderate-High");
  });

  it("renders High label for > 90%", () => {
    render(<CertaintyBadge value={95} />);
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
  });

  it("renders Moderate label for 50-74%", () => {
    render(<CertaintyBadge value={60} />);
    expect(screen.getByText("Moderate")).toBeInTheDocument();
  });

  it("renders Low label for < 50%", () => {
    render(<CertaintyBadge value={30} />);
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("renders larger when large prop is true", () => {
    const { container } = render(<CertaintyBadge value={85} large />);
    const badge = container.querySelector("[role='status']") as HTMLElement;
    expect(badge.style.fontSize).toBe("14px");
  });

  it("renders smaller by default (no large prop)", () => {
    const { container } = render(<CertaintyBadge value={85} />);
    const badge = container.querySelector("[role='status']") as HTMLElement;
    expect(badge.style.fontSize).toBe("12px");
  });

  it("handles edge case of 0%", () => {
    render(<CertaintyBadge value={0} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("handles edge case of 100%", () => {
    render(<CertaintyBadge value={100} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });
});
