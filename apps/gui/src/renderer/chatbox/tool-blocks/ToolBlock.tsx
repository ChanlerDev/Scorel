import type {
  ToolCallContentBlock,
  ToolResultContentBlock,
} from "@scorel/protocol";

import { lookupToolBlock } from "./registry.js";

export type ToolBlockHostProps = {
  call: ToolCallContentBlock;
  result?: ToolResultContentBlock;
  pending: boolean;
};

export function ToolBlock({ call, result, pending }: ToolBlockHostProps) {
  const Block = lookupToolBlock(call.toolName);
  return <Block call={call} result={result} pending={pending} />;
}
