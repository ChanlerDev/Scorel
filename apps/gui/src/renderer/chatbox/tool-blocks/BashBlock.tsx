import { useState } from "react";

import { Terminal } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";
import { ToolChip } from "./ToolChip.js";

type BashArgs = { command?: string; description?: string };

type BashResult = {
  output?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  exitCode?: number;
};

const COLLAPSE_AT = 12;

function truncate(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit - 1) + "…" : value;
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

export function BashBlock({ call, result, pending }: ToolBlockProps) {
  const args = (call.args ?? {}) as BashArgs;
  const command = args.command ?? "";
  const out = parseBashResult(result?.result);
  const [showAll, setShowAll] = useState<boolean>(false);
  const lines = out.text ? out.text.split(/\r?\n/) : [];
  const visible = !showAll && lines.length > COLLAPSE_AT ? lines.slice(0, COLLAPSE_AT) : lines;
  const exitColor = out.exitCode === 0 || out.exitCode === undefined
    ? "var(--color-status-ok)"
    : "var(--color-status-err)";

  return (
    <ToolChip
      icon={<Terminal />}
      title={
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text)" }}>
          $ {truncate(command, 64)}
        </span>
      }
      pending={pending}
      isError={Boolean(result?.isError)}
      body={
        <>
          <pre>{visible.join("\n")}</pre>
          {!showAll && lines.length > COLLAPSE_AT ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              style={{
                marginTop: 4,
                fontSize: 12,
                color: "var(--color-text-muted)",
                textDecoration: "underline",
                background: "transparent",
              }}
            >
              展开 {lines.length - COLLAPSE_AT} 行
            </button>
          ) : null}
          {out.exitCode !== undefined ? (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: exitColor }}>
              → exit {out.exitCode}
            </p>
          ) : null}
        </>
      }
    />
  );
}
