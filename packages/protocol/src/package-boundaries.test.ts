import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

const readManifest = (relativePath: string) =>
  JSON.parse(readFileSync(resolve(root, relativePath, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

const dependencyNames = (manifest: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}) => Object.keys(manifest.dependencies ?? {});

describe("S0002 package boundaries", () => {
  it("keeps protocol independent from internal packages", () => {
    expect(dependencyNames(readManifest("packages/protocol"))).toEqual([]);
  });

  it("keeps core depending only on protocol internally", () => {
    expect(dependencyNames(readManifest("packages/core")).filter((name) => name.startsWith("@scorel/"))).toEqual([
      "@scorel/protocol",
    ]);
  });

  it("keeps daemon depending on protocol/core internally", () => {
    expect(dependencyNames(readManifest("packages/daemon")).filter((name) => name.startsWith("@scorel/")).sort()).toEqual([
      "@scorel/core",
      "@scorel/protocol",
    ]);
  });

  it("keeps client depending only on protocol internally", () => {
    expect(dependencyNames(readManifest("packages/client")).filter((name) => name.startsWith("@scorel/"))).toEqual([
      "@scorel/protocol",
    ]);
  });
});
