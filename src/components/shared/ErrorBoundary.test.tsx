import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

// A component that always throws
function BrokenComponent(): never {
  throw new Error("Test render error");
}

// A component that conditionally throws
function ConditionallyBroken({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Conditional error");
  return <div>Working fine</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // Suppress console.error from React's error boundary logging
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );

    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("shows default fallback UI when a child throws", () => {
    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test render error")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("shows custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom error message</div>}>
        <BrokenComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Custom error message")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("calls onError callback when a child throws", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <BrokenComponent />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it("recovers when 'Try again' is clicked and child no longer throws", async () => {
    const user = userEvent.setup();

    // We'll use a variable to control whether the component throws
    let shouldThrow = true;

    function MaybeThrow() {
      if (shouldThrow) throw new Error("Initial error");
      return <div>Recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>
    );

    // Should show error state
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Fix the component
    shouldThrow = false;

    // Click "Try again"
    await user.click(screen.getByText("Try again"));

    // Rerender to pick up the state change
    rerender(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>
    );

    // Should show recovered content
    expect(screen.getByText("Recovered")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("catches errors from deeply nested children", () => {
    render(
      <ErrorBoundary>
        <div>
          <div>
            <BrokenComponent />
          </div>
        </div>
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
