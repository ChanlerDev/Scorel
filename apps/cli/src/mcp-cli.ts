import { DaemonClient, WsTransport } from "@scorel/client";
import {
  readLocalDaemonState,
} from "@scorel/daemon";
import {
  asClientId,
  type McpServerStatusSummary,
} from "@scorel/protocol";

export type McpCommandIo = {
  stateDir: string;
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
};

export const writeMcpUsage = (stream: NodeJS.WritableStream): void => {
  stream.write(
    [
      "scorel mcp <command> [args]",
      "",
      "Commands:",
      "  list                         List configured MCP servers and their status",
      "  add <id> [options]           Add or update an MCP server",
      "  remove <id>                  Remove an MCP server",
      "  call <server> <tool> [args]  Call a tool on a connected MCP server",
      "  cloud list [options]         List servers from the Cloud MCP registry",
      "  cloud add <catalog-id> [id]  Add a server from the Cloud MCP registry",
      "",
      "Add options:",
      "  --transport <stdio|http|sse>  Transport type (required)",
      "  --command <cmd>               Command for stdio transport",
      "  --args <a,b,...>              Comma-separated args for stdio transport",
      "  --cwd <path>                  Working directory for stdio transport",
      "  --url <url>                   URL for http/sse transport",
      "  --env <K=V,...>               Comma-separated env vars for stdio",
      "  --env-headers <H=ENV,...>     Comma-separated env-header mappings",
      "",
      "Cloud list options:",
      "  --registry <url>              Registry URL (default: https://registry.modelcontextprotocol.io/servers)",
      "",
    ].join("\n") + "\n",
  );
};

type AddOptions = {
  serverId: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, string>;
  envHeaders?: Record<string, string>;
};

const parseAddOptions = (args: string[], serverId: string): AddOptions => {
  let transport: string | undefined;
  let command: string | undefined;
  let argsStr: string | undefined;
  let cwd: string | undefined;
  let url: string | undefined;
  let envStr: string | undefined;
  let envHeadersStr: string | undefined;
  const remaining: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--transport") {
      transport = args[++i];
    } else if (arg === "--command") {
      command = args[++i];
    } else if (arg === "--args") {
      argsStr = args[++i];
    } else if (arg === "--cwd") {
      cwd = args[++i];
    } else if (arg === "--url") {
      url = args[++i];
    } else if (arg === "--env") {
      envStr = args[++i];
    } else if (arg === "--env-headers") {
      envHeadersStr = args[++i];
    } else {
      remaining.push(arg);
    }
  }
  if (!transport || !["stdio", "http", "sse"].includes(transport)) {
    throw new Error("--transport is required and must be stdio, http, or sse");
  }
  if (transport === "stdio" && !command) {
    throw new Error("--command is required for stdio transport");
  }
  if ((transport === "http" || transport === "sse") && !url) {
    throw new Error(`--url is required for ${transport} transport`);
  }
  const options: AddOptions = { serverId, transport: transport as "stdio" | "http" | "sse" };
  if (command) options.command = command;
  if (argsStr) options.args = argsStr.split(",").map((s) => s.trim()).filter(Boolean);
  if (cwd) options.cwd = cwd;
  if (url) options.url = url;
  if (envStr) {
    options.env = {};
    for (const pair of envStr.split(",").map((s) => s.trim()).filter(Boolean)) {
      const eq = pair.indexOf("=");
      if (eq > 0) {
        options.env[pair.slice(0, eq)!] = pair.slice(eq + 1);
      }
    }
  }
  if (envHeadersStr) {
    options.envHeaders = {};
    for (const pair of envHeadersStr.split(",").map((s) => s.trim()).filter(Boolean)) {
      const eq = pair.indexOf("=");
      if (eq > 0) {
        options.envHeaders[pair.slice(0, eq)!] = pair.slice(eq + 1);
      }
    }
  }
  void remaining;
  return options;
};

const connectClient = async (stateDir: string): Promise<DaemonClient> => {
  const state = await readLocalDaemonState({ stateDir });
  if (!state || state.stoppedAt !== null) {
    throw new Error("local daemon is not running");
  }
  const client = new DaemonClient(new WsTransport({ url: state.wsUrl, token: state.token }), {
    clientId: asClientId("client_cli_mcp"),
  });
  await client.connect();
  return client;
};

const formatStatusLine = (server: McpServerStatusSummary): string => {
  const status = server.connected ? "connected" : (server.error ? "error" : "disconnected");
  const toolInfo = server.toolCount > 0 ? `${server.toolCount} tools` : "no tools";
  const endpoint = server.command
    ? `${server.command}${server.args ? ` ${server.args.join(" ")}` : ""}`
    : (server.url ?? "");
  return `${server.serverId}\t${server.transport}\t${status}\t${toolInfo}\t${endpoint}${server.error ? `\t${server.error}` : ""}`;
};

export const runCliMcp = async (
  argv: string[],
  io: McpCommandIo,
): Promise<number> => {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    writeMcpUsage(io.output);
    return command ? 0 : 1;
  }
  try {
    if (command === "list") {
      if (rest.length > 0) {
        writeMcpUsage(io.error);
        return 1;
      }
      const client = await connectClient(io.stateDir);
      try {
        const servers = await client.listMcpServers();
        if (servers.length === 0) {
          io.output.write("No MCP servers configured.\n");
        } else {
          io.output.write("SERVER\tTRANSPORT\tSTATUS\tTOOLS\tENDPOINT\n");
          for (const server of servers) {
            io.output.write(`${formatStatusLine(server)}\n`);
          }
        }
        return 0;
      } finally {
        client.disconnect();
      }
    }
    if (command === "add") {
      const [serverId, ...flags] = rest;
      if (!serverId) {
        writeMcpUsage(io.error);
        return 1;
      }
      const options = parseAddOptions(flags, serverId);
      const client = await connectClient(io.stateDir);
      try {
        await client.upsertMcpServer(options);
        io.output.write(`Added MCP server "${serverId}" (${options.transport}).\n`);
        return 0;
      } finally {
        client.disconnect();
      }
    }
    if (command === "remove") {
      const [serverId] = rest;
      if (!serverId) {
        writeMcpUsage(io.error);
        return 1;
      }
      const client = await connectClient(io.stateDir);
      try {
        await client.removeMcpServer({ serverId });
        io.output.write(`Removed MCP server "${serverId}".\n`);
        return 0;
      } finally {
        client.disconnect();
      }
    }
    if (command === "call") {
      const [serverId, toolName, argsJson] = rest;
      if (!serverId || !toolName) {
        writeMcpUsage(io.error);
        return 1;
      }
      let args: Record<string, unknown> | undefined;
      if (argsJson) {
        try {
          args = JSON.parse(argsJson) as Record<string, unknown>;
        } catch {
          io.error.write("scorel mcp call error: args must be valid JSON\n");
          return 1;
        }
      }
      const client = await connectClient(io.stateDir);
      try {
        const result = await client.callMcpTool({ serverId, toolName, args });
        if (result.error) {
          io.error.write(`MCP tool error: ${result.error}\n`);
        }
        for (const block of result.content) {
          io.output.write(`${block.text}\n`);
        }
        return result.error ? 1 : 0;
      } finally {
        client.disconnect();
      }
    }
    if (command === "cloud") {
      const [subCommand, ...subRest] = rest;
      if (subCommand === "list") {
        let registryUrl: string | undefined;
        for (let i = 0; i < subRest.length; i += 1) {
          if (subRest[i] === "--registry") {
            registryUrl = subRest[++i];
          }
        }
        const client = await connectClient(io.stateDir);
        try {
          const result = await client.listCloudMcp(registryUrl);
          if (result.servers.length === 0) {
            io.output.write("No MCP servers found in registry.\n");
          } else {
            io.output.write("ID\tNAME\tTRANSPORT\tURL/COMMAND\n");
            for (const server of result.servers) {
              const endpoint = server.url ?? (server.command ? `${server.command}${server.args ? ` ${server.args.join(" ")}` : ""}` : "");
              io.output.write(`${server.id}\t${server.name}\t${server.transport}\t${endpoint}\n`);
            }
          }
          return 0;
        } finally {
          client.disconnect();
        }
      }
      if (subCommand === "add") {
        const [catalogId, serverId] = subRest;
        if (!catalogId) {
          writeMcpUsage(io.error);
          return 1;
        }
        const client = await connectClient(io.stateDir);
        try {
          await client.addCloudMcp({ catalogId, ...(serverId ? { serverId } : {}) });
          io.output.write(`Added MCP server "${serverId ?? catalogId}" from cloud registry.\n`);
          return 0;
        } finally {
          client.disconnect();
        }
      }
      writeMcpUsage(io.error);
      return 1;
    }
    writeMcpUsage(io.error);
    return 1;
  } catch (cause) {
    io.error.write(`scorel mcp error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
};
