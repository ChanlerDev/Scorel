import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("GUI session event lifecycle", () => {
  it("does not reuse the global session-event unsubscribe when detaching a session", async () => {
    const source = await readFile(join(process.cwd(), "src/renderer/App.tsx"), "utf8");

    expect(source).not.toContain("attachUnsubRef");
    expect(source).toContain("window.scorel.onSessionEvent");
    expect(source).toContain("window.scorel.detachSession(previous)");
  });
});
