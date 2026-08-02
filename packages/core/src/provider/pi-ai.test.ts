import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { ScorelMessage } from "@scorel/protocol";

import { createPiAiProvider, resolvePiAiModel } from "./pi-ai.js";
import { listAvailableModels, resolveModelSelection, type ScorelConfig } from "../config/index.js";
import type { AgentTool } from "../tools/index.js";

describe("model profile resolution", () => {
  it("resolves builtin model roles through the configured available model pool", () => {
    const selection = resolveModelSelection(builtinProfile, { role: "standard" });
    const model = resolvePiAiModel(selection.config);

    expect(selection).toMatchObject({
      modelId: "main",
      role: "standard",
      displayName: "GPT 5.4 Mini",
      providerId: "openai",
    });
    expect(model.id).toBe("gpt-5.4-mini");
    expect(model.provider).toBe("openai");
  });

  it("lists available models without provider credentials", () => {
    expect(listAvailableModels(builtinProfile)).toEqual([
      {
        modelId: "main",
        providerModelId: "main",
        providerId: "openai",
        provider: "openai",
        id: "gpt-5.4-mini",
        displayName: "GPT 5.4 Mini",
        roles: ["primary", "standard"],
      },
      {
        modelId: "aux",
        providerModelId: "aux",
        providerId: "openai",
        provider: "openai",
        id: "gpt-5.4-nano",
        displayName: "GPT 5.4 Nano",
        roles: ["auxiliary"],
      },
    ]);
  });

  it("resolves custom models with manual context metadata", () => {
    const selection = resolveModelSelection(customProfile, { modelId: "aux" });
    const model = resolvePiAiModel(selection.config);

    expect(model).toMatchObject({
      id: "deepseek-v4-flash",
      provider: "chanleramp",
      baseUrl: "https://amp.chanler.dev/v1",
      contextWindow: 400000,
      maxTokens: 128000,
      reasoning: true,
      input: ["text", "image"],
    });
  });
});

describe("createPiAiProvider", () => {
  it.each(["xhigh", "max"] as const)("sends %s as a distinct provider reasoning effort", async (reasoning) => {
    const server = await startOpenAiCompletionsServer();
    const provider = createPiAiProvider({
      model: resolvePiAiModel({
        type: "custom",
        provider: "scorel-test",
        id: "reasoning-model",
        baseUrl: server.baseUrl,
        api: "openai-completions",
        apiKey: "test-key",
        contextWindow: 400000,
        maxTokens: 128000,
        reasoning: true,
      }),
      apiKey: "test-key",
      reasoning,
    });

    try {
      await collectProvider(provider.streamTurn({
        context: [user("test reasoning")],
        systemPrompt: undefined,
        tools: [],
        signal: new AbortController().signal,
        options: {},
      }));

      expect(server.requests[0]).toMatchObject({ reasoning_effort: reasoning });
    } finally {
      await server.close();
    }
  });

  it("uses systemPrompt as a system message for custom OpenAI-compatible completions by default", async () => {
    const server = await startOpenAiCompletionsServer();
    const provider = createPiAiProvider({
      model: resolvePiAiModel({
        type: "custom",
        provider: "scorel-test",
        id: "gpt-5.4-mini",
        baseUrl: server.baseUrl,
        api: "openai-completions",
        apiKey: "chanleramp",
        contextWindow: 400000,
        maxTokens: 128000,
        reasoning: true,
      }),
      apiKey: "chanleramp",
    });

    try {
      const result = await collectProvider(provider.streamTurn({
        context: [user("read README")],
        systemPrompt: "You are Scorel.",
        tools: [readTool],
        signal: new AbortController().signal,
        options: {},
      }));

      expect(result).toMatchObject({
        role: "assistant",
        content: [{ type: "tool_call", toolCallId: "call_1", toolName: "Read", args: { path: "README.md" } }],
        stopReason: "tool_call",
        meta: {
          api: "openai-completions",
          provider: "scorel-test",
          model: "gpt-5.4-mini",
        },
      });
      expect(server.requests[0]).toMatchObject({
        model: "gpt-5.4-mini",
        stream: true,
        messages: [
          {
            role: "system",
            content: "You are Scorel.",
          },
          {
            role: "user",
            content: "read README",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "Read",
            },
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("allows custom OpenAI-compatible completions to opt into developer role support", async () => {
    const server = await startOpenAiCompletionsServer();
    const provider = createPiAiProvider({
      model: resolvePiAiModel({
        type: "custom",
        provider: "scorel-test",
        id: "gpt-5.4-mini",
        baseUrl: server.baseUrl,
        api: "openai-completions",
        apiKey: "chanleramp",
        contextWindow: 400000,
        maxTokens: 128000,
        reasoning: true,
        compat: { supportsDeveloperRole: true },
      }),
      apiKey: "chanleramp",
    });

    try {
      await collectProvider(provider.streamTurn({
        context: [user("read README")],
        systemPrompt: "You are Scorel.",
        tools: [readTool],
        signal: new AbortController().signal,
        options: {},
      }));

      expect(server.requests[0]).toMatchObject({
        messages: [
          {
            role: "developer",
            content: "You are Scorel.",
          },
          {
            role: "user",
            content: "read README",
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("lowers structured system reminder blocks to provider text", async () => {
    const server = await startOpenAiCompletionsServer();
    const provider = createPiAiProvider({
      model: resolvePiAiModel({
        type: "custom",
        provider: "scorel-test",
        id: "gpt-5.4-mini",
        baseUrl: server.baseUrl,
        api: "openai-completions",
        apiKey: "chanleramp",
        contextWindow: 400000,
        maxTokens: 128000,
        reasoning: true,
      }),
      apiKey: "chanleramp",
    });

    try {
      await collectProvider(provider.streamTurn({
        context: [{
          role: "user",
          content: [
            { type: "text", text: "read README" },
            {
              type: "system_reminder",
              kind: "message_ref",
              origin: "system",
              text: "snip.userMessageId: u_12345678",
              visibility: "model",
              scope: "message",
            },
          ],
        }],
        systemPrompt: undefined,
        tools: [readTool],
        signal: new AbortController().signal,
        options: {},
      }));

      expect(server.requests[0]).toMatchObject({
        messages: [
          {
            role: "user",
            content: "read README\n<system-reminder>\nsnip.userMessageId: u_12345678\n</system-reminder>",
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("exposes snip tool parameters to the provider", async () => {
    const server = await startOpenAiCompletionsServer();
    const provider = createPiAiProvider({
      model: resolvePiAiModel({
        type: "custom",
        provider: "scorel-test",
        id: "gpt-5.4-mini",
        baseUrl: server.baseUrl,
        api: "openai-completions",
        apiKey: "chanleramp",
        contextWindow: 400000,
        maxTokens: 128000,
        reasoning: true,
      }),
      apiKey: "chanleramp",
    });

    try {
      await collectProvider(provider.streamTurn({
        context: [user("snip obsolete context")],
        systemPrompt: undefined,
        tools: [snipTool],
        signal: new AbortController().signal,
        options: {},
      }));

      expect(server.requests[0]).toMatchObject({
        tools: [
          {
            type: "function",
            function: {
              name: "snip",
              parameters: {
                type: "object",
                properties: {
                  userMessageId: { type: "string" },
                  reason: { type: "string" },
                },
              },
            },
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("uses each AgentTool's own parameter schema instead of provider name switches", async () => {
    const server = await startOpenAiCompletionsServer();
    const provider = createPiAiProvider({
      model: resolvePiAiModel({
        type: "custom",
        provider: "scorel-test",
        id: "gpt-5.4-mini",
        baseUrl: server.baseUrl,
        api: "openai-completions",
        apiKey: "chanleramp",
        contextWindow: 400000,
        maxTokens: 128000,
        reasoning: true,
      }),
      apiKey: "chanleramp",
    });

    try {
      await collectProvider(provider.streamTurn({
        context: [user("use reference tool")],
        systemPrompt: undefined,
        tools: [customReferenceTool],
        signal: new AbortController().signal,
        options: {},
      }));

      expect(server.requests[0]).toMatchObject({
        tools: [
          {
            type: "function",
            function: {
              name: "ReferenceTurn",
              parameters: {
                type: "object",
                properties: {
                  ref: { type: "string" },
                },
              },
            },
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("preserves provider error messages on error assistant turns", async () => {
    const server = await startOpenAiCompletionsServer([
      {
        id: "chatcmpl-scorel-test",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }],
      },
    ]);
    const provider = createPiAiProvider({
      model: resolvePiAiModel({
        type: "custom",
        provider: "scorel-test",
        id: "gpt-5.4-mini",
        baseUrl: server.baseUrl,
        api: "openai-completions",
        apiKey: "chanleramp",
        contextWindow: 400000,
        maxTokens: 128000,
        reasoning: true,
      }),
      apiKey: "chanleramp",
    });

    try {
      const result = await collectProvider(provider.streamTurn({
        context: [user("trigger filter")],
        systemPrompt: undefined,
        tools: [],
        signal: new AbortController().signal,
        options: {},
      }));

      expect(result).toMatchObject({
        role: "assistant",
        content: [],
        stopReason: "error",
        meta: {
          errorMessage: "Provider finish_reason: content_filter",
        },
      });
    } finally {
      await server.close();
    }
  });
});

const readTool: AgentTool = {
  name: "Read",
  description: "Read a file",
  parameters: Type.Object({
    file_path: Type.String(),
  }),
  execute: async () => ({ content: [] }),
};

const snipTool: AgentTool = {
  name: "snip",
  description: "Hide a completed user turn",
  parameters: Type.Object({
    userMessageId: Type.String(),
    reason: Type.Optional(Type.String()),
  }),
  execute: async () => ({ content: [] }),
};

const customReferenceTool: AgentTool = {
  name: "ReferenceTurn",
  description: "Reference a conversation turn",
  parameters: Type.Object({
    ref: Type.String(),
  }),
  execute: async () => ({ content: [] }),
};

const builtinProfile: ScorelConfig = {
  providers: {
    openai: {
      type: "builtin",
      provider: "openai",
      apiKey: "secret",
    },
  },
  providerModels: {
    main: {
      provider: "openai",
      id: "gpt-5.4-mini",
      displayName: "GPT 5.4 Mini",
    },
    aux: {
      provider: "openai",
      id: "gpt-5.4-nano",
      displayName: "GPT 5.4 Nano",
    },
  },
  models: {
    main: { model: "main", displayName: "GPT 5.4 Mini" },
    aux: { model: "aux", displayName: "GPT 5.4 Nano" },
  },
  modelProfile: {
    roles: {
      primary: "main",
      standard: "main",
      auxiliary: "aux",
    },
  },
  memory: {
    enabled: true,
    daily: true,
    sessionMemory: true,
    autoDream: true,
    promoteRoot: true,
    dreamIdleMinutes: 60,
    autoCompactThreshold: 0.8,
  },
  runtime: {
    tokenSavingRtk: false,
  },
  extensions: {},
};

const customProfile: ScorelConfig = {
  providers: {
    chanleramp: {
      type: "custom",
      api: "openai-completions",
      provider: "chanleramp",
      baseUrl: "https://amp.chanler.dev/v1",
      apiKey: "secret",
    },
  },
  providerModels: {
    aux: {
      provider: "chanleramp",
      id: "deepseek-v4-flash",
      displayName: "DeepSeek Flash",
      contextWindow: 400000,
      maxTokens: 128000,
      reasoning: true,
      supportsImageInput: true,
    },
  },
  models: {
    aux: { model: "aux", displayName: "DeepSeek Flash" },
  },
  modelProfile: {
    roles: {
      primary: "aux",
      standard: "aux",
      auxiliary: "aux",
    },
  },
  memory: {
    enabled: true,
    daily: true,
    sessionMemory: true,
    autoDream: true,
    promoteRoot: true,
    dreamIdleMinutes: 60,
    autoCompactThreshold: 0.8,
  },
  runtime: {
    tokenSavingRtk: false,
  },
  extensions: {},
};

const user = (text: string): ScorelMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

const collectProvider = async (stream: AsyncGenerator<unknown, ScorelMessage | void, undefined>) => {
  while (true) {
    const next = await stream.next();
    if (next.done) {
      return next.value;
    }
  }
};

const startOpenAiCompletionsServer = async (chunks?: unknown[]) => {
  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    requests.push(await readJson(request));
    writeSse(response, chunks ?? [
      {
        id: "chatcmpl-scorel-test",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "Read", arguments: "{\"path\":\"README.md\"}" },
                },
              ],
            },
          },
        ],
      },
      {
        id: "chatcmpl-scorel-test",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
    ]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("missing server address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const writeSse = (response: ServerResponse, chunks: unknown[]): void => {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.write("data: [DONE]\n\n");
  response.end();
};
