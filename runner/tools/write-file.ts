import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ToolResult, ToolHandler } from "../types.js";

function validatePath(filePath: string, workspaceRoot: string): string | null {
  const resolved = path.resolve(workspaceRoot, filePath);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return null;
  }
  return resolved;
}

export const writeFileTool: ToolHandler = async (args, workspaceRoot) => {
  const filePath = args.path as string | undefined;
  const content = args.content as string | undefined;

  if (!filePath) {
    return { toolCallId: "", isError: true, content: "Missing required argument: path" };
  }
  if (content === undefined) {
    return { toolCallId: "", isError: true, content: "Missing required argument: content" };
  }

  const resolved = validatePath(filePath, workspaceRoot);
  if (!resolved) {
    return { toolCallId: "", isError: true, content: `Path escapes workspace root: ${filePath}` };
  }

  try {
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf-8");
    return {
      toolCallId: "",
      isError: false,
      content: `Successfully wrote ${content.length} bytes to ${filePath}`,
      details: { paths: [resolved] },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { toolCallId: "", isError: true, content: `Failed to write file: ${msg}` };
  }
};
