#!/usr/bin/env -S node --import tsx
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createServer } from "node:net";

import { DaemonClient, RelayTransport } from "../packages/client/src/index.js";
import { asClientId, asDeviceId, asRequestId, asSeq, type RelayResponse, type RelayServerFrame } from "../packages/protocol/src/index.js";

type ManagedProcess = {
  name: string;
  child: ChildProcess;
  logs: string[];
};

type RelayDevice = {
  deviceId: string;
  label?: string;
  online?: boolean;
};

const rootDir = new URL("..", import.meta.url).pathname;
const runNonce = Date.now().toString(36);
const promptSecret = `s0060_prompt_${runNonce}`;
const entryClientId = asClientId(`client_webui_${runNonce}`);
const apiKeyEnv = process.env.SCOREL_API_KEY ? "SCOREL_API_KEY" : process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : "";

if (!apiKeyEnv) {
  throw new Error("S0060 requires SCOREL_API_KEY or OPENAI_API_KEY for a real provider run");
}

const processes: ManagedProcess[] = [];
let tempRoot: string | undefined;

const main = async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "scorel-m8-relay-"));
  tempRoot = root;
  const homeDir = join(root, "home");
  const relayDataDir = join(root, "relay");
  const projectDir = join(root, "project");
  await mkdir(join(projectDir, ".scorel"), { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await writeFile(join(projectDir, "README.md"), `# S0060 Relay E2E\n\nrun=${runNonce}\n`);
  await writeFile(join(projectDir, ".scorel", "config.toml"), `[model]
type = "builtin"
provider = "openai"
id = "gpt-4o-mini"
apiKeyEnv = "${apiKeyEnv}"
`);

  const relayPort = await freePort();
  const webuiPort = await freePort();
  const relayUrl = `ws://127.0.0.1:${relayPort}`;
  const webuiUrl = `http://127.0.0.1:${webuiPort}`;

  const relay = spawnManaged("relay", ["pnpm", "--filter", "@scorel/relay", "start"], {
    SCOREL_RELAY_HOST: "127.0.0.1",
    SCOREL_RELAY_PORT: String(relayPort),
    SCOREL_RELAY_DATA_DIR: relayDataDir,
  });
  await waitForLog(relay, "scorel relay listening on", 20_000);

  const daemon = spawnManaged("daemon", ["pnpm", "scorel", "daemon", "serve", "--port", "0", "--cwd", projectDir, "--relay", relayUrl], {
    HOME: homeDir,
  });
  await waitForLog(daemon, "scorel daemon serving url=ws://127.0.0.1:", 20_000);
  await waitForLog(daemon, "scorel daemon relay connected", 20_000);

  const webui = spawnManaged("webui", ["pnpm", "--filter", "@scorel/app-webui", "exec", "next", "dev", "-H", "127.0.0.1", "-p", String(webuiPort)], {
    HOME: homeDir,
  });
  await waitForHttp(`${webuiUrl}/settings`, 60_000, webui);

  const pairCode = await createPairSession(relayUrl);
  const pair = await runCommand("pair", ["pnpm", "scorel", "pair", pairCode, "--relay", relayUrl], { HOME: homeDir });
  if (pair.code !== 0) {
    throw new Error(`scorel pair failed: ${pair.stderr || pair.stdout}`);
  }

  const devices = await listAuthorizedDevices(relayUrl);
  const device = devices[0];
  if (!device) {
    throw new Error("Relay did not return an authorized device after pairing");
  }
  if (device.online !== true) {
    throw new Error(`Relay device is not online: ${JSON.stringify(device)}`);
  }

  const deviceId = asDeviceId(device.deviceId);
  const client = new DaemonClient(new RelayTransport({ relayUrl, deviceId, clientId: entryClientId }), {
    clientId: entryClientId,
  });
  await client.connect();
  const projects = await client.listProjects();
  const project = projects.find((candidate) => candidate.workDir === projectDir) ?? projects[0];
  if (!project) {
    throw new Error("Host returned no projects through Relay");
  }
  const sessionId = await client.createSession({
    meta: {
      projectId: project.projectId,
      title: "S0060 Relay E2E",
      model: "gpt-4o-mini",
    },
  });
  await client.loadSession(sessionId);
  const prompt = `S0060 relay e2e probe ${promptSecret}. Reply with a short sentence containing ${promptSecret}.`;
  const response = await client.sendMessage(prompt);
  if (response.status !== "completed" || !response.userEventId || !response.assistantEventId) {
    throw new Error(`send_message did not complete: ${JSON.stringify(response)}`);
  }
  const liveEvents = client.getEvents();
  if (!liveEvents.some((event) => event.type === "assistant_message")) {
    throw new Error("No assistant_message event received through Relay");
  }
  client.disconnect();

  const refreshed = new DaemonClient(new RelayTransport({ relayUrl, deviceId, clientId: entryClientId }), {
    clientId: entryClientId,
  });
  await refreshed.connect(sessionId);
  const resync = await refreshed.resync({ persistentLastSeq: asSeq(0), streamLastSeq: asSeq(0) });
  if (!resync.events.some((event) => event.type === "user_message") || !resync.events.some((event) => event.type === "assistant_message")) {
    throw new Error(`Relay resync did not return the persisted turn: ${JSON.stringify(resync)}`);
  }
  refreshed.disconnect();

  const hostFiles = await readTextFiles(join(homeDir, ".scorel"));
  const relayFiles = await readTextFiles(relayDataDir);
  const sessionJsonl = hostFiles.find((file) => file.path.endsWith(".jsonl") && file.text.includes(promptSecret));
  if (!sessionJsonl) {
    throw new Error("Host-owned session JSONL containing the real prompt was not found");
  }
  if (!sessionJsonl.text.includes(`"clientId":"${entryClientId}"`) && !sessionJsonl.text.includes(`"clientId": "${entryClientId}"`)) {
    throw new Error("Host-owned session JSONL does not preserve the WebUI Entry clientId");
  }
  const relayText = `${relayFiles.map((file) => file.text).join("\n")}\n${relay.logs.join("\n")}`;
  for (const forbidden of [promptSecret, "relay e2e probe", "Reply with a short sentence"]) {
    if (relayText.includes(forbidden)) {
      throw new Error(`Relay storage/logs leaked prompt content: ${forbidden}`);
    }
  }
  const relayStore = relayFiles.find((file) => file.path.endsWith("relay-store.json"));
  if (!relayStore?.text.includes(String(device.deviceId)) || !relayStore.text.includes(String(entryClientId))) {
    throw new Error("Relay durable store does not contain the expected device/client binding");
  }

  relay.child.kill("SIGTERM");
  await waitForExit(relay, 10_000);
  const restartedRelay = spawnManaged("relay-restart", ["pnpm", "--filter", "@scorel/relay", "start"], {
    SCOREL_RELAY_HOST: "127.0.0.1",
    SCOREL_RELAY_PORT: String(relayPort),
    SCOREL_RELAY_DATA_DIR: relayDataDir,
  });
  await waitForLog(restartedRelay, "scorel relay listening on", 20_000);
  const restartedStore = await readFile(join(relayDataDir, "relay-store.json"), "utf8");
  if (!restartedStore.includes(String(device.deviceId)) || !restartedStore.includes(String(entryClientId))) {
    throw new Error("Relay binding did not survive Relay restart");
  }

  console.log(JSON.stringify({
    ok: true,
    relayUrl,
    webuiUrl,
    deviceId: device.deviceId,
    entryClientId,
    projectId: project.projectId,
    sessionId,
    hostSessionFile: relative(rootDir, sessionJsonl.path),
    relayStoreFile: relative(rootDir, join(relayDataDir, "relay-store.json")),
  }, null, 2));

  tempRoot = undefined;
  await rm(root, { recursive: true, force: true });
};

const spawnManaged = (name: string, command: string[], env: Record<string, string>): ManagedProcess => {
  const [bin, ...args] = command;
  if (!bin) {
    throw new Error("empty command");
  }
  const child = spawn(bin, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const managed: ManagedProcess = { name, child, logs: [] };
  const collect = (chunk: Buffer): void => {
    managed.logs.push(chunk.toString("utf8"));
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  processes.push(managed);
  return managed;
};

const runCommand = (name: string, command: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const [bin, ...args] = command;
    if (!bin) {
      throw new Error("empty command");
    }
    const child = spawn(bin, args, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (cause) => resolve({ code: 1, stdout, stderr: `${name}: ${cause instanceof Error ? cause.message : String(cause)}` }));
  });

const waitForLog = async (process: ManagedProcess, needle: string, timeoutMs: number): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (process.logs.join("").includes(needle)) {
      return;
    }
    if (process.child.exitCode !== null) {
      throw new Error(`${process.name} exited before "${needle}": ${process.logs.join("")}`);
    }
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${process.name} log "${needle}": ${process.logs.join("")}`);
};

const waitForHttp = async (url: string, timeoutMs: number, process?: ManagedProcess): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.text();
        return;
      }
    } catch {
      // keep polling
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${url}${process ? `: ${process.logs.join("")}` : ""}`);
};

const createPairSession = async (relayUrl: string): Promise<string> => {
  const socket = await openSocket(relayUrl);
  try {
    socket.send(JSON.stringify({ type: "entry_hello", clientId: entryClientId }));
    socket.send(JSON.stringify({ type: "create_pair_session", requestId: asRequestId("s0060_pair") }));
    const response = await nextRelayResponse(socket);
    if (!response.ok || !("pairCode" in response.data)) {
      throw new Error(`create_pair_session failed: ${JSON.stringify(response)}`);
    }
    return response.data.pairCode;
  } finally {
    socket.close();
  }
};

const listAuthorizedDevices = async (relayUrl: string): Promise<RelayDevice[]> => {
  const socket = await openSocket(relayUrl);
  try {
    socket.send(JSON.stringify({ type: "entry_hello", clientId: entryClientId }));
    socket.send(JSON.stringify({ type: "list_authorized_devices", requestId: asRequestId("s0060_list") }));
    const response = await nextRelayResponse(socket);
    if (!response.ok || !("devices" in response.data)) {
      throw new Error(`list_authorized_devices failed: ${JSON.stringify(response)}`);
    }
    return response.data.devices as RelayDevice[];
  } finally {
    socket.close();
  }
};

const openSocket = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`WebSocket failed: ${url}`)), { once: true });
  });

const nextRelayResponse = (socket: WebSocket): Promise<RelayResponse> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for Relay response")), 10_000);
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as RelayServerFrame;
      if (frame.type === "relay_response" || frame.type === "relay_error") {
        clearTimeout(timer);
        resolve(frame);
      }
    });
  });

const readTextFiles = async (root: string): Promise<Array<{ path: string; text: string }>> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const result: Array<{ path: string; text: string }> = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...await readTextFiles(path));
    } else if (entry.isFile()) {
      result.push({ path, text: await readFile(path, "utf8").catch(() => "") });
    }
  }
  return result;
};

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not allocate a free port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });

const waitForExit = (process: ManagedProcess, timeoutMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    if (process.child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error(`${process.name} did not exit`)), timeoutMs);
    process.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

try {
  await main();
} finally {
  for (const process of [...processes].reverse()) {
    if (process.child.exitCode === null) {
      process.child.kill("SIGTERM");
    }
  }
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
