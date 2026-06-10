import { describe, expect, it } from "vitest";

import { parseExtensionManifest } from "./index.js";

describe("extensions", () => {
  it("parses the minimal IM extension manifest", () => {
    const manifest = parseExtensionManifest(JSON.stringify({
      id: "telegram",
      kind: "im",
      displayName: "Telegram",
      adapter: "./adapter.js",
      skills: ["./skills"],
      mcp: [{ name: "future" }],
    }), "/tmp/telegram/scorel.extension.json");

    expect(manifest).toMatchObject({
      id: "telegram",
      kind: "im",
      displayName: "Telegram",
      adapter: "./adapter.js",
      skills: ["./skills"],
      mcp: [{ name: "future" }],
      rootDir: "/tmp/telegram",
    });
  });

  it("rejects unsupported extension kind and escaping paths", () => {
    expect(() => parseExtensionManifest(JSON.stringify({
      id: "bad",
      kind: "tool",
      displayName: "Bad",
      adapter: "./adapter.js",
    }))).toThrow("kind must be im");

    expect(() => parseExtensionManifest(JSON.stringify({
      id: "bad",
      kind: "im",
      displayName: "Bad",
      adapter: "../adapter.js",
    }))).toThrow("must be a relative path inside the extension");
  });
});
