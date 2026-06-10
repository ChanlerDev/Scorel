import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("GUI application menu", () => {
  it("binds CommandOrControl+, to open Settings", async () => {
    const source = await readFile(join(process.cwd(), "src", "main.ts"), "utf8");

    expect(source).toContain('accelerator: "CommandOrControl+,"');
    expect(source).toContain("guiIpcChannels.openSettings");
  });
});
