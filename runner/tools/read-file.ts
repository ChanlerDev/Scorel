import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ToolHandler } from "../types.js";

const READ_FILE_MAX_OUTPUT = 64_000;

function validatePath(filePath: string, workspaceRoot: string): string | null {
  const resolved = path.resolve(workspaceRoot, filePath);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return null;
  }
  return resolved;
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  const { createReadStream } = await import("node:fs");
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { start: 0, end: 8191 });
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => {
      const buf = Buffer.concat(chunks);
      resolve(buf.includes(0));
    });
    stream.on("error", reject);
  });
}

export const readFileTool: ToolHandler = async (args, workspaceRoot) => {
  const filePath = args.path as string | undefined;
  if (!filePath) {
    return { toolCallId: "", isError: true, content: "Missing required argument: path" };
  }

  const resolved = validatePath(filePath, workspaceRoot);
  if (!resolved) {
    return { toolCallId: "", isError: true, content: `Path escapes workspace root: ${filePath}` };
  }

  try {
    await stat(resolved);
  } catch {
    return { toolCallId: "", isError: true, content: `File not found: ${filePath}` };
  }

  try {
    if (await isBinaryFile(resolved)) {
      return {
        toolCallId: "",
        isError: true,
        content: `Binary file detected, cannot read as text: ${filePath}`,
      };
    }
  } catch {
    return { toolCallId: "", isError: true, content: `File not found: ${filePath}` };
  }

  const raw = await readFile(resolved, "utf-8");
  const lines = raw.split("\n");

  const offset = typeof args.offset === "number" ? args.offset : 0;
  const limit = typeof args.limit === "number" ? args.limit : lines.length;
  const sliced = lines.slice(offset, offset + limit);
  let content = sliced.join("\n");

  let truncated = false;
  if (content.length > READ_FILE_MAX_OUTPUT) {
    const truncLines = [];
    let charCount = 0;
    for (const line of sliced) {
      if (charCount + line.length + 1 > READ_FILE_MAX_OUTPUT) break;
      truncLines.push(line);
      charCount += line.length + 1;
    }
    content = truncLines.join("\n") + `\n...[truncated, showing first ${truncLines.length} lines]`;
    truncated = true;
  }

  return {
    toolCallId: "",
    isError: false,
    content,
    details: {
      truncated,
      paths: [resolved],
    },
  };
};
