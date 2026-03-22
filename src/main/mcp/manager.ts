import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  ProgressNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  McpCallToolResult,
  McpCapabilities,
  McpServerConfig,
  McpServerStatus,
  McpServerSummary,
  McpToolDefinition,
} from "../../shared/types.js";
import { getToolEntry, registerMcpTools, unregisterMcpTools } from "../core/tool-dispatch.js";

export type McpToolCallOptions = {
  toolCallId: string;
  onUpdate?: (partial: string) => void;
};

export type McpSession = {
  config: McpServerConfig;
  status: McpServerStatus;
  capabilities: McpCapabilities | null;
  tools: McpToolDefinition[];
  lastError: string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  refreshTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>, opts: McpToolCallOptions): Promise<McpCallToolResult>;
  ping(): Promise<void>;
  onError(handler: (error: Error) => void): void;
  onToolsChanged(handler: (tools: McpToolDefinition[]) => void): void;
};

type McpManagerOptions = {
  appName?: string;
  appVersion?: string;
  createSession?: (config: McpServerConfig) => Promise<McpSession>;
  healthCheckIntervalMs?: number;
  maxHealthFailures?: number;
};

type McpRuntimeState = {
  status: McpServerStatus;
  toolCount: number;
  lastError: string | null;
};

function formatProgressUpdate(params: { progress: number; total?: number; message?: string }): string {
  if (params.message) {
    return params.total != null
      ? `${params.message} (${params.progress}/${params.total})`
      : `${params.message} (${params.progress})`;
  }

  return params.total != null
    ? `${params.progress}/${params.total}`
    : String(params.progress);
}

class SdkMcpSession implements McpSession {
  config: McpServerConfig;
  status: McpServerStatus = "disconnected";
  capabilities: McpCapabilities | null = null;
  tools: McpToolDefinition[] = [];
  lastError: string | null = null;

  private readonly client: Client;
  private readonly transport: StdioClientTransport | StreamableHTTPClientTransport;
  private readonly progressHandlers = new Map<string, (partial: string) => void>();
  private errorHandler: ((error: Error) => void) | null = null;
  private toolsChangedHandler: ((tools: McpToolDefinition[]) => void) | null = null;

  constructor(config: McpServerConfig, opts?: { appName?: string; appVersion?: string }) {
    this.config = config;
    this.transport = createTransport(config);
    this.client = new Client(
      {
        name: opts?.appName ?? "Scorel",
        version: opts?.appVersion ?? "0.1.0",
      },
      {
        capabilities: {},
      },
    );

    this.transport.onerror = (error) => {
      this.status = "error";
      this.lastError = error.message;
      this.errorHandler?.(error);
    };
    this.transport.onclose = () => {
      if (this.status !== "error") {
        this.status = "disconnected";
      }
    };

    this.client.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      const token = String(notification.params.progressToken);
      const handler = this.progressHandlers.get(token);
      if (handler) {
        handler(formatProgressUpdate(notification.params));
      }
    });

    this.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      try {
        const tools = await this.refreshTools();
        this.toolsChangedHandler?.(tools);
      } catch (error: unknown) {
        this.errorHandler?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  onToolsChanged(handler: (tools: McpToolDefinition[]) => void): void {
    this.toolsChangedHandler = handler;
  }

  async connect(): Promise<void> {
    this.status = "connecting";
    await this.client.connect(this.transport);
    this.status = "initializing";
    this.capabilities = this.client.getServerCapabilities() as McpCapabilities | undefined ?? null;
    await this.refreshTools();
    this.status = "ready";
    this.lastError = null;
  }

  async refreshTools(): Promise<McpToolDefinition[]> {
    const response = await this.client.listTools();
    this.tools = response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    return this.tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts: McpToolCallOptions,
  ): Promise<McpCallToolResult> {
    const token = opts.toolCallId;
    if (opts.onUpdate) {
      this.progressHandlers.set(token, opts.onUpdate);
    }

    try {
      const response = await this.client.callTool({
        name,
        arguments: args,
        _meta: {
          progressToken: token,
        },
      });

      if ("toolResult" in response) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.toolResult),
            },
          ],
          isError: false,
          _meta: response._meta,
        };
      }

      return {
        content: response.content as McpCallToolResult["content"],
        isError: response.isError,
        structuredContent: response.structuredContent,
        _meta: response._meta,
      };
    } finally {
      this.progressHandlers.delete(token);
    }
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async disconnect(): Promise<void> {
    if (this.transport instanceof StreamableHTTPClientTransport) {
      await this.transport.terminateSession().catch(() => undefined);
    }
    await this.transport.close();
    this.status = "disconnected";
    this.tools = [];
  }
}

function createTransport(config: McpServerConfig): StdioClientTransport | StreamableHTTPClientTransport {
  if (config.transport.type === "stdio") {
    return new StdioClientTransport({
      command: config.transport.command,
      args: config.transport.args ?? [],
      env: config.transport.env,
      cwd: config.transport.cwd,
    });
  }

  return new StreamableHTTPClientTransport(
    new URL(config.transport.url),
    {
      requestInit: {
        headers: config.transport.headers,
      },
    },
  );
}

export class McpManager {
  private readonly configs = new Map<string, McpServerConfig>();
  private readonly sessions = new Map<string, McpSession>();
  private readonly healthFailures = new Map<string, number>();
  private readonly runtimeStates = new Map<string, McpRuntimeState>();
  private readonly createSessionFn: (config: McpServerConfig) => Promise<McpSession>;
  private readonly healthCheckIntervalMs: number;
  private readonly maxHealthFailures: number;
  private readonly healthTimer: ReturnType<typeof setInterval>;

  constructor(opts?: McpManagerOptions) {
    this.createSessionFn = opts?.createSession ?? (async (config) => new SdkMcpSession(config, opts));
    this.healthCheckIntervalMs = opts?.healthCheckIntervalMs ?? 30_000;
    this.maxHealthFailures = opts?.maxHealthFailures ?? 3;
    this.healthTimer = setInterval(() => {
      void this.checkHealth();
    }, this.healthCheckIntervalMs);
    this.healthTimer.unref?.();
  }

  upsertConfig(config: McpServerConfig): void {
    this.configs.set(config.id, config);
    const existingRuntime = this.runtimeStates.get(config.id);
    this.runtimeStates.set(config.id, existingRuntime ?? {
      status: "disconnected",
      toolCount: 0,
      lastError: null,
    });
  }

  removeConfig(serverId: string): void {
    this.configs.delete(serverId);
    this.runtimeStates.delete(serverId);
  }

  listServers(): McpServerSummary[] {
    return Array.from(this.configs.values())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((config) => {
        const session = this.sessions.get(config.id);
        const runtime = this.runtimeStates.get(config.id);
        return {
          ...config,
          status: session?.status ?? runtime?.status ?? "disconnected",
          toolCount: session?.tools.length ?? runtime?.toolCount ?? 0,
          lastError: session?.lastError ?? runtime?.lastError ?? null,
        };
      });
  }

  async testConnection(config: McpServerConfig): Promise<{
    ok: boolean;
    capabilities?: McpCapabilities | null;
    tools?: McpToolDefinition[];
    error?: string;
  }> {
    const session = await this.createSessionFn(config);
    try {
      await session.connect();
      return {
        ok: true,
        capabilities: session.capabilities,
        tools: session.tools,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await session.disconnect().catch(() => undefined);
    }
  }

  async startAutoStartServers(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.configs.values())
        .filter((config) => config.enabled && config.autoStart)
        .map((config) => this.startServer(config.id)),
    );
  }

  async startServer(serverId: string): Promise<void> {
    const config = this.configs.get(serverId);
    if (!config) {
      throw new Error(`Unknown MCP server: ${serverId}`);
    }

    const existing = this.sessions.get(serverId);
    if (existing) {
      await this.stopServer(serverId);
    }

    const session = await this.createSessionFn(config);
    this.runtimeStates.set(serverId, {
      status: "connecting",
      toolCount: 0,
      lastError: null,
    });
    session.onError((error) => {
      session.status = "error";
      session.lastError = error.message;
      this.runtimeStates.set(serverId, {
        status: "error",
        toolCount: session.tools.length,
        lastError: error.message,
      });
    });
    session.onToolsChanged((tools) => {
      registerMcpTools(serverId, config.name, tools);
      this.runtimeStates.set(serverId, {
        status: session.status,
        toolCount: tools.length,
        lastError: session.lastError,
      });
    });

    try {
      await session.connect();
      this.sessions.set(serverId, session);
      registerMcpTools(serverId, config.name, session.tools);
      this.runtimeStates.set(serverId, {
        status: session.status,
        toolCount: session.tools.length,
        lastError: null,
      });
      this.healthFailures.set(serverId, 0);
    } catch (error: unknown) {
      unregisterMcpTools(serverId);
      this.sessions.delete(serverId);
      this.runtimeStates.set(serverId, {
        status: "error",
        toolCount: 0,
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async stopServer(serverId: string): Promise<void> {
    unregisterMcpTools(serverId);
    const session = this.sessions.get(serverId);
    if (!session) {
      this.runtimeStates.set(serverId, {
        status: "disconnected",
        toolCount: 0,
        lastError: null,
      });
      return;
    }

    await session.disconnect();
    this.sessions.delete(serverId);
    this.healthFailures.delete(serverId);
    this.runtimeStates.set(serverId, {
      status: "disconnected",
      toolCount: 0,
      lastError: null,
    });
  }

  async restartServer(serverId: string): Promise<void> {
    await this.stopServer(serverId);
    await this.startServer(serverId);
  }

  async shutdownAll(): Promise<void> {
    clearInterval(this.healthTimer);
    await Promise.all(Array.from(this.sessions.keys()).map((serverId) => this.stopServer(serverId)));
  }

  async callTool(
    qualifiedToolName: string,
    args: Record<string, unknown>,
    opts: McpToolCallOptions,
  ): Promise<McpCallToolResult> {
    const entry = getToolEntry(qualifiedToolName);
    if (!entry || entry.backend !== "mcp" || !entry.serverId || !entry.mcpToolName) {
      throw new Error(`Unknown MCP tool: ${qualifiedToolName}`);
    }

    const session = this.sessions.get(entry.serverId);
    if (!session || session.status !== "ready") {
      throw new Error(`MCP server "${entry.serverId}" is not ready`);
    }

    return session.callTool(entry.mcpToolName, args, opts);
  }

  private async checkHealth(): Promise<void> {
    for (const [serverId, session] of this.sessions.entries()) {
      if (session.status !== "ready") {
        continue;
      }

      try {
        await session.ping();
        this.healthFailures.set(serverId, 0);
      } catch (error: unknown) {
        const failures = (this.healthFailures.get(serverId) ?? 0) + 1;
        this.healthFailures.set(serverId, failures);
        session.lastError = error instanceof Error ? error.message : String(error);
        this.runtimeStates.set(serverId, {
          status: "error",
          toolCount: session.tools.length,
          lastError: session.lastError,
        });
        if (failures >= this.maxHealthFailures) {
          await this.restartServer(serverId);
        }
      }
    }
  }
}
