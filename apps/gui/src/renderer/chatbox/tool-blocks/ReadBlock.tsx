import { FileText } from "../../icons/index.js";
import { extractToolDetails, extractToolText } from "./result-text.js";
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
  const details = extractToolDetails(result?.result) as { startLine?: unknown; endLine?: unknown; totalLines?: unknown; truncated?: unknown; nextOffset?: unknown } | undefined;
  const startLine = typeof details?.startLine === "number" ? details.startLine : args.offset;
  const endLine = typeof details?.endLine === "number"
    ? details.endLine
    : args.offset || args.limit
      ? (args.offset ?? 1) + (args.limit ?? 0)
      : undefined;
  const totalLines = typeof details?.totalLines === "number" ? details.totalLines : undefined;
  const range = startLine || endLine
    ? `${startLine ?? 1}–${endLine ?? startLine ?? 1}${totalLines ? `/${totalLines}` : ""}`
    : null;
  const output = extractToolText(result?.result);
  return (
    <ToolChip
      icon={<FileText />}
      title={
        <>
          Read <span className="tool-chip__target">{basename(filePath) || "file"}</span>
          {range ? <span className="tool-chip__status"> · 行 {range}</span> : null}
        </>
      }
      pending={pending}
      isError={isError}
      counters={details?.truncated ? <span>next {String(details.nextOffset ?? "")}</span> : undefined}
      body={
        <>
          <pre className="tool-output">{output || filePath || "(no content)"}</pre>
          <p className="tool-muted-line">{filePath || "(no path)"}{range ? ` · 行 ${range}` : ""}</p>
        </>
      }
    />
  );
}
