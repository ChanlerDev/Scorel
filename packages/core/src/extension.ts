import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ScorelConfig } from "./settings.js";
import type { ScorelEvent, ScorelRuntimeHooks, ScorelTool, ScorelToolResult } from "./types.js";

export type ScorelSlashCommandContext = {
  args: string;
  raw: string;
  session?: unknown;
  config?: ScorelConfig;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  logger: ScorelExtensionLogger;
};

export type ScorelSlashCommand = {
  description?: string;
  run: (ctx: ScorelSlashCommandContext) => string | void | Promise<string | void>;
};

export type ScorelExtensionContext = {
  cwd: string;
  config?: ScorelConfig;
  logger: ScorelExtensionLogger;
};

export type ScorelExtension = {
  id: string;
  name?: string;
  version?: string;
  activate?: (ctx: ScorelExtensionContext) => void | Promise<void>;
  deactivate?: (ctx: ScorelExtensionContext) => void | Promise<void>;
  tools?: () => ScorelTool[];
  commands?: () => Record<string, ScorelSlashCommand>;
  onEvent?: (event: ScorelEvent, ctx: ScorelExtensionContext) => void | Promise<void>;
  hooks?: () => Partial<Pick<ScorelRuntimeHooks, "beforeToolCall" | "afterToolCall" | "buildContext" | "convertToLlm">>;
};

export type ScorelExtensionErrorPhase =
  | "load"
  | "activate"
  | "deactivate"
  | "tools"
  | "commands"
  | "onEvent"
  | `hook:${keyof ScorelRuntimeHooks}`;

export type ScorelExtensionError = {
  extensionId?: string;
  path?: string;
  phase: ScorelExtensionErrorPhase;
  error: string;
};

export type ScorelExtensionLogger = {
  error: (message: string, error?: unknown) => void;
  warn?: (message: string) => void;
  info?: (message: string) => void;
};

export type LoadScorelExtensionsOptions = {
  cwd?: string;
  globalDir?: string;
  projectDir?: string;
  config?: ScorelConfig;
  logger?: ScorelExtensionLogger;
};

export class ScorelExtensionRegistry {
  readonly extensions: ScorelExtension[];
  readonly errors: ScorelExtensionError[] = [];
  private readonly context: ScorelExtensionContext;

  constructor(extensions: ScorelExtension[], context: ScorelExtensionContext, errors: ScorelExtensionError[] = []) {
    this.extensions = extensions;
    this.context = context;
    this.errors.push(...errors);
  }

  async activate(): Promise<void> {
    for (const extension of this.extensions) {
      await this.callExtension(extension, "activate", () => extension.activate?.(this.context));
    }
  }

  async deactivate(): Promise<void> {
    for (const extension of [...this.extensions].reverse()) {
      await this.callExtension(extension, "deactivate", () => extension.deactivate?.(this.context));
    }
  }

  collectTools(): ScorelTool[] {
    const tools: ScorelTool[] = [];
    for (const extension of this.extensions) {
      try {
        tools.push(...(extension.tools?.() ?? []));
      } catch (error) {
        this.recordError({ extensionId: extension.id, phase: "tools", error });
      }
    }
    return tools;
  }

  collectCommands(): Record<string, ScorelSlashCommand> {
    const commands: Record<string, ScorelSlashCommand> = {};
    for (const extension of this.extensions) {
      try {
        Object.assign(commands, extension.commands?.() ?? {});
      } catch (error) {
        this.recordError({ extensionId: extension.id, phase: "commands", error });
      }
    }
    return commands;
  }

  async emit(event: ScorelEvent, context: Partial<ScorelExtensionContext> = {}): Promise<void> {
    const eventContext = { ...this.context, ...context };
    await Promise.allSettled(
      this.extensions.map(async (extension) => {
        try {
          await extension.onEvent?.(event, eventContext);
        } catch (error) {
          this.recordError({ extensionId: extension.id, phase: "onEvent", error });
        }
      })
    );
  }

  wrapRuntimeHooks(baseHooks: ScorelRuntimeHooks = {}): ScorelRuntimeHooks {
    const extensionHooks = this.collectHooks();
    return {
      ...baseHooks,
      convertToLlm: async (messages) => {
        let current = baseHooks.convertToLlm ? await baseHooks.convertToLlm(messages) : undefined;
        for (const entry of extensionHooks) {
          if (!entry.hooks.convertToLlm) {
            continue;
          }
          try {
            current = await entry.hooks.convertToLlm(current ?? messages);
          } catch (error) {
            this.recordError({ extensionId: entry.extension.id, phase: "hook:convertToLlm", error });
          }
        }
        return current ?? messages.filter((message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult");
      },
      buildContext: async (ctx) => {
        let current = baseHooks.buildContext ? await baseHooks.buildContext(ctx) : ctx.context;
        for (const entry of extensionHooks) {
          if (!entry.hooks.buildContext) {
            continue;
          }
          try {
            current = await entry.hooks.buildContext({ ...ctx, context: current });
          } catch (error) {
            this.recordError({ extensionId: entry.extension.id, phase: "hook:buildContext", error });
          }
        }
        return current;
      },
      beforeToolCall: async (ctx) => {
        let currentArgs = (await baseHooks.beforeToolCall?.(ctx))?.args ?? ctx.args;
        for (const entry of extensionHooks) {
          if (!entry.hooks.beforeToolCall) {
            continue;
          }
          try {
            currentArgs = (await entry.hooks.beforeToolCall({ ...ctx, args: currentArgs }))?.args ?? currentArgs;
          } catch (error) {
            this.recordError({ extensionId: entry.extension.id, phase: "hook:beforeToolCall", error });
          }
        }
        return { args: currentArgs };
      },
      afterToolCall: async (ctx) => {
        let currentResult: ScorelToolResult = (await baseHooks.afterToolCall?.(ctx)) ?? ctx.result;
        for (const entry of extensionHooks) {
          if (!entry.hooks.afterToolCall) {
            continue;
          }
          try {
            currentResult = (await entry.hooks.afterToolCall({ ...ctx, result: currentResult })) ?? currentResult;
          } catch (error) {
            this.recordError({ extensionId: entry.extension.id, phase: "hook:afterToolCall", error });
          }
        }
        return currentResult;
      }
    };
  }

  private collectHooks(): Array<{ extension: ScorelExtension; hooks: Partial<ScorelRuntimeHooks> }> {
    const result: Array<{ extension: ScorelExtension; hooks: Partial<ScorelRuntimeHooks> }> = [];
    for (const extension of this.extensions) {
      try {
        result.push({ extension, hooks: extension.hooks?.() ?? {} });
      } catch (error) {
        this.recordError({ extensionId: extension.id, phase: "hook:buildContext", error });
      }
    }
    return result;
  }

  private async callExtension(extension: ScorelExtension, phase: "activate" | "deactivate", fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.recordError({ extensionId: extension.id, phase, error });
    }
  }

  private recordError(input: { extensionId?: string; path?: string; phase: ScorelExtensionErrorPhase; error: unknown }): void {
    const entry = {
      extensionId: input.extensionId,
      path: input.path,
      phase: input.phase,
      error: stringifyError(input.error)
    };
    this.errors.push(entry);
    this.context.logger.error(formatExtensionError(entry), input.error);
  }
}

export async function loadScorelExtensions(options: LoadScorelExtensionsOptions = {}): Promise<ScorelExtensionRegistry> {
  const cwd = options.cwd ?? process.cwd();
  const context: ScorelExtensionContext = {
    cwd,
    config: options.config,
    logger: options.logger ?? console
  };
  const errors: ScorelExtensionError[] = [];
  const loaded = new Map<string, ScorelExtension>();
  for (const dir of [options.globalDir ?? defaultGlobalExtensionsDir(), options.projectDir ?? defaultProjectExtensionsDir(cwd)]) {
    for (const path of await listExtensionFiles(dir)) {
      try {
        const extension = normalizeExtension(await import(pathToFileURL(path).href));
        loaded.set(extension.id, extension);
      } catch (error) {
        const entry = { path, phase: "load" as const, error: stringifyError(error) };
        errors.push(entry);
        context.logger.error(formatExtensionError(entry), error);
      }
    }
  }

  const registry = new ScorelExtensionRegistry([...loaded.values()], context, errors);
  await registry.activate();
  return registry;
}

export function defaultGlobalExtensionsDir(): string {
  return join(homedir(), ".scorel", "extensions");
}

export function defaultProjectExtensionsDir(cwd = process.cwd()): string {
  return join(cwd, ".scorel", "extensions");
}

function normalizeExtension(module: unknown): ScorelExtension {
  const value = module && typeof module === "object" && "default" in module
    ? (module as { default: unknown }).default
    : module;
  if (!value || typeof value !== "object") {
    throw new Error("Extension module must export an object");
  }
  const extension = value as Partial<ScorelExtension>;
  if (!extension.id || typeof extension.id !== "string") {
    throw new Error("Extension must declare string id");
  }
  return extension as ScorelExtension;
}

async function listExtensionFiles(dir: string): Promise<string[]> {
  try {
    await access(dir, constants.F_OK);
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(?:mjs|js|cjs|ts)$/.test(entry.name))
      .map((entry) => resolve(dir, entry.name))
      .sort();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatExtensionError(error: ScorelExtensionError): string {
  const owner = error.extensionId ?? error.path ?? "unknown";
  return `[extension:error] ${owner} ${error.phase}: ${error.error}`;
}
