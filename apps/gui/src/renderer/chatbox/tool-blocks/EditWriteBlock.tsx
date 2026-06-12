import { FilePlus, Pencil } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";
import { ToolChip } from "./ToolChip.js";
import { diffCounts, diffLines, type DiffLine } from "./diff.js";

type EditArgs = { file_path?: string; old_string?: string; new_string?: string };
type WriteArgs = { file_path?: string; content?: string };

const MAX_DIFF_LINES = 200;

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function EditWriteBlock({ call, result, pending }: ToolBlockProps) {
  const isWrite = call.toolName === "Write";
  const args = call.args as EditArgs & WriteArgs;
  const filePath = args?.file_path ?? "";
  const isError = Boolean(result?.isError);

  const oldText = isWrite ? "" : args?.old_string ?? "";
  const newText = isWrite ? args?.content ?? "" : args?.new_string ?? "";
  const diff = diffLines(oldText, newText);
  const { added, removed } = diffCounts(diff);

  const truncated = diff.length > MAX_DIFF_LINES ? diff.slice(0, MAX_DIFF_LINES) : diff;

  return (
    <ToolChip
      icon={isWrite ? <FilePlus /> : <Pencil />}
      title={
        <>
          {isWrite ? "Write" : "Edit"}{" "}
          <span className="tool-chip__mono-target">
            {basename(filePath) || "file"}
          </span>
        </>
      }
      counters={
        <>
          <span className="tool-chip__counter--add">+{added}</span>
          <span className="tool-chip__counter--del">-{removed}</span>
        </>
      }
      pending={pending}
      isError={isError}
      defaultOpen
      body={
        <>
          <UnifiedDiff lines={truncated} />
          {diff.length > MAX_DIFF_LINES ? (
            <p className="tool-muted-line">
              …({diff.length - MAX_DIFF_LINES} more lines truncated)
            </p>
          ) : null}
        </>
      }
    />
  );
}

function UnifiedDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="tool-diff">
      {lines.map((line, idx) => {
        const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
        return (
          <div key={idx} className={`tool-diff__line tool-diff__line--${line.kind}`}>
            <span className="tool-diff__prefix">{prefix}</span>
            {line.text}
          </div>
        );
      })}
    </pre>
  );
}
