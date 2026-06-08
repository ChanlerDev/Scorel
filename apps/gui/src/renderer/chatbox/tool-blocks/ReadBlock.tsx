import { FileText } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";
import { ToolChip } from "./ToolChip.js";

type ReadArgs = {
  file_path?: string;
  filePath?: string;
  offset?: number;
  limit?: number;
};

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function ReadBlock({ call, result, pending }: ToolBlockProps) {
  const args = (call.args ?? {}) as ReadArgs;
  const filePath = args.file_path ?? args.filePath ?? "";
  const isError = Boolean(result?.isError);
  const range = args.offset || args.limit
    ? `${args.offset ?? 1}–${(args.offset ?? 1) + (args.limit ?? 0)}`
    : null;
  return (
    <ToolChip
      icon={<FileText />}
      title={
        <>
          已读取 <span style={{ color: "var(--color-text)" }}>{basename(filePath) || "file"}</span>
          {range ? <span style={{ color: "var(--color-text-faint)" }}> · 行 {range}</span> : null}
        </>
      }
      pending={pending}
      isError={isError}
      body={
        <pre>{filePath || "(no path)"}{range ? `\n范围 ${range}` : ""}</pre>
      }
    />
  );
}
