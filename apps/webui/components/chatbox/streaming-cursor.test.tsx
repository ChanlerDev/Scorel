import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { StreamingCursor } from "./streaming-cursor";

afterEach(() => cleanup());

describe("StreamingCursor", () => {
  it("renders a span with the .scorel-caret class so the keyframes pick it up", () => {
    render(<StreamingCursor />);
    const cursor = screen.getByTestId("streaming-cursor");
    expect(cursor.tagName.toLowerCase()).toBe("span");
    expect(cursor.classList.contains("scorel-caret")).toBe(true);
  });

  it("is marked aria-hidden so screen readers do not announce it", () => {
    render(<StreamingCursor />);
    expect(screen.getByTestId("streaming-cursor").getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("supports a custom test id for callers that need to render multiple", () => {
    render(<StreamingCursor testId="cursor-x" />);
    expect(screen.getByTestId("cursor-x")).toBeTruthy();
  });
});
