import { homedir } from "node:os";
import { join } from "node:path";

import { loadOrCreateHostDeviceIdentity, redeemRelayPair } from "@scorel/daemon";

export const DEFAULT_SCOREL_RELAY_URL = "wss://scorel-relay.channel.dev";
export const DEFAULT_SCOREL_WEBUI_URL = "https://scorel.channel.dev";

export type PairCommandOptions = {
  stateDir?: string;
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
};

const defaultStateDir = (): string => join(homedir(), ".scorel");

export const runCliPair = async (
  argv: string[],
  options: PairCommandOptions,
): Promise<number> => {
  let flags: { pairCode: string; relayUrl: string };
  try {
    flags = parsePairFlags(argv, options.env ?? process.env);
  } catch (cause) {
    options.error.write(`scorel pair error: ${(cause as Error).message}\n`);
    writePairUsage(options.error);
    return 1;
  }
  const stateDir = options.stateDir ?? defaultStateDir();
  const identity = await loadOrCreateHostDeviceIdentity({ stateDir });
  try {
    const result = await redeemRelayPair({
      relayUrl: flags.relayUrl,
      pairCode: flags.pairCode,
      deviceId: identity.deviceId,
      label: identity.displayName,
      stateDir,
    });
    options.output.write(`scorel pair authorized client=${result.clientId} device=${identity.deviceId}\n`);
    return 0;
  } catch (cause) {
    options.error.write(`scorel pair error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
};

export const resolveDefaultRelayUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  env.SCOREL_RELAY_URL?.trim() || DEFAULT_SCOREL_RELAY_URL;

const parsePairFlags = (argv: string[], env: NodeJS.ProcessEnv): { pairCode: string; relayUrl: string } => {
  const pairCode = argv[0];
  if (!pairCode || pairCode.startsWith("-")) {
    throw new Error("pair code is required");
  }
  let relayUrl = resolveDefaultRelayUrl(env);
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--relay") {
      relayUrl = requireValue(argv, index, "--relay");
      index += 1;
      continue;
    }
    throw new Error(`Unknown pair option: ${arg}`);
  }
  return { pairCode, relayUrl };
};

const requireValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const writePairUsage = (output: NodeJS.WritableStream): void => {
  output.write("Usage: scorel pair <pair-code> [--relay <relay-url>]\n");
};
