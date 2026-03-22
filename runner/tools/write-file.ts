import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ToolHandler } from "../types.js";
import { formatFileAccessError, resolveToolPath } from "./path-utils.js";

export const writeFileTool: ToolHandler = async (args, workspaceRoot) => {
  const filePath = args.path as string | undefined;
  const content = args.content as string | undefined;

  if (!filePath) {
    return { toolCallId: "", isError: true, content: "Missing required argument: path" };
  }
  if (content === undefined) {
    return { toolCallId: "", isError: true, content: "Missing required argument: content" };
  }

  const resolved = resolveToolPath(filePath, workspaceRoot);

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
    return { toolCallId: "", isError: true, content: formatFileAccessError("write", filePath, err) };
  }
};
