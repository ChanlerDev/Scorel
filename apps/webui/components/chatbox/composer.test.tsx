import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Composer } from "./composer";

afterEach(() => cleanup());

describe("Composer", () => {
  it("disables Send while empty", () => {
    render(<Composer onSend={() => {}} />);
    const button = screen.getByTestId("composer-send") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("enables Send when there is non-whitespace input", () => {
    render(<Composer onSend={() => {}} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    const button = screen.getByTestId("composer-send") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("submits on Enter and clears the textarea", async () => {
    const onSend = vi.fn(async () => {});
    render(<Composer onSend={onSend} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    });
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(input.value).toBe("");
  });

  it("does not submit on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "line1" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("ignores empty submit", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});
