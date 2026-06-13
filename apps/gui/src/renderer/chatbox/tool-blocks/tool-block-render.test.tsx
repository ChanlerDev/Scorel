// @vitest-environment jsdom

import type {
  ToolCallContentBlock,
  ToolResultContentBlock,
} from "@scorel/protocol";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { BashBlock } from "./BashBlock.js";
import { EditWriteBlock } from "./EditWriteBlock.js";
import { ReadBlock } from "./ReadBlock.js";
import { TodoWriteBlock } from "./TodoWriteBlock.js";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = undefined;
  container?.remove();
  container = undefined;
});

describe("GUI tool blocks", () => {
  it("shows Read as a compact header and expands to the read evidence", async () => {
    renderTool(
      <ReadBlock
        call={toolCall("Read", { file_path: "src/sample.ts", offset: 2, limit: 2 })}
        result={toolResult("Read", "     2\tconst x = 1;\n     3\tconsole.log(x);", {
          startLine: 2,
          endLine: 3,
          totalLines: 10,
        })}
        pending={false}
      />,
    );

    expect(container!.textContent).toContain("Read");
    expect(container!.textContent).toContain("sample.ts");
    expect(container!.textContent).not.toContain("console.log");

    await clickHeader();

    expect(container!.textContent).toContain("console.log(x);");
    expect(container!.textContent).toContain("src/sample.ts · 行 2–3/10");
  });

  it("shows Bash exit status in the header and expands to command output", async () => {
    renderTool(
      <BashBlock
        call={toolCall("Bash", { command: "pnpm test" })}
        result={toolResult("Bash", "exitCode: 0\ncwd: /tmp/project\nstdout:\npass\nstderr:\n", {
          exitCode: 0,
          cwd: "/tmp/project",
        })}
        pending={false}
      />,
    );

    expect(container!.textContent).toContain("$ pnpm test");
    expect(container!.textContent).toContain("exit 0");
    expect(container!.textContent).not.toContain("stdout");

    await clickHeader();

    expect(container!.textContent).toContain("stdout:");
    expect(container!.textContent).toContain("pass");
  });

  it("keeps the original Bash command visible when RTK rewrites execution", async () => {
    renderTool(
      <BashBlock
        call={toolCall("Bash", { command: "git status" })}
        result={toolResult("Bash", "exitCode: 0\ncwd: /tmp/project\nstdout:\nclean\nstderr:\n", {
          exitCode: 0,
          cwd: "/tmp/project",
          command: "rtk git status",
          rtk: {
            enabled: true,
            applied: true,
            rewrittenCommand: "rtk git status",
          },
        })}
        pending={false}
      />,
    );

    expect(container!.textContent).toContain("$ git status");
    expect(container!.textContent).not.toContain("$ rtk git status");
  });

  it("keeps Edit diffs visible by default", async () => {
    renderTool(
      <EditWriteBlock
        call={toolCall("Edit", {
          file_path: "src/sample.ts",
          old_string: "const x = 1;",
          new_string: "const x = 2;",
        })}
        result={toolResult("Edit", "updated")}
        pending={false}
      />,
    );

    expect(container!.textContent).toContain("Edit");
    expect(container!.textContent).toContain("sample.ts");
    expect(container!.textContent).toContain("-const x = 1;");
    expect(container!.textContent).toContain("+const x = 2;");
  });

  it("shows TodoWrite as a collapsible task-state list", async () => {
    renderTool(
      <TodoWriteBlock
        call={toolCall("TodoWrite", {
          todos: [
            { content: "Read files", status: "completed" },
            { content: "Polish tool blocks", status: "in_progress" },
          ],
        })}
        pending={false}
      />,
    );

    expect(container!.textContent).toContain("TodoWrite");
    expect(container!.textContent).toContain("1/2");
    expect(container!.textContent).toContain("Polish tool blocks");
  });
});

function renderTool(element: ReactElement): void {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
}

async function clickHeader(): Promise<void> {
  await act(async () => {
    container!.querySelector<HTMLButtonElement>(".tool-chip__header")!.click();
  });
}

function toolCall(toolName: string, args: unknown): ToolCallContentBlock {
  return {
    type: "tool_call",
    toolCallId: `call_${toolName}`,
    toolName,
    args,
  };
}

function toolResult(toolName: string, text: string, details?: unknown): ToolResultContentBlock {
  return {
    type: "tool_result",
    toolCallId: `call_${toolName}`,
    toolName,
    result: {
      content: [{ type: "text", text }],
      details,
    },
  };
}
