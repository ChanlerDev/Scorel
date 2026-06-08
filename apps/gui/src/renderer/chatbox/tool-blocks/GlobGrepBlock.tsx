import { Search } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";
import { ToolChip } from "./ToolChip.js";

type GlobArgs = { pattern?: string; path?: string };
type GrepArgs = { pattern?: string; path?: string; output_mode?: string };

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

export function GlobGrepBlock({ call, result, pending }: ToolBlockProps) {
  const isGrep = call.toolName === "Grep";
  const args = (call.args ?? {}) as GlobArgs & GrepArgs;
  const pattern = args.pattern ?? "";
  const text = extractText(result?.result);
  const lines = text ? text.split(/\r?\n/).filter((line) => line.length > 0) : [];

  const TRUNCATE_AT = 50;
  const visible = lines.slice(0, TRUNCATE_AT);
  const hidden = lines.length - visible.length;

  return (
    <ToolChip
      icon={<Search />}
      title={
        isGrep ? (
          <>
            已搜索 <span style={{ color: "var(--color-text)", fontFamily: "var(--font-mono)" }}>"{pattern}"</span>
          </>
        ) : (
          <>已探索 {lines.length} 个文件</>
        )
      }
      pending={pending}
      isError={Boolean(result?.isError)}
      body={
        <pre>
          {visible.length === 0 ? text || "(empty)" : visible.join("\n")}
          {hidden > 0 ? `\n…(+${hidden} more)` : ""}
        </pre>
      }
    />
  );
}
