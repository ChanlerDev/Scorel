import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Composer } from "./composer";

afterEach(() => cleanup());

describe("Composer", () => {
  it("renders the pill with Message Scorel… placeholder + 4 buttons", () => {
    render(<Composer onSend={() => {}} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.placeholder).toBe("Message Scorel…");
    // Three placeholders + send.
    const attach = screen.getByTestId(
      "composer-attach",
    ) as HTMLButtonElement;
    const model = screen.getByTestId("composer-model") as HTMLButtonElement;
    const voice = screen.getByTestId("composer-voice") as HTMLButtonElement;
    const send = screen.getByTestId("composer-send") as HTMLButtonElement;
    for (const btn of [attach, model, voice]) {
      expect(btn.disabled).toBe(true);
      expect(btn.className).toContain("btn-disabled");
    }
    expect(send.disabled).toBe(true);
  });

  it("renders the model label inside the picker (defaults to Default)", () => {
    render(<Composer onSend={() => {}} />);
    const model = screen.getByTestId("composer-model");
    expect(model.textContent).toContain("Default");
  });

  it("renders a custom model label when provided", () => {
    render(<Composer onSend={() => {}} modelLabel="GPT-4" />);
    expect(screen.getByTestId("composer-model").textContent).toContain(
      "GPT-4",
    );
  });

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

  it("hides Cancel button when not in-flight", () => {
    render(<Composer onSend={() => {}} onCancel={() => {}} inFlight={false} />);
    expect(screen.queryByTestId("composer-cancel")).toBeNull();
    expect(screen.getByTestId("composer-send")).toBeTruthy();
  });

  it("shows Cancel button when in-flight (and hides Send)", () => {
    render(<Composer onSend={() => {}} onCancel={() => {}} inFlight />);
    expect(screen.queryByTestId("composer-send")).toBeNull();
    const cancel = screen.getByTestId("composer-cancel") as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    expect(cancel.getAttribute("aria-label")).toBe("Cancel");
  });

  it("flags Cancel as cancelling and disables it", () => {
    render(<Composer onSend={() => {}} onCancel={() => {}} inFlight cancelling />);
    const cancel = screen.getByTestId("composer-cancel") as HTMLButtonElement;
    expect(cancel.getAttribute("aria-label")).toBe("Cancelling");
    expect(cancel.disabled).toBe(true);
  });

  it("clicking Cancel fires onCancel", () => {
    const onCancel = vi.fn();
    render(<Composer onSend={() => {}} onCancel={onCancel} inFlight />);
    const cancel = screen.getByTestId("composer-cancel");
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Esc on focused textarea fires onCancel only while in-flight", () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <Composer onSend={() => {}} onCancel={onCancel} inFlight={false} />,
    );
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();

    rerender(<Composer onSend={() => {}} onCancel={onCancel} inFlight />);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(<Composer onSend={() => {}} onCancel={onCancel} inFlight cancelling />);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders errorBanner inline and keeps Send enabled when not in-flight", () => {
    render(
      <Composer
        onSend={() => {}}
        onCancel={() => {}}
        inFlight={false}
        errorBanner="cancel_failed: boom"
      />,
    );
    const banner = screen.getByTestId("composer-error");
    expect(banner.textContent).toBe("cancel_failed: boom");
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "retry" } });
    const send = screen.getByTestId("composer-send") as HTMLButtonElement;
    expect(send.disabled).toBe(false);
  });
});
