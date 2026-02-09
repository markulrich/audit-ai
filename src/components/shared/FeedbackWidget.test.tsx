import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import FeedbackWidget from "./FeedbackWidget";

describe("FeedbackWidget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the rating prompt", () => {
    render(<FeedbackWidget findingId="f1" />);
    expect(screen.getByText("Rate this explanation")).toBeInTheDocument();
  });

  it("renders helpful and not helpful buttons", () => {
    render(<FeedbackWidget findingId="f1" />);
    expect(screen.getByLabelText("Helpful")).toBeInTheDocument();
    expect(screen.getByLabelText("Not helpful")).toBeInTheDocument();
  });

  it("shows textarea when helpful is clicked", () => {
    render(<FeedbackWidget findingId="f1" />);
    fireEvent.click(screen.getByLabelText("Helpful"));

    const textarea = screen.getByLabelText("Feedback details");
    expect(textarea).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What was helpful?")).toBeInTheDocument();
  });

  it("shows textarea with different placeholder when not helpful is clicked", () => {
    render(<FeedbackWidget findingId="f1" />);
    fireEvent.click(screen.getByLabelText("Not helpful"));

    expect(screen.getByPlaceholderText("What could be improved?")).toBeInTheDocument();
  });

  it("shows submit and cancel buttons after rating", () => {
    render(<FeedbackWidget findingId="f1" />);
    fireEvent.click(screen.getByLabelText("Helpful"));

    expect(screen.getByText("Submit")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("hides textarea when cancel is clicked", () => {
    render(<FeedbackWidget findingId="f1" />);
    fireEvent.click(screen.getByLabelText("Helpful"));
    expect(screen.getByLabelText("Feedback details")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByLabelText("Feedback details")).not.toBeInTheDocument();
  });

  it("shows thanks message after submit", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<FeedbackWidget findingId="f1" />);

    fireEvent.click(screen.getByLabelText("Helpful"));
    fireEvent.click(screen.getByText("Submit"));

    expect(screen.getByText("Thanks")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[feedback]",
      expect.objectContaining({ findingId: "f1", feedback: "up" })
    );
  });

  it("logs feedback with finding ID and text", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<FeedbackWidget findingId="f42" />);

    fireEvent.click(screen.getByLabelText("Not helpful"));
    const textarea = screen.getByLabelText("Feedback details");
    fireEvent.change(textarea, { target: { value: "Needs more sources" } });
    fireEvent.click(screen.getByText("Submit"));

    expect(consoleSpy).toHaveBeenCalledWith(
      "[feedback]",
      expect.objectContaining({
        findingId: "f42",
        feedback: "down",
        feedbackText: "Needs more sources",
      })
    );
  });

  it("does not show textarea initially", () => {
    render(<FeedbackWidget findingId="f1" />);
    expect(screen.queryByLabelText("Feedback details")).not.toBeInTheDocument();
  });

  it("does not show thanks message initially", () => {
    render(<FeedbackWidget findingId="f1" />);
    expect(screen.queryByText("Thanks")).not.toBeInTheDocument();
  });
});
