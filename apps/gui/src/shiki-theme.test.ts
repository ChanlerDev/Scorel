import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("GUI Shiki markdown theme", () => {
  it("uses a light code theme aligned with the GUI surface", async () => {
    const source = await readFile(join(process.cwd(), "src/renderer/chatbox/ShikiCodeBlock.tsx"), "utf8");

    expect(source).toContain("github-light-default");
    expect(source).not.toContain("github-dark-default");
  });
});
