import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadScorelExtensions } from "./extension.js";
import { Type } from "./llm.js";
import type { ScorelRuntimeHooks } from "./types.js";

describe("Scorel extensions", () => {
  it("loads global and project extensions in deterministic order with project override", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-ext-order-"));
    try {
      const globalDir = join(dir, "home", ".scorel", "extensions");
      const projectDir = join(dir, "project", ".scorel", "extensions");
      await mkdir(globalDir, { recursive: true });
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(globalDir, "a.mjs"), extensionModule("shared", "global"));
      await writeFile(join(projectDir, "b.mjs"), extensionModule("shared", "project"));
      await writeFile(join(projectDir, "c.mjs"), extensionModule("project-only", "project-only"));

      const registry = await loadScorelExtensions({ globalDir, projectDir });

      expect(registry.extensions.map((extension) => extension.id)).toEqual(["shared", "project-only"]);
      expect(registry.collectTools().map((tool) => tool.name)).toEqual(["project_tool", "project_only_tool"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("isolates extension load, tool, command, event, and hook failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scorel-ext-errors-"));
    try {
      const projectDir = join(dir, ".scorel", "extensions");
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, "bad-load.mjs"), "throw new Error('load failed');\n");
      await writeFile(
        join(projectDir, "bad-runtime.mjs"),
        `
export default {
  id: "bad-runtime",
  name: "Bad Runtime",
  version: "0.0.0",
  tools() { throw new Error("tools failed"); },
  commands() { throw new Error("commands failed"); },
  onEvent() { throw new Error("event failed"); },
  hooks() {
    return {
      buildContext() { throw new Error("hook failed"); }
    };
  }
};
`
      );
      await writeFile(join(projectDir, "good.mjs"), extensionModule("good", "good"));

      const registry = await loadScorelExtensions({ globalDir: join(dir, "missing"), projectDir });
      const tools = registry.collectTools();
      const commands = registry.collectCommands();
      await registry.emit({ type: "runtime_start", sessionId: "test" }, {} as never);
      const hooks = registry.wrapRuntimeHooks();
      const context = await hooks.buildContext?.({ messages: [], context: { messages: [] } });

      expect(tools.map((tool) => tool.name)).toEqual(["good_tool"]);
      expect(Object.keys(commands)).toEqual(["good"]);
      expect(context).toEqual({ messages: [] });
      expect(registry.errors.map((error) => error.phase)).toEqual([
        "load",
        "tools",
        "commands",
        "onEvent",
        "hook:buildContext"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("wraps runtime hooks in extension order and lets later hooks observe earlier changes", async () => {
    const calls: string[] = [];
    const baseHooks: ScorelRuntimeHooks = {
      beforeToolCall: ({ args }) => {
        calls.push("base");
        return { args: { ...args, value: "base" } };
      }
    };
    const dir = await mkdtemp(join(tmpdir(), "scorel-ext-hooks-"));
    try {
      const projectDir = join(dir, ".scorel", "extensions");
      await mkdir(projectDir, { recursive: true });
      await writeFile(
        join(projectDir, "a.mjs"),
        hookModule("a", "base", "second")
      );
      await writeFile(
        join(projectDir, "b.mjs"),
        hookModule("b", "second", "third")
      );

      const registry = await loadScorelExtensions({ globalDir: join(dir, "missing"), projectDir });
      const hooks = registry.wrapRuntimeHooks(baseHooks);
      const decision = await hooks.beforeToolCall?.({
        tool: {
          name: "sample",
          label: "Sample",
          description: "Sample",
          parameters: Type.Object({}),
          execute: () => ({ content: [{ type: "text", text: "ok" }] })
        },
        toolCallId: "call_1",
        toolName: "sample",
        args: { value: "initial" }
      });

      expect(calls).toEqual(["base"]);
      expect(decision?.args).toEqual({ value: "third" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function extensionModule(id: string, prefix: string): string {
  return `
export default {
  id: "${id}",
  name: "${id}",
  version: "0.0.0",
  tools() {
    return [{
      name: "${prefix.replaceAll("-", "_")}_tool",
      label: "${prefix} tool",
      description: "Test tool",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute() { return { content: [{ type: "text", text: "${prefix}" }] }; }
    }];
  },
  commands() {
    return {
      "${prefix}": {
        description: "Test command",
        run() { return "${prefix} command"; }
      }
    };
  }
};
`;
}

function hookModule(id: string, expected: string, next: string): string {
  return `
export default {
  id: "${id}",
  name: "${id}",
  version: "0.0.0",
  hooks() {
    return {
      beforeToolCall({ args }) {
        if (args.value !== "${expected}") {
          throw new Error("expected ${expected}, got " + args.value);
        }
        return { args: { ...args, value: "${next}" } };
      }
    };
  }
};
`;
}
