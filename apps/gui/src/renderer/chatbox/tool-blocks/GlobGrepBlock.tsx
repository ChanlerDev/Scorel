import { Search } from "../../icons/index.js";
import { extractToolDetails, extractToolText } from "./result-text.js";
import type { ToolBlockProps } from "./registry.js";
import { ToolChip } from "./ToolChip.js";

type GlobArgs = { pattern?: string; path?: string };
type GrepArgs = { pattern?: string; path?: string; output_mode?: string };

function extractText(value: unknown): string {
  return extractToolText(value);
}

export function GlobGrepBlock({ call, result, pending }: ToolBlockProps) {
  const isGrep = call.toolName === "Grep";
  const args = (call.args ?? {}) as GlobArgs & GrepArgs;
  const details = extractToolDetails(result?.result) as { numFiles?: unknown; numLines?: unknown; numMatches?: unknown; totalFiles?: unknown; mode?: unknown } | undefined;
  const pattern = args.pattern ?? "";
  const text = extractText(result?.result);
  const lines = text ? text.split(/\r?\n/).filter((line) => line.length > 0) : [];
  const count = typeof details?.numLines === "number"
    ? details.numLines
    : typeof details?.numFiles === "number"
      ? details.numFiles
      : lines.length;

  const TRUNCATE_AT = 50;
  const visible = lines.slice(0, TRUNCATE_AT);
  const hidden = lines.length - visible.length;

  return (
    <ToolChip
      icon={<Search />}
      title={
        isGrep ? (
          <>
            Grep <span className="tool-chip__mono-target">"{pattern}"</span>
          </>
        ) : (
          <>Glob <span className="tool-chip__target">{count} files</span></>
        )
      }
      counters={count > 0 ? <span>{count}</span> : undefined}
      pending={pending}
      isError={Boolean(result?.isError)}
      body={
        <>
          <pre className="tool-output">
            {visible.length === 0 ? text || "(empty)" : visible.join("\n")}
            {hidden > 0 ? `\n…(+${hidden} more)` : ""}
          </pre>
          {details?.mode || typeof details?.totalFiles === "number" || typeof details?.numMatches === "number" ? (
            <p className="tool-muted-line">
              {details.mode ? `mode ${String(details.mode)}` : ""}
              {typeof details.totalFiles === "number" ? ` · total ${details.totalFiles}` : ""}
              {typeof details.numMatches === "number" ? ` · matches ${details.numMatches}` : ""}
            </p>
          ) : null}
        </>
      }
    />
  );
}
