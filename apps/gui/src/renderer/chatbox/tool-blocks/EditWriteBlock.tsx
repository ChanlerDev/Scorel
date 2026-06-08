import { useState } from "react";

import { ChevronDown, ChevronRight, FolderPlus } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";
import { diffCounts, diffLines, type DiffLine } from "./diff.js";

type EditArgs = { file_path?: string; old_string?: string; new_string?: string };
type WriteArgs = { file_path?: string; content?: string };

const MAX_DIFF_LINES = 200;

export function EditWriteBlock({ call, result, pending }: ToolBlockProps) {
  const isWrite = call.toolName === "Write";
  const args = call.args as EditArgs & WriteArgs;
  const filePath = args?.file_path ?? "";
  const isError = Boolean(result?.isError);
  const [open, setOpen] = useState<boolean>(isError);

  const oldText = isWrite ? "" : args?.old_string ?? "";
  const newText = isWrite ? args?.content ?? "" : args?.new_string ?? "";
  const diff = diffLines(oldText, newText);
  const { added, removed } = diffCounts(diff);

  const headerLabel = isWrite ? `已创建 ${filePath || "file"}` : `已编辑 ${filePath || "file"}`;
  const truncated = diff.length > MAX_DIFF_LINES ? diff.slice(0, MAX_DIFF_LINES) : diff;

  return (
    <div className={`tool-block${isError ? " tool-block--error" : ""}`}>
      <button type="button" className="tool-block__header" onClick={() => setOpen((v) => !v)}>
        <span className="tool-block__title">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FolderPlus size={14} />
          <span className="tool-block__title-text">
            {headerLabel}
            <span style={{ color: "var(--color-status-ok)", marginLeft: 8 }}>+{added}</span>
            <span style={{ color: "var(--color-status-err)", marginLeft: 4 }}>-{removed}</span>
            {pending ? " · pending" : ""}
            {isError ? " · error" : ""}
          </span>
        </span>
        <span className="tool-block__toggle">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="tool-block__body">
          <UnifiedDiff lines={truncated} />
          {diff.length > MAX_DIFF_LINES ? (
            <p className="modal__hint" style={{ marginTop: 4 }}>
              …({diff.length - MAX_DIFF_LINES} more lines truncated)
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UnifiedDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <pre
      style={{
        margin: 0,
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        whiteSpace: "pre-wrap",
      }}
    >
      {lines.map((line, idx) => {
        const tint =
          line.kind === "add"
            ? "rgba(22, 163, 74, 0.10)"
            : line.kind === "del"
              ? "rgba(220, 38, 38, 0.10)"
              : "transparent";
        const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
        return (
          <div key={idx} style={{ background: tint, padding: "1px 4px" }}>
            <span style={{ color: "var(--color-text-faint)", display: "inline-block", width: 14 }}>{prefix}</span>
            {line.text}
          </div>
        );
      })}
    </pre>
  );
}
