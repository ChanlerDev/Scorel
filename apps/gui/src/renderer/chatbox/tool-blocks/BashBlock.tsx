import { useState } from "react";

import { Terminal } from "../../icons/index.js";
import { extractToolDetails, extractToolText } from "./result-text.js";
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

type BashDetails = {
  exitCode?: unknown;
};

const COLLAPSE_AT = 12;

function truncate(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit - 1) + "…" : value;
}

function parseBashResult(value: unknown): { text: string; exitCode?: number } {
  const toolText = extractToolText(value);
  const details = extractToolDetails(value) as BashDetails | undefined;
  if (toolText) {
    return {
      text: toolText,
      exitCode: typeof details?.exitCode === "number" ? details.exitCode : undefined,
    };
  }
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
  const out = parseBashResult(result?.result);
  const command = args.command ?? "";
  const [showAll, setShowAll] = useState<boolean>(false);
  const lines = out.text ? out.text.split(/\r?\n/) : [];
  const visible = !showAll && lines.length > COLLAPSE_AT ? lines.slice(0, COLLAPSE_AT) : lines;
  return (
    <ToolChip
      icon={<Terminal />}
      title={
        <span className="tool-chip__mono-target">
          $ {truncate(command, 64)}
        </span>
      }
      counters={out.exitCode !== undefined ? <span className={out.exitCode === 0 ? "tool-chip__counter--ok" : "tool-chip__counter--err"}>exit {out.exitCode}</span> : undefined}
      pending={pending}
      isError={Boolean(result?.isError)}
      body={
        <>
          <pre className="tool-output">{visible.join("\n")}</pre>
          {!showAll && lines.length > COLLAPSE_AT ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="tool-link-button"
            >
              展开 {lines.length - COLLAPSE_AT} 行
            </button>
          ) : null}
        </>
      }
    />
  );
}
