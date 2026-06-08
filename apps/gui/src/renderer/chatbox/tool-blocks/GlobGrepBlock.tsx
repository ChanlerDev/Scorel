import { useState } from "react";

import { ChevronDown, ChevronRight, Search } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";

type GlobArgs = { pattern?: string; path?: string };
type GrepArgs = { pattern?: string; path?: string; output_mode?: string };

export function GlobGrepBlock({ call, result, pending }: ToolBlockProps) {
  const isGrep = call.toolName === "Grep";
  const args = (call.args ?? {}) as GlobArgs & GrepArgs;
  const pattern = args.pattern ?? "";
  const isError = Boolean(result?.isError);
  const [open, setOpen] = useState<boolean>(isError);
  const text = extractText(result?.result);
  const lines = text ? text.split(/\r?\n/).filter((line) => line.length > 0) : [];

  const headerText = isGrep
    ? `已搜索 "${pattern}" · ${lines.length} 个匹配`
    : `已探索 ${lines.length} 个文件`;

  const TRUNCATE_AT = 50;
  const visibleLines = open ? lines.slice(0, TRUNCATE_AT) : lines.slice(0, 0);
  const hidden = lines.length - visibleLines.length;

  return (
    <div className={`tool-block${isError ? " tool-block--error" : ""}`}>
      <button type="button" className="tool-block__header" onClick={() => setOpen((v) => !v)}>
        <span className="tool-block__title">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Search size={14} />
          <span className="tool-block__title-text">
            {headerText}
            {pending ? " · pending" : ""}
            {isError ? " · error" : ""}
          </span>
        </span>
        <span className="tool-block__toggle">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="tool-block__body">
          {visibleLines.length === 0 ? (
            <pre style={{ margin: 0 }}>{text || "(empty)"}</pre>
          ) : (
            <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", whiteSpace: "pre-wrap" }}>
              {visibleLines.join("\n")}
              {hidden > 0 ? `\n…(+${hidden} more)` : ""}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return "";
}
