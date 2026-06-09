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
});
