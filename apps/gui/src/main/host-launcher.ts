import { dirname, join } from "node:path";

export type GuiHostLauncher = {
  command: string;
  prefixArgs: string[];
  cwd: string;
};

export type ResolveHostLauncherOptions = {
  isPackaged: boolean;
  resourcesPath: string;
  appDistDir: string;
  env?: NodeJS.ProcessEnv;
};

export type HostServeInvocation = {
  command: string;
  args: string[];
  cwd: string;
};

export type BuildHostServeInvocationOptions = {
  launcher: GuiHostLauncher;
  bootstrapProject: string;
};

const repoRoot = (appDistDir: string): string => join(appDistDir, "..", "..", "..");

const nodeEntrypointArgs = (entrypoint: string): string[] =>
  entrypoint.endsWith(".ts") ? ["--import", "tsx", entrypoint] : [entrypoint];

export const resolveHostLauncher = (options: ResolveHostLauncherOptions): GuiHostLauncher => {
  if (options.isPackaged) {
    return {
      command: join(options.resourcesPath, "scorel"),
      prefixArgs: [],
      cwd: options.resourcesPath,
    };
  }

  const env = options.env ?? process.env;
  const entrypoint = env.SCOREL_CLI_ENTRYPOINT ?? join(repoRoot(options.appDistDir), "apps", "cli", "src", "index.ts");
  return {
    command: env.SCOREL_NODE_PATH ?? env.npm_node_execpath ?? "node",
    prefixArgs: nodeEntrypointArgs(entrypoint),
    cwd: dirname(entrypoint),
  };
};

export const buildHostServeInvocation = (options: BuildHostServeInvocationOptions): HostServeInvocation => ({
  command: options.launcher.command,
  args: [
    ...options.launcher.prefixArgs,
    "host",
    "serve",
    "--port",
    "0",
    "--cwd",
    options.bootstrapProject,
    "--lifetime",
    "attached",
    "--no-relay",
  ],
  cwd: options.launcher.cwd,
});
