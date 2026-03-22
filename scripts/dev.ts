import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";

const DEV_HOST = "127.0.0.1";
const DEV_PORT = 5173;
const DEV_SERVER_URL = `http://${DEV_HOST}:${DEV_PORT}`;
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function startProcess(command: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcess {
  return spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

function waitForDevServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for Vite dev server at ${url}`));
          return;
        }

        setTimeout(tryConnect, 300);
      });
    };

    tryConnect();
  });
}

async function main(): Promise<void> {
  const vite = startProcess(PNPM, ["exec", "vite", "--host", DEV_HOST, "--port", String(DEV_PORT)]);
  let electron: ChildProcess | null = null;

  const shutdown = () => {
    if (!vite.killed) {
      vite.kill("SIGTERM");
    }
    if (electron && !electron.killed) {
      electron.kill("SIGTERM");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  vite.on("exit", (code) => {
    if (electron && !electron.killed) {
      electron.kill("SIGTERM");
    }
    if (code != null && code !== 0) {
      process.exitCode = code;
    }
  });

  await waitForDevServer(DEV_SERVER_URL, 30_000);

  electron = startProcess(PNPM, ["exec", "electron", "."], {
    VITE_DEV_SERVER_URL: DEV_SERVER_URL,
  });

  electron.on("exit", (code) => {
    if (!vite.killed) {
      vite.kill("SIGTERM");
    }
    process.exit(code ?? 0);
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
