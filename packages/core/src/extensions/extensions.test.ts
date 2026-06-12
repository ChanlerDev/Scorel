import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadExtensionManifest, parseExtensionManifest } from "./index.js";

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

  it("loads built-in QQ and WeChat IM manifests", async () => {
    await expect(loadExtensionManifest(join(process.cwd(), "../../extensions/builtin/qq/scorel.extension.json")))
      .resolves.toMatchObject({
        id: "qq",
        kind: "im",
        displayName: "QQ Bot",
        adapter: "./adapter.js",
        skills: ["./skills"],
      });
    await expect(loadExtensionManifest(join(process.cwd(), "../../extensions/builtin/wechat/scorel.extension.json")))
      .resolves.toMatchObject({
        id: "wechat",
        kind: "im",
        displayName: "WeChat",
        adapter: "./adapter.js",
        skills: ["./skills"],
      });
  });
});
