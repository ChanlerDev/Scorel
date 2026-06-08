import { useState } from "react";

import type { ToolBlockProps } from "./registry.js";

type BashArgs = { command?: string; description?: string };

type BashResult = {
  output?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  exitCode?: number;
};

const COLLAPSE_AT = 12;

export function BashBlock({ call, result, pending }: ToolBlockProps) {
  const args = (call.args ?? {}) as BashArgs;
  const command = args.command ?? "";
  const isError = Boolean(result?.isError);
  const [open, setOpen] = useState<boolean>(isError);
  const [showAll, setShowAll] = useState<boolean>(false);

  const out = parseBashResult(result?.result);
  const lines = out.text ? out.text.split(/\r?\n/) : [];
  const truncated = !showAll && lines.length > COLLAPSE_AT ? lines.slice(0, COLLAPSE_AT) : lines;

  const exitColor = out.exitCode === 0 || out.exitCode === undefined
    ? "var(--color-status-ok)"
    : "var(--color-status-err)";

  return (
    <div className={`tool-block${isError ? " tool-block--error" : ""}`}>
      <button type="button" className="tool-block__header" onClick={() => setOpen((v) => !v)}>
        <span className="tool-block__title">
          <span style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>$</span>
          <span className="tool-block__title-text">
            {truncate(command, 80)}
            {pending ? " · pending" : ""}
            {isError ? " · error" : ""}
          </span>
        </span>
        <span className="tool-block__toggle">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="tool-block__body">
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              whiteSpace: "pre-wrap",
            }}
          >
            {truncated.join("\n")}
          </pre>
          {!showAll && lines.length > COLLAPSE_AT ? (
            <button
              type="button"
              className="tool-block__toggle"
              onClick={() => setShowAll(true)}
              style={{ marginTop: 4 }}
            >
              Show {lines.length - COLLAPSE_AT} more lines
            </button>
          ) : null}
          {out.exitCode !== undefined ? (
            <p style={{ margin: "4px 0 0", fontSize: "var(--text-xs)", color: exitColor }}>
              → exit {out.exitCode}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function parseBashResult(value: unknown): { text: string; exitCode?: number } {
  if (typeof value === "string") return { text: value };
  if (value && typeof value === "object") {
    const r = value as BashResult;
    const stdout = typeof r.stdout === "string" ? r.stdout : "";
    const stderr = typeof r.stderr === "string" ? r.stderr : "";
    const text = r.output ?? [stdout, stderr].filter(Boolean).join("\n");
    const exitCode = typeof r.exit_code === "number" ? r.exit_code : typeof r.exitCode === "number" ? r.exitCode : undefined;
    return { text, exitCode };
  }
  return { text: "" };
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit - 1) + "…" : value;
}
