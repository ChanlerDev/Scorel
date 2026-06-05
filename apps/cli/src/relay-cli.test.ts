import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { readHostRelayAuth } from "@scorel/daemon";
import { asClientId, asRequestId, type RelayResponse } from "@scorel/protocol";
import { FileRelayStore, MemoryRelayDiagnostics, startRelayServer, type RelayServer } from "../../../apps/relay/src/index.js";

import { runCli } from "./index.js";

class StringWritable extends Writable {
  #chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.#chunks.push(chunk.toString());
    callback();
  }

  override toString(): string {
    return this.#chunks.join("");
  }
}

const servers: RelayServer[] = [];
const sockets: WebSocket[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.close();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("scorel pair CLI", () => {
  it("requires a pair code and relay URL", async () => {
    const missingCode = await runCliForTest(["pair"]);
    expect(missingCode.code).toBe(1);
    expect(missingCode.stderr).toContain("pair code is required");

    const missingRelay = await runCliForTest(["pair", "123456"]);
    expect(missingRelay.code).toBe(1);
    expect(missingRelay.stderr).toContain("--relay is required");
  });

  it("reports invalid Relay pair responses without mutating allowlist", async () => {
    const { relay, stateDir } = await relayCliFixture();

    const result = await runCliForTest(["pair", "000000", "--relay", relay.url], stateDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("pair_not_found");
    await expect(readHostRelayAuth(stateDir)).resolves.toEqual({ version: 1, clients: [] });
  });

  it("redeems pair sessions and stores the authorized client idempotently", async () => {
    const { relay, stateDir } = await relayCliFixture();
    const entry = await connect(relay.url);
    send(entry, { type: "entry_hello", clientId: asClientId("client_web") });
    const firstCode = await createPairCode(entry, "relay_pair_1");
    const secondCode = await createPairCode(entry, "relay_pair_2");

    const first = await runCliForTest(["pair", firstCode, "--relay", relay.url], stateDir);
    const second = await runCliForTest(["pair", secondCode, "--relay", relay.url], stateDir);

    expect(first).toMatchObject({ code: 0 });
    expect(first.stdout).toContain("authorized client=client_web");
    expect(second).toMatchObject({ code: 0 });
    const auth = await readHostRelayAuth(stateDir);
    expect(auth.clients).toEqual([{ clientId: "client_web", createdAt: expect.any(Number) }]);
  });
});

const relayCliFixture = async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-pair-"));
  tempDirs.push(stateDir);
  const relayDataDir = join(stateDir, "relay");
  const relay = await startRelayServer({
    host: "127.0.0.1",
    port: 0,
    store: new FileRelayStore({ dataDir: relayDataDir }),
    diagnostics: new MemoryRelayDiagnostics(),
  });
  servers.push(relay);
  return { stateDir, relay };
};

const runCliForTest = async (argv: string[], stateDir?: string): Promise<{ code: number; stdout: string; stderr: string }> => {
  const stdout = new StringWritable();
  const stderr = new StringWritable();
  const code = await runCli(
    argv,
    { input: process.stdin, output: stdout, error: stderr },
    { sessionsDir: stateDir ? join(stateDir, "sessions") : await mkdtemp(join(tmpdir(), "scorel-cli-pair-sessions-")) },
  );
  return { code, stdout: stdout.toString(), stderr: stderr.toString() };
};

const connect = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });

const send = (socket: WebSocket, value: unknown): void => {
  socket.send(JSON.stringify(value));
};

const createPairCode = async (entry: WebSocket, requestId: string): Promise<string> => {
  send(entry, { type: "create_pair_session", requestId: asRequestId(requestId) });
  const response = await nextRelayResponse(entry);
  if (!response.ok || !("pairCode" in response.data)) {
    throw new Error("expected pair code");
  }
  return response.data.pairCode;
};

const nextRelayResponse = (socket: WebSocket): Promise<RelayResponse> =>
  new Promise((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString()) as RelayResponse));
  });
