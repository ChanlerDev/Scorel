import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rootPackagePath = fileURLToPath(new URL("../../../package.json", import.meta.url));
const srcDir = fileURLToPath(new URL(".", import.meta.url));
const rendererOwnedDirs = ["shared"];
const rendererOwnedFiles = ["renderer.ts", "preload.ts"];

describe("GUI package boundaries", () => {
  it("keeps apps/gui out of the public CLI package files list", async () => {
    const rootPackage = JSON.parse(await readFile(rootPackagePath, "utf8")) as { files?: string[] };

    expect(rootPackage.files ?? []).not.toContain("apps/gui");
  });

  it("keeps renderer and preload source from importing Host or Runtime packages", async () => {
    const files = await rendererBoundaryFiles();

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(/@scorel\/core|@scorel\/daemon|node:/);
    }
  });
});

async function rendererBoundaryFiles(): Promise<string[]> {
  const files = rendererOwnedFiles.map((file) => join(srcDir, file));
  for (const dir of rendererOwnedDirs) {
    files.push(...await tsFiles(join(srcDir, dir)));
  }
  return files;
}

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await tsFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}
