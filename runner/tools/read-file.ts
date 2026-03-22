import { readFile, stat } from "node:fs/promises";
import type { ToolHandler } from "../types.js";
import { formatFileAccessError, resolveToolPath } from "./path-utils.js";

const READ_FILE_MAX_OUTPUT = 64_000;

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

  const resolved = resolveToolPath(filePath, workspaceRoot);

  try {
    await stat(resolved);
  } catch (error: unknown) {
    return { toolCallId: "", isError: true, content: formatFileAccessError("read", filePath, error) };
  }

  try {
    if (await isBinaryFile(resolved)) {
      return {
        toolCallId: "",
        isError: true,
        content: `Binary file detected, cannot read as text: ${filePath}`,
      };
    }
  } catch (error: unknown) {
    return { toolCallId: "", isError: true, content: formatFileAccessError("read", filePath, error) };
  }

  let raw: string;
  try {
    raw = await readFile(resolved, "utf-8");
  } catch (error: unknown) {
    return { toolCallId: "", isError: true, content: formatFileAccessError("read", filePath, error) };
  }
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
