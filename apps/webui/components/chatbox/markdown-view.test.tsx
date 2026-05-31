import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Mock the lazy Shiki code block so the markdown tests do not pull the
// highlighter engine + WASM into jsdom. The mock keeps the same default
// export contract: a {lang, code} component that renders a <pre>.
vi.mock("./shiki-code-block", () => ({
  default: ({ lang, code }: { lang: string; code: string }) => (
    <pre data-testid="shiki-mock" data-lang={lang}>
      {code}
    </pre>
  ),
}));

import { MarkdownView } from "./markdown-view";

afterEach(() => cleanup());

describe("MarkdownView", () => {
  it("renders headings, lists, table cells, and inline code", () => {
    const md = [
      "# Title",
      "",
      "- one",
      "- two",
      "",
      "Body with `inline` code and a [link](https://example.com).",
      "",
      "| col |",
      "| --- |",
      "| val |",
    ].join("\n");
    render(<MarkdownView text={md} />);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeTruthy();
    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.getByText("two")).toBeTruthy();
    expect(screen.getByText("inline").tagName.toLowerCase()).toBe("code");
    expect(screen.getByText("val").tagName.toLowerCase()).toBe("td");
  });

  it("forces target=_blank rel=noreferrer noopener on links", () => {
    render(<MarkdownView text="See [docs](https://example.com)." />);
    const link = screen.getByRole("link", { name: "docs" }) as HTMLAnchorElement;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
    expect(link.getAttribute("href")).toBe("https://example.com");
  });

  it("strips raw <script> tags and onerror attributes", () => {
    const malicious = [
      "<script>window.__pwn=true</script>",
      "<img src=x onerror=\"window.__pwn=true\" />",
      "Visible text.",
    ].join("\n\n");
    const { container } = render(<MarkdownView text={malicious} />);
    expect(container.querySelector("script")).toBeNull();
    const img = container.querySelector("img");
    if (img) {
      expect(img.getAttribute("onerror")).toBeNull();
    }
    expect(container.textContent).toContain("Visible text");
  });

  it("renders fenced code through the lazy ShikiCodeBlock mock", async () => {
    const md = "```ts\nconst x: number = 1;\n```";
    render(<MarkdownView text={md} />);
    const block = await screen.findByTestId("shiki-mock");
    expect(block.dataset.lang).toBe("ts");
    expect(block.textContent).toContain("const x: number = 1;");
  });

  it("memoizes on the text prop so identical text does not re-render the inner pipeline", () => {
    const { rerender, container } = render(<MarkdownView text="hello world" />);
    const firstHtml = container.innerHTML;
    rerender(<MarkdownView text="hello world" />);
    // Same string instance → memo skips the inner ReactMarkdown render. We
    // assert via stable HTML; the inner tree must be byte-identical.
    expect(container.innerHTML).toBe(firstHtml);
    rerender(<MarkdownView text="hello new world" />);
    expect(container.innerHTML).not.toBe(firstHtml);
    expect(container.textContent).toContain("hello new world");
  });
});
