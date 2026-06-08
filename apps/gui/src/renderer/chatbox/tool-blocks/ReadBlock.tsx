import { useState } from "react";

import { ChevronDown, ChevronRight, Folder } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";

type ReadArgs = {
  file_path?: string;
  filePath?: string;
  offset?: number;
  limit?: number;
};

export function ReadBlock({ call, result, pending }: ToolBlockProps) {
  const args = (call.args ?? {}) as ReadArgs;
  const filePath = args.file_path ?? args.filePath ?? "";
  const isError = Boolean(result?.isError);
  const [open, setOpen] = useState<boolean>(isError);
  const range = args.offset || args.limit
    ? `${args.offset ?? 1}–${(args.offset ?? 1) + (args.limit ?? 0)}`
    : null;
  return (
    <div className={`tool-block${isError ? " tool-block--error" : ""}`}>
      <button type="button" className="tool-block__header" onClick={() => setOpen((v) => !v)}>
        <span className="tool-block__title">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={14} />
          <span className="tool-block__title-text">
            已读取 {filePath || "file"}
            {range ? ` (lines ${range})` : ""}
            {pending ? " · pending" : ""}
            {isError ? " · error" : ""}
          </span>
        </span>
        <span className="tool-block__toggle">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="tool-block__body">
          <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
            {filePath}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
