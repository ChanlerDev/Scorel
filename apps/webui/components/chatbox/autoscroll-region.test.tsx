import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AutoscrollRegion, JumpToBottomButton } from "./autoscroll-region";

type IOEntry = {
  isIntersecting: boolean;
  target: Element;
};

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: (entries: IOEntry[]) => void;
  root: Element | null;
  options: IntersectionObserverInit | undefined;
  observed = new Set<Element>();
  disconnected = false;

  constructor(
    callback: (entries: IOEntry[]) => void,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    this.root = (options?.root as Element) ?? null;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.observed.add(target);
  }
  unobserve(target: Element): void {
    this.observed.delete(target);
  }
  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }
  /** Test helper: fire a synthetic intersection update. */
  emit(isIntersecting: boolean): void {
    const entries: IOEntry[] = Array.from(this.observed).map((target) => ({
      isIntersecting,
      target,
    }));
    this.callback(entries);
  }
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AutoscrollRegion", () => {
  it("starts at the bottom and toggles when the sentinel leaves the viewport", () => {
    render(
      <AutoscrollRegion tickKey={1}>
        <p>turn-1</p>
      </AutoscrollRegion>,
    );
    const region = screen.getByTestId("autoscroll-region");
    expect(region.dataset.atBottom).toBe("true");

    const observer = FakeIntersectionObserver.instances.at(-1)!;
    expect(observer.observed.size).toBe(1);

    act(() => observer.emit(false));
    expect(region.dataset.atBottom).toBe("false");

    act(() => observer.emit(true));
    expect(region.dataset.atBottom).toBe("true");
  });

  it("calls scrollIntoView on the sentinel when tickKey changes while at-bottom", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });

    const { rerender } = render(
      <AutoscrollRegion tickKey={1}>
        <p>turn-1</p>
      </AutoscrollRegion>,
    );
    const observer = FakeIntersectionObserver.instances.at(-1)!;
    act(() => observer.emit(true));
    scrollIntoView.mockClear();

    rerender(
      <AutoscrollRegion tickKey={2}>
        <p>turn-1</p>
        <p>turn-2</p>
      </AutoscrollRegion>,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("does NOT scroll when the user is not at the bottom", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });

    const { rerender } = render(
      <AutoscrollRegion tickKey={1}>
        <p>turn-1</p>
      </AutoscrollRegion>,
    );
    const observer = FakeIntersectionObserver.instances.at(-1)!;
    act(() => observer.emit(false)); // user scrolled up
    scrollIntoView.mockClear();

    rerender(
      <AutoscrollRegion tickKey={2}>
        <p>turn-1</p>
        <p>turn-2</p>
      </AutoscrollRegion>,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("shows the JumpToBottom pill only when scrolled away from the bottom with content", () => {
    render(
      <AutoscrollRegion tickKey={1}>
        <p>turn-1</p>
      </AutoscrollRegion>,
    );
    const observer = FakeIntersectionObserver.instances.at(-1)!;
    expect(screen.queryByTestId("jump-to-bottom")).toBeNull();

    act(() => observer.emit(false));
    expect(screen.getByTestId("jump-to-bottom")).toBeTruthy();

    act(() => observer.emit(true));
    expect(screen.queryByTestId("jump-to-bottom")).toBeNull();
  });

  it("hides the JumpToBottom pill when the region is empty even if not at bottom", () => {
    render(<AutoscrollRegion tickKey={0}>{null}</AutoscrollRegion>);
    const observer = FakeIntersectionObserver.instances.at(-1)!;
    act(() => observer.emit(false));
    expect(screen.queryByTestId("jump-to-bottom")).toBeNull();
  });

  it("clicking the JumpToBottom pill calls scrollIntoView", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });

    render(
      <AutoscrollRegion tickKey={1}>
        <p>turn-1</p>
      </AutoscrollRegion>,
    );
    const observer = FakeIntersectionObserver.instances.at(-1)!;
    act(() => observer.emit(false));
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByTestId("jump-to-bottom"));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

describe("JumpToBottomButton", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(
      <JumpToBottomButton visible={false} onClick={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a button that fires onClick", () => {
    const onClick = vi.fn();
    render(<JumpToBottomButton visible={true} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("jump-to-bottom"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
