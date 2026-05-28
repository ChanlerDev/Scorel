import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sourceDir = import.meta.dirname;
const nodeBuiltinImportPattern = /from\s+["']node:|import\s+["']node:/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node") {
        return [];
      }
      return sourceFiles(path);
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      return [];
    }
    return [path];
  });

describe("client root browser safety", () => {
  it("does not import Node built-ins from root-safe source files", () => {
    const offenders = sourceFiles(sourceDir).filter((file) => nodeBuiltinImportPattern.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});
