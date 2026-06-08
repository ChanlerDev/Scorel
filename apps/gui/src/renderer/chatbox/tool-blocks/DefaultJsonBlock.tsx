import { Box } from "../../icons/index.js";
import type { ToolBlockProps } from "./registry.js";
import { ToolChip } from "./ToolChip.js";

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function DefaultJsonBlock({ call, result, pending }: ToolBlockProps) {
  return (
    <ToolChip
      icon={<Box />}
      title={call.toolName}
      pending={pending}
      isError={Boolean(result?.isError)}
      body={
        <>
          <pre>{safeStringify(call.args)}</pre>
          {result ? <pre>{safeStringify(result.result)}</pre> : null}
        </>
      }
    />
  );
}
