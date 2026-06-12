import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("GUI sidebar layout CSS", () => {
  it("keeps sidebar titles clipped and exposes collapsed/resizable layout states", async () => {
    const css = await readFile(join(process.cwd(), "src/renderer/styles.css"), "utf8");

    expect(css).toContain(".app-shell--sidebar-collapsed");
    expect(css).toContain(".sidebar__resize-handle");
    expect(css).toMatch(/\.sidebar__scroll\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s);
    expect(css).toMatch(/\.project-tree__session\s*\{[^}]*min-width:\s*0;/s);
    expect(css).toMatch(/\.project-tree__session-title\s*\{[^}]*text-overflow:\s*ellipsis;/s);
  });

  it("keeps expanded thinking and code blocks inside the message column", async () => {
    const css = await readFile(join(process.cwd(), "src/renderer/styles.css"), "utf8");

    expect(css).toMatch(/\.turn-thinking\s*\{[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.markdown\s*\{[^}]*overflow-wrap:\s*break-word;/s);
    expect(css).toMatch(/\.markdown pre\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s);
    expect(css).toMatch(/\.shiki-block__html\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s);
  });

  it("places code-block language metadata and copy control in the block header", async () => {
    const css = await readFile(join(process.cwd(), "src/renderer/styles.css"), "utf8");

    expect(css).toMatch(/\.shiki-block__header\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s);
    expect(css).toMatch(/\.shiki-block__lang\s*\{[^}]*font-family:\s*var\(--font-mono\);/s);
    expect(css).toMatch(/\.shiki-block__copy\s*\{[^}]*display:\s*inline-flex;/s);
    expect(css).toMatch(/\.shiki-block__copy\s*\{[^}]*cursor:\s*pointer;/s);
  });

  it("renders tool blocks as compact expandable execution traces", async () => {
    const css = await readFile(join(process.cwd(), "src/renderer/styles.css"), "utf8");

    expect(css).toMatch(/\.tool-chip__header\s*\{[^}]*grid-template-columns:\s*18px minmax\(0,\s*1fr\) auto 16px;/s);
    expect(css).toMatch(/\.tool-chip__body\s*\{[^}]*max-height:\s*360px;[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/\.tool-diff__line--add\s*\{[^}]*background:\s*rgba\(22,\s*163,\s*74,\s*0\.10\);/s);
    expect(css).toMatch(/\.tool-diff__line--del\s*\{[^}]*background:\s*rgba\(220,\s*38,\s*38,\s*0\.10\);/s);
  });
});
