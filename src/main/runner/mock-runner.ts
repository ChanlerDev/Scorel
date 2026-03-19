import type { ToolResult } from "../../shared/types.js";
import type { ToolRunner } from "./runner-protocol.js";

type MockCall = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export class MockRunner implements ToolRunner {
  private readonly responses: Map<string, ToolResult>;
  private readonly defaultResult: ToolResult;
  private pendingResolvers = new Map<string, (result: ToolResult) => void>();
  readonly callHistory: MockCall[] = [];
  private _started = false;

  constructor(
    responses?: Map<string, ToolResult>,
    defaultResult?: ToolResult,
  ) {
    this.responses = responses ?? new Map();
    this.defaultResult = defaultResult ?? {
      toolCallId: "",
      isError: false,
      content: "Mock tool executed successfully",
    };
  }

  async start(): Promise<void> {
    this._started = true;
  }

  async stop(): Promise<void> {
    this._started = false;
    // Reject all pending
    for (const [id, resolve] of this.pendingResolvers) {
      resolve({
        toolCallId: id,
        isError: true,
        content: "MockRunner stopped",
      });
    }
    this.pendingResolvers.clear();
  }

  async execute(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    _opts?: { timeoutMs?: number; onUpdate?: (partial: string) => void },
  ): Promise<ToolResult> {
    this.callHistory.push({ toolCallId, toolName, args });

    // Small delay to simulate async execution
    await new Promise((r) => setTimeout(r, 1));

    const preset = this.responses.get(toolCallId);
    if (preset) {
      return { ...preset, toolCallId };
    }

    return { ...this.defaultResult, toolCallId };
  }

  async abort(toolCallId: string): Promise<void> {
    const resolve = this.pendingResolvers.get(toolCallId);
    if (resolve) {
      this.pendingResolvers.delete(toolCallId);
      resolve({
        toolCallId,
        isError: true,
        content: "Tool call aborted",
      });
    }
  }
}
