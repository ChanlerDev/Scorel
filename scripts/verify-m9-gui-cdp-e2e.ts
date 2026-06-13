#!/usr/bin/env -S node --import tsx
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { WebSocket } from "ws";

const execFileAsync = promisify(execFile);
const root = resolve(new URL("..", import.meta.url).pathname);
const guiRoot = join(root, "apps/gui");
const requireFromGui = createRequire(join(guiRoot, "package.json"));

type Managed = {
  child?: ReturnType<typeof spawn>;
  tempRoot?: string;
  providerServer?: Server;
};

const managed: Managed = {};

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { message: string; data?: string };
};

type CdpPage = {
  type: string;
  title: string;
  webSocketDebuggerUrl?: string;
};

const main = async (): Promise<void> => {
  await execFileAsync("pnpm", ["--filter", "@scorel/app-gui", "build"], {
    cwd: root,
    maxBuffer: 20_000_000,
  });

  const tempRoot = await mkdtemp(join(tmpdir(), "scorel-m9-gui-cdp-"));
  managed.tempRoot = tempRoot;
  const home = join(tempRoot, "home");
  const repo = join(tempRoot, "repo");
  const provider = await startOpenAiToolServer();
  managed.providerServer = provider.server;
  await seedProject(home, repo, provider.baseUrl);

  const port = await freePort();
  const electron = String(requireFromGui("electron"));
  const child = spawn(electron, [`--remote-debugging-port=${port}`, guiRoot], {
    cwd: guiRoot,
    env: {
      ...process.env,
      HOME: home,
      SHELL: process.env.SHELL || userInfo().shell || "/bin/sh",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  managed.child = child;
  const stderr: string[] = [];
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  child.stdout?.on("data", () => undefined);

  const page = await waitForCdpPage(port, child, stderr);
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl!);
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await waitFor(cdp, "app shell", "Boolean(document.querySelector('.app-shell'))");
    await waitFor(cdp, "seeded local project", "document.body.innerText.includes('scorel-cdp-repo')");

    await clickButton(cdp, "设置");
    await waitFor(cdp, "settings shell", "Boolean(document.querySelector('.settings-shell'))");
    await clickButton(cdp, "Token 节省");
    await waitFor(cdp, "runtime settings section", "document.body.innerText.includes('启用 RTK')");

    const wasEnabled = await evaluateExpression<boolean>(cdp, "document.querySelector('[role=\"switch\"][aria-label=\"启用 RTK\"]')?.getAttribute('aria-checked') === 'true'");
    if (!wasEnabled) {
      await clickSwitch(cdp, "启用 RTK");
      await waitFor(cdp, "RTK toggle enabled", "document.querySelector('[role=\"switch\"][aria-label=\"启用 RTK\"]')?.getAttribute('aria-checked') === 'true'");
    }
    await waitForConfig(repo, "tokenSavingRtk = true");

    await clickButton(cdp, "返回应用");
    await waitFor(cdp, "composer", "Boolean(document.querySelector('textarea.composer__textarea'))");
    const prompt = "Use the Bash tool to run exactly: git status. Then reply with only the command output.";
    await fillComposer(cdp, prompt);
    await clickSend(cdp);
    await waitFor(cdp, "prompt rendered", "document.body.innerText.includes('git status')");

    const session = await waitForSession(home, prompt);
    const detectedRtk = await detectRtkExecutable(process.env.SHELL || userInfo().shell || "/bin/sh");
    if (!session.bashTool) {
      throw new Error("CDP GUI e2e did not persist a Bash tool result");
    }
    if (detectedRtk && !session.bashTool.rtkApplied) {
      throw new Error(`CDP GUI e2e found RTK at ${detectedRtk} but Bash did not apply RTK`);
    }
    console.log(JSON.stringify({
      ok: true,
      port,
      home,
      repo,
      projectConfig: join(repo, ".scorel", "config.toml"),
      sessionFile: session.file,
      promptPersisted: session.promptPersisted,
      assistantPersisted: session.assistantPersisted,
      detectedRtk,
      bashTool: session.bashTool,
    }, null, 2));
  } finally {
    cdp.close();
  }
};

const seedProject = async (home: string, repo: string, baseUrl: string): Promise<void> => {
  await mkdir(join(home, ".scorel", "gui"), { recursive: true });
  await mkdir(join(repo, ".scorel"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Scorel CDP GUI E2E\n", "utf8");
  await writeFile(join(repo, ".scorel", "config.toml"), `
[providers.chanleramp]
type = "custom"
api = "openai-completions"
provider = "chanleramp"
baseUrl = "${baseUrl}"
apiKey = "secret"

[provider_models.chanleramp_gpt_54_mini]
provider = "chanleramp"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"
contextWindow = 400000
maxTokens = 128000
reasoning = true
supportsDeveloperRole = true

[available_models.main]
model = "chanleramp_gpt_54_mini"
displayName = "GPT 5.4 Mini"

[model_profile.roles]
primary = "main"
standard = "main"
auxiliary = "main"
`, "utf8");
  const now = Date.now();
  const workDir = await realpath(repo);
  await writeFile(join(home, ".scorel", "gui", "projects.json"), `${JSON.stringify({
    version: 1,
    projects: [
      {
        projectId: `prj_${randomUUID()}`,
        displayName: "scorel-cdp-repo",
        workDir,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }, null, 2)}\n`, "utf8");
};

class Cdp {
  #id = 0;
  #pending = new Map<number, { resolve(value: unknown): void; reject(cause: Error): void }>();

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as CdpResponse;
      if (!message.id) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.data ?? message.error.message));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolveConnect, rejectConnect) => {
      const ws = new WebSocket(url);
      ws.once("open", () => resolveConnect(new Cdp(ws)));
      ws.once("error", rejectConnect);
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.#id;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolveSend, rejectSend) => {
      this.#pending.set(id, { resolve: resolveSend, reject: rejectSend });
      this.ws.send(payload, (cause) => {
        if (cause) {
          this.#pending.delete(id);
          rejectSend(cause);
        }
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

const evaluate = async <T>(cdp: Cdp, fn: () => T | Promise<T>): Promise<T> => {
  return evaluateExpression<T>(cdp, `(${fn.toString()})()`);
};

const evaluateExpression = async <T>(cdp: Cdp, expression: string): Promise<T> => {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }) as { result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return result.result?.value as T;
};

const waitFor = async (cdp: Cdp, label: string, expression: string, timeoutMs = 180_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluateExpression<boolean>(cdp, expression)) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const clickButton = async (cdp: Cdp, text: string): Promise<void> => {
  const clicked = await evaluateExpression<boolean>(cdp, `(() => {
    const target = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes(${JSON.stringify(text)}));
    target?.click();
    return Boolean(target);
  })()`);
  if (!clicked) throw new Error(`Button not found: ${text}`);
};

const clickSwitch = async (cdp: Cdp, label: string): Promise<void> => {
  const clicked = await evaluateExpression<boolean>(cdp, `(() => {
      const target = document.querySelector('[role="switch"][aria-label=${JSON.stringify(label)}]');
      target?.click();
      return Boolean(target);
    })()`);
  if (!clicked) throw new Error(`Switch not found: ${label}`);
};

const fillComposer = async (cdp: Cdp, text: string): Promise<void> => {
  const ok = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const textarea = document.querySelector('textarea.composer__textarea');
      if (!textarea) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, ${JSON.stringify(text)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }) as { result?: { value?: boolean } };
  if (!ok.result?.value) throw new Error("Composer textarea not found");
};

const clickSend = async (cdp: Cdp): Promise<void> => {
  const ok = await evaluate<boolean>(cdp, () => {
    const target = document.querySelector('button[aria-label="Send"]') as HTMLButtonElement | null;
    if (!target || target.disabled) return false;
    target.click();
    return true;
  });
  if (!ok) throw new Error("Send button was not clickable");
};

const waitForConfig = async (repo: string, text: string): Promise<void> => {
  const file = join(repo, ".scorel", "config.toml");
  await waitUntil(`config containing ${text}`, async () => (await readFile(file, "utf8")).includes(text));
};

const waitForSession = async (home: string, prompt: string): Promise<{
  file: string;
  promptPersisted: boolean;
  assistantPersisted: boolean;
  bashTool?: { shell?: unknown; command?: unknown; rtk?: unknown; rtkApplied: boolean };
}> => {
  const sessionsDir = join(home, ".scorel", "gui", "sessions");
  let latest = "";
  await waitUntil("session JSONL with assistant response", async () => {
    const files = await readdir(sessionsDir).catch(() => []);
    for (const name of files.filter((file) => file.endsWith(".jsonl"))) {
      const file = join(sessionsDir, name);
      const raw = await readFile(file, "utf8");
      if (raw.includes(prompt) && raw.includes("\"assistant_message\"")) {
        latest = file;
        return true;
      }
    }
    return false;
  }, 180_000);
  const raw = await readFile(latest, "utf8");
  const bashTool = raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown)
    .flatMap((event) => toolResults(event))
    .find((result) => result.toolName === "Bash");
  return {
    file: latest,
    promptPersisted: raw.includes(prompt),
    assistantPersisted: raw.includes("\"assistant_message\""),
    ...(bashTool ? {
      bashTool: {
        shell: bashTool.result.details?.shell,
        command: bashTool.result.details?.command,
        rtk: bashTool.result.details?.rtk,
        rtkApplied: isRecord(bashTool.result.details?.rtk) && bashTool.result.details.rtk.applied === true,
      },
    } : {}),
  };
};

const toolResults = (event: unknown): Array<{ toolName: string; result: { details?: { shell?: unknown; rtk?: unknown } } }> => {
  if (!isRecord(event) || !isRecord(event.message) || !Array.isArray(event.message.content)) return [];
  return event.message.content
    .filter((block): block is { type: "tool_result"; toolName: string; result: { details?: { shell?: unknown; rtk?: unknown } } } =>
      isRecord(block) &&
      block.type === "tool_result" &&
      typeof block.toolName === "string" &&
      isRecord(block.result),
    );
};

const waitForCdpPage = async (port: number, child: ReturnType<typeof spawn>, stderr: string[]): Promise<CdpPage> => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited before CDP was available:\n${stderr.join("")}`);
    }
    try {
      const pages = await fetchJson<CdpPage[]>(`http://127.0.0.1:${port}/json/list`);
      const page = pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // keep polling until Electron exposes DevTools
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for Electron CDP:\n${stderr.join("")}`);
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return await response.json() as T;
};

const freePort = async (): Promise<number> =>
  new Promise((resolvePort, rejectPort) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("Could not allocate a TCP port"));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });

const startOpenAiToolServer = async (): Promise<{ server: Server; baseUrl: string }> => {
  let requests = 0;
  const server = createHttpServer((request, response) => {
    request.resume();
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    requests += 1;
    if (requests === 1) {
      writeOpenAiSse(response, [
        {
          id: "chatcmpl-scorel-cdp",
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_bash",
                    type: "function",
                    function: {
                      name: "Bash",
                      arguments: "{\"command\":\"git status\",\"maxOutputBytes\":1000}",
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: "chatcmpl-scorel-cdp",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        },
      ]);
      return;
    }
    writeOpenAiSse(response, [
      {
        id: "chatcmpl-scorel-cdp",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { content: "clean" },
          },
        ],
      },
      {
        id: "chatcmpl-scorel-cdp",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
    ]);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start fake OpenAI provider");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

const writeOpenAiSse = (response: ServerResponse, chunks: unknown[]): void => {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.end("data: [DONE]\n\n");
};

const detectRtkExecutable = async (shell: string): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync(shell, [shellCommandFlag(shell), "command -v rtk"], { timeout: 5_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
};

const shellCommandFlag = (shell: string): "-c" | "-lc" => {
  const name = shell.split("/").pop()?.toLowerCase();
  return name === "csh" || name === "tcsh" || name === "fish" ? "-c" : "-lc";
};

const waitUntil = async (label: string, predicate: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (cause) {
      lastError = cause;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
};

const delay = (ms: number): Promise<void> => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cleanup = async (): Promise<void> => {
  if (managed.child && managed.child.exitCode === null) {
    managed.child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolveExit) => managed.child?.once("exit", () => resolveExit())),
      delay(5_000).then(() => {
        if (managed.child && managed.child.exitCode === null) managed.child.kill("SIGKILL");
      }),
    ]);
  }
  if (managed.tempRoot) {
    await rm(managed.tempRoot, { recursive: true, force: true });
  }
  if (managed.providerServer) {
    await new Promise<void>((resolveClose) => managed.providerServer?.close(() => resolveClose()));
  }
};

main()
  .catch((cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  })
  .finally(cleanup);
