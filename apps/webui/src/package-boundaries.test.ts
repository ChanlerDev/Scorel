import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");

describe("S0030 WebUI package boundaries", () => {
  it("depends only on browser-safe Scorel packages", () => {
    const manifest = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith("@scorel/")).sort()).toEqual([
      "@scorel/client",
      "@scorel/protocol",
    ]);
  });
});
