import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { asClientId, type QueueName } from "@scorel/protocol";

import { Composer } from "./composer";
import type { QueuePreviewItem } from "../../lib/events/projector";

afterEach(() => cleanup());

const queued = (
  id: string,
  queue: QueueName,
  text: string,
): QueuePreviewItem => ({
  id,
  queue,
  text,
  content: [{ type: "text", text }],
  createdAt: 1,
  updatedAt: 1,
  clientId: asClientId("client_test"),
});

describe("Composer", () => {
  it("renders the pill with Message Scorel… placeholder + 4 buttons", () => {
    render(<Composer onSend={() => {}} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.placeholder).toBe("Message Scorel…");
    expect(input.className).toContain("focus-visible:outline-none");
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

  it("renders queued follow-up and steer items above the input", () => {
    render(
      <Composer
        onSend={() => {}}
        queuedItems={[
          queued("follow_1", "follow_up", "run tests next"),
          queued("steer_1", "steer", "focus on the UI"),
        ]}
      />,
    );
    const strip = screen.getByTestId("composer-queue-strip");
    expect(strip.textContent).toContain("Follow up");
    expect(strip.textContent).toContain("run tests next");
    expect(strip.textContent).toContain("Steer");
    expect(strip.textContent).toContain("focus on the UI");
    expect(screen.getByTestId("composer-queue-toggle-follow_1")).toBeTruthy();
    expect(screen.getByTestId("composer-queue-edit-follow_1")).toBeTruthy();
    expect(screen.getByTestId("composer-queue-delete-follow_1")).toBeTruthy();
  });

  it("persists queued item switch, edit, and delete rewrites", async () => {
    const onRewriteQueue = vi.fn();
    render(
      <Composer
        onSend={() => {}}
        onRewriteQueue={onRewriteQueue}
        queuedItems={[
          queued("follow_1", "follow_up", "revise tests"),
          queued("steer_1", "steer", "focus UI"),
        ]}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("composer-queue-toggle-follow_1"));
      await Promise.resolve();
    });
    expect(onRewriteQueue).toHaveBeenNthCalledWith(1, "follow_up", []);
    expect(onRewriteQueue).toHaveBeenNthCalledWith(
      2,
      "steer",
      expect.arrayContaining([expect.objectContaining({ id: "follow_1" })]),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("composer-queue-edit-steer_1"));
      await Promise.resolve();
    });
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.value).toBe("focus UI");
    expect(onRewriteQueue).toHaveBeenLastCalledWith(
      "steer",
      [],
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("composer-queue-delete-follow_1"));
      await Promise.resolve();
    });
    expect(onRewriteQueue).toHaveBeenLastCalledWith("follow_up", []);
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

  it("submits on Command+Enter and clears before the send promise resolves", async () => {
    let resolveSend!: () => void;
    const onSend = vi.fn(() => new Promise<void>((resolve) => {
      resolveSend = resolve;
    }));
    render(<Composer onSend={onSend} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello" } });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    });
    expect(onSend).toHaveBeenCalledWith("hello", undefined);
    expect(input.value).toBe("");
    expect(input.disabled).toBe(false);
    await act(async () => {
      resolveSend();
    });
  });

  it("restores failed submitted text without dropping a newer draft", async () => {
    let rejectSend!: (cause: Error) => void;
    const onSend = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectSend = reject;
    }));
    render(<Composer onSend={onSend} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "long failed draft" } });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    });
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { value: "new draft" } });
    await act(async () => {
      rejectSend(new Error("send failed"));
    });

    expect(input.value).toBe("long failed draft\n\nnew draft");
  });

  it("does not submit on plain Enter or Shift+Enter", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "line1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("ignores empty submit", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("hides Cancel button when not in-flight", () => {
    render(<Composer onSend={() => {}} onCancel={() => {}} inFlight={false} />);
    expect(screen.queryByTestId("composer-cancel")).toBeNull();
    expect(screen.getByTestId("composer-send")).toBeTruthy();
  });

  it("shows Cancel and Send buttons when in-flight", () => {
    render(<Composer onSend={() => {}} onCancel={() => {}} inFlight />);
    expect(screen.queryByTestId("composer-send")).toBeTruthy();
    const cancel = screen.getByTestId("composer-cancel") as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    expect(cancel.getAttribute("aria-label")).toBe("Cancel");
  });

  it("keeps the textarea editable while in-flight", () => {
    render(<Composer onSend={() => {}} onCancel={() => {}} inFlight />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    fireEvent.change(input, { target: { value: "next" } });
    expect(input.value).toBe("next");
  });

  it("sends the default running behavior with Command+Enter and the opposite with Command+Shift+Enter", async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} onCancel={() => {}} inFlight runningBehavior="follow_up" />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "queue this" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    });
    expect(onSend).toHaveBeenLastCalledWith("queue this", "follow_up");

    fireEvent.change(input, { target: { value: "guide this" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", metaKey: true, shiftKey: true });
    });
    expect(onSend).toHaveBeenLastCalledWith("guide this", "steer");
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
