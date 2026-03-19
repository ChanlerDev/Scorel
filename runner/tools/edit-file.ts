import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolResult, ToolHandler } from "../types.js";

const EDIT_FILE_MAX_OUTPUT = 2_000;

function validatePath(filePath: string, workspaceRoot: string): string | null {
  const resolved = path.resolve(workspaceRoot, filePath);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return null;
  }
  return resolved;
}

function createDiffSnippet(
  filePath: string,
  oldStr: string,
  newStr: string,
  matchIndex: number,
  originalContent: string,
): string {
  const beforeMatch = originalContent.slice(0, matchIndex);
  const lineNum = beforeMatch.split("\n").length;
  const contextLines = 3;
  const allLines = originalContent.split("\n");
  const startLine = Math.max(0, lineNum - contextLines - 1);

  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  let diff = `--- ${filePath}\n+++ ${filePath}\n@@ -${startLine + 1} @@\n`;
  for (let i = startLine; i < lineNum - 1 && i < allLines.length; i++) {
    diff += ` ${allLines[i]}\n`;
  }
  for (const line of oldLines) {
    diff += `-${line}\n`;
  }
  for (const line of newLines) {
    diff += `+${line}\n`;
  }

  if (diff.length > EDIT_FILE_MAX_OUTPUT) {
    return diff.slice(0, EDIT_FILE_MAX_OUTPUT - 20) + "\n...[truncated]";
  }
  return diff;
}

export const editFileTool: ToolHandler = async (args, workspaceRoot) => {
  const filePath = args.path as string | undefined;
  const oldString = args.old_string as string | undefined;
  const newString = args.new_string as string | undefined;

  if (!filePath) {
    return { toolCallId: "", isError: true, content: "Missing required argument: path" };
  }
  if (oldString === undefined) {
    return { toolCallId: "", isError: true, content: "Missing required argument: old_string" };
  }
  if (newString === undefined) {
    return { toolCallId: "", isError: true, content: "Missing required argument: new_string" };
  }

  const resolved = validatePath(filePath, workspaceRoot);
  if (!resolved) {
    return { toolCallId: "", isError: true, content: `Path escapes workspace root: ${filePath}` };
  }

  let content: string;
  try {
    content = await readFile(resolved, "utf-8");
  } catch {
    return { toolCallId: "", isError: true, content: `File not found: ${filePath}` };
  }

  // Count occurrences
  let count = 0;
  let searchFrom = 0;
  let firstIndex = -1;
  while (true) {
    const idx = content.indexOf(oldString, searchFrom);
    if (idx === -1) break;
    if (count === 0) firstIndex = idx;
    count++;
    searchFrom = idx + 1;
  }

  if (count === 0) {
    return { toolCallId: "", isError: true, content: "No match found for old_string" };
  }
  if (count > 1) {
    return {
      toolCallId: "",
      isError: true,
      content: `Multiple matches found (${count}); old_string must be unique`,
    };
  }

  const newContent = content.slice(0, firstIndex) + newString + content.slice(firstIndex + oldString.length);
  await writeFile(resolved, newContent, "utf-8");

  const diff = createDiffSnippet(filePath, oldString, newString, firstIndex, content);

  return {
    toolCallId: "",
    isError: false,
    content: `Successfully edited ${filePath}`,
    details: {
      diff,
      paths: [resolved],
    },
  };
};
