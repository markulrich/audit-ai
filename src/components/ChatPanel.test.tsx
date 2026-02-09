import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import ChatPanel from "./ChatPanel";
import type { ChatMessage, ProgressEvent, ErrorInfo, TraceEvent } from "../../shared/types";

// Default props for tests
function createProps(overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  return {
    messages: [] as ChatMessage[],
    isGenerating: false,
    liveProgress: [] as ProgressEvent[],
    liveError: null as ErrorInfo | null,
    liveTraceData: [] as TraceEvent[],
    onSend: vi.fn(),
    onAbort: vi.fn(),
    onNewConversation: vi.fn(),
    reasoningLevel: "x-light",
    onReasoningLevelChange: vi.fn(),
    ...overrides,
  };
}

describe("ChatPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders example chips when no messages exist", () => {
    render(<ChatPanel {...createProps()} />);
    expect(screen.getByText("Analyze NVIDIA (NVDA)")).toBeInTheDocument();
  });

  it("sends message when an example chip is clicked", async () => {
    const onSend = vi.fn();
    render(<ChatPanel {...createProps({ onSend })} />);

    const user = userEvent.setup();
    await user.click(screen.getByText("Analyze NVIDIA (NVDA)"));

    expect(onSend).toHaveBeenCalledWith("Analyze NVIDIA (NVDA)");
  });

  it("shows input field for typing messages", () => {
    render(<ChatPanel {...createProps()} />);
    const input = screen.getByPlaceholderText(/Enter a company or research topic/i);
    expect(input).toBeInTheDocument();
  });

  it("sends typed message on Enter", async () => {
    const onSend = vi.fn();
    render(<ChatPanel {...createProps({ onSend })} />);

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText(/Enter a company or research topic/i);
    await user.type(input, "Analyze Apple{Enter}");

    expect(onSend).toHaveBeenCalledWith("Analyze Apple");
  });

  it("renders user messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "What about Tesla?" },
    ];
    render(<ChatPanel {...createProps({ messages })} />);

    expect(screen.getByText("What about Tesla?")).toBeInTheDocument();
  });

  it("renders assistant messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Research complete." },
    ];
    render(<ChatPanel {...createProps({ messages })} />);

    expect(screen.getByText("Research complete.")).toBeInTheDocument();
  });

  it("shows stop button when generating", () => {
    render(<ChatPanel {...createProps({
      isGenerating: true,
      messages: [{ role: "user", content: "Analyze NVDA" }],
    })} />);

    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("calls onAbort when stop button is clicked", async () => {
    const onAbort = vi.fn();
    render(<ChatPanel {...createProps({
      isGenerating: true,
      onAbort,
      messages: [{ role: "user", content: "Analyze NVDA" }],
    })} />);

    const user = userEvent.setup();
    await user.click(screen.getByText("Stop"));

    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("renders ProgressStream when generating with progress", () => {
    const progress: ProgressEvent[] = [
      { stage: "classifying", message: "Classifying domain...", percent: 10 },
    ];

    const { container } = render(<ChatPanel {...createProps({
      isGenerating: true,
      liveProgress: progress,
      messages: [{ role: "user", content: "Analyze NVDA" }],
    })} />);

    // ProgressStream should be rendered (it has the progress indicators)
    // Check that the DOM contains progress-related content
    expect(container.textContent).toContain("Classify");
  });

  it("renders ProgressStream with error prop when error exists", () => {
    const error: ErrorInfo = { message: "API rate limit exceeded", detail: { stage: "classifier" } };

    const { container } = render(<ChatPanel {...createProps({
      isGenerating: true,
      liveError: error,
      liveProgress: [{ stage: "classifying", message: "Classifying...", percent: 5 }],
      messages: [{ role: "user", content: "Analyze NVDA" }],
    })} />);

    // The ProgressStream should be rendered with the error state
    // The Classify Query card should show the error
    expect(container.textContent).toContain("API rate limit exceeded");
  });

  it("shows reasoning level selector", () => {
    render(<ChatPanel {...createProps()} />);

    // The reasoning level selector should show the current level
    expect(screen.getByText(/X-Light/i)).toBeInTheDocument();
  });

  it("shows new conversation button", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Test" },
    ];
    render(<ChatPanel {...createProps({ messages })} />);

    const newBtn = screen.getByTitle("New conversation");
    expect(newBtn).toBeInTheDocument();
  });

  it("shows follow-up placeholder when messages exist", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Analyze NVDA" },
    ];
    render(<ChatPanel {...createProps({ messages })} />);

    const input = screen.getByPlaceholderText(/follow-up/i);
    expect(input).toBeInTheDocument();
  });
});
