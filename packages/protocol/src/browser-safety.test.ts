import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sourceDir = import.meta.dirname;
const nodeBuiltinImportPattern = /from\s+["']node:|import\s+["']node:/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      return [];
    }
    return [path];
  });

describe("protocol browser safety", () => {
  it("does not import Node built-ins from source files", () => {
    const offenders = sourceFiles(sourceDir).filter((file) => nodeBuiltinImportPattern.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});
