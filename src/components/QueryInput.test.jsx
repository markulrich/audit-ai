import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import QueryInput from "./QueryInput.jsx";

describe("QueryInput", () => {
  it("enables Generate only when query length is at least 3", async () => {
    const user = userEvent.setup();
    render(<QueryInput onSubmit={vi.fn()} disabled={false} />);

    const input = screen.getByRole("textbox");
    const button = screen.getByRole("button", { name: "Generate" });

    expect(button).toBeDisabled();
    await user.type(input, "NV");
    expect(button).toBeDisabled();
    await user.type(input, "D");
    expect(button).toBeEnabled();
  });

  it("submits a trimmed query", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QueryInput onSubmit={onSubmit} disabled={false} />);

    const input = screen.getByRole("textbox");
    const button = screen.getByRole("button", { name: "Generate" });

    await user.type(input, "  NVIDIA  ");
    await user.click(button);

    expect(onSubmit).toHaveBeenCalledWith("NVIDIA");
  });
});
