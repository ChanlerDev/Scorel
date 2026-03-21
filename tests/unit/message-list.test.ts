import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../../src/shared/types.js";
import * as MessageListModule from "../../src/renderer/components/MessageList.js";

const { MessageList } = MessageListModule;

function makeAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    id: "assistant-1",
    api: "openai-chat-completions",
    providerId: "provider-1",
    modelId: "model-1",
    content: [
      { type: "text", text },
      {
        type: "toolCall",
        id: "tool-1",
        name: "read_file",
        arguments: { path: "/tmp/demo.ts" },
      },
    ],
    stopReason: "toolUse",
    ts: 1,
  };
}

describe("MessageList", () => {
  it("renders markdown and escapes raw HTML in assistant text", () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageList, {
        messages: [makeAssistantMessage("# Title\n\n- item\n\n`inline`\n\n```ts\nconst answer = 42;\n```\n\n<script>alert('xss')</script>")],
        streamingMessage: null,
        searchNavigationTarget: null,
        toolStatuses: {},
        sessionId: "session-1",
      }),
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<li>item</li>");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain("<pre><code class=\"language-ts\">const answer = 42;\n</code></pre>");
    expect(html).toContain("&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert('xss')</script>");
  });

  it("shows approval actions for awaiting tool calls", () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageList, {
        messages: [makeAssistantMessage("Need approval")],
        streamingMessage: null,
        searchNavigationTarget: null,
        toolStatuses: {
          "tool-1": {
            toolCallId: "tool-1",
            toolName: "read_file",
            state: "awaiting_approval",
          },
        },
        sessionId: "session-1",
      }),
    );

    expect(html).toContain("Awaiting approval");
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Deny<");
  });

  it("shows approval action failures inline for awaiting tool calls", () => {
    const maybeRenderContentPart = (MessageListModule as Record<string, unknown>).renderContentPart;
    const element = typeof maybeRenderContentPart === "function"
      ? (maybeRenderContentPart as (
        part: {
          type: "toolCall";
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        },
        idx: number,
        toolStatuses: Record<string, {
          toolCallId: string;
          toolName: string;
          state: "awaiting_approval";
        }>,
        sessionId: string | null,
        pendingApprovals: Record<string, boolean>,
        approvalErrors: Record<string, string>,
        onApprovalAction: (toolCallId: string, decision: "approve" | "deny") => void,
      ) => ReturnType<typeof React.createElement>)(
        {
          type: "toolCall",
          id: "tool-1",
          name: "write_file",
          arguments: { path: "/tmp/demo" },
        },
        0,
        {
          "tool-1": {
            toolCallId: "tool-1",
            toolName: "write_file",
            state: "awaiting_approval",
          },
        },
        "session-1",
        {},
        { "tool-1": "Approval action failed" },
        () => {},
      )
      : null;

    const html = element
      ? renderToStaticMarkup(React.createElement("div", null, element))
      : "";

    expect(html).toContain("Approval action failed");
  });
});
