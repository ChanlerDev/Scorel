import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("GUI Shiki markdown theme", () => {
  it("uses a dark code theme instead of the light GitHub theme", async () => {
    const source = await readFile(join(process.cwd(), "src/renderer/chatbox/ShikiCodeBlock.tsx"), "utf8");

    expect(source).toContain("github-dark-default");
    expect(source).not.toContain("github-light-default");
  });
});
