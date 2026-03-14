import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { logger } from "./logger.js";
import type { Orchestrator } from "./orchestrator.js";

export class HttpStatusServer {
  private server: http.Server | undefined;
  private boundPort: number | undefined;

  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly port: number
  ) {}

  async start(): Promise<number> {
    if (this.server) {
      return this.boundPort ?? this.port;
    }

    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, "127.0.0.1", () => {
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to determine bound HTTP address");
    }

    this.boundPort = address.port;
    logger.info("http_server_started action=listen", { port: this.boundPort, host: "127.0.0.1" });
    return this.boundPort;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.server = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";

    if (method === "GET" && url.pathname === "/api/v1/state") {
      return this.json(res, 200, this.orchestrator.snapshot());
    }

    if (method === "POST" && url.pathname === "/api/v1/refresh") {
      this.orchestrator.refreshNow();
      return this.json(res, 202, {
        queued: true,
        coalesced: false,
        requested_at: new Date().toISOString(),
        operations: ["poll", "reconcile"]
      });
    }

    if (method === "GET" && url.pathname.startsWith("/api/v1/")) {
      const identifier = decodeURIComponent(url.pathname.slice("/api/v1/".length));
      const snapshot = this.orchestrator.snapshot() as {
        running?: Array<Record<string, unknown>>;
        retrying?: Array<Record<string, unknown>>;
      };

      const running = snapshot.running?.find(
        (entry) => entry.issue_identifier === identifier
      );
      const retry = snapshot.retrying?.find(
        (entry) => entry.issue_identifier === identifier
      );

      if (!running && !retry) {
        return this.json(res, 404, {
          error: {
            code: "issue_not_found",
            message: `No in-memory state for issue ${identifier}`
          }
        });
      }

      return this.json(res, 200, {
        issue_identifier: identifier,
        status: running ? "running" : "retrying",
        running: running ?? null,
        retry: retry ?? null
      });
    }

    if (method === "GET" && url.pathname === "/") {
      const snapshot = this.orchestrator.snapshot() as Record<string, unknown>;
      const body = renderDashboard(snapshot);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
      return;
    }

    if (["GET", "POST"].includes(method)) {
      return this.json(res, 404, {
        error: {
          code: "not_found",
          message: `No route for ${method} ${url.pathname}`
        }
      });
    }

    return this.json(res, 405, {
      error: {
        code: "method_not_allowed",
        message: `${method} is not allowed for ${url.pathname}`
      }
    });
  }

  private json(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload, null, 2));
  }
}

function renderDashboard(snapshot: Record<string, unknown>): string {
  const pretty = JSON.stringify(snapshot, null, 2);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scorel Symphony</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: "IBM Plex Sans", "Helvetica Neue", sans-serif; background: linear-gradient(180deg, #f6f3ea, #fff); color: #1f1a17; }
      main { max-width: 960px; margin: 0 auto; padding: 32px 20px 48px; }
      h1 { margin: 0 0 8px; font-size: 32px; }
      p { color: #5b5149; }
      pre { background: #171411; color: #f7f0e8; padding: 16px; border-radius: 14px; overflow: auto; }
      .bar { display: flex; gap: 12px; margin: 24px 0; }
      .card { flex: 1; background: rgba(255,255,255,0.78); border: 1px solid #e7d8c8; padding: 16px; border-radius: 16px; box-shadow: 0 12px 30px rgba(58, 38, 16, 0.08); }
      .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a745f; }
      .value { font-size: 28px; margin-top: 8px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Scorel Symphony</h1>
      <p>Operational snapshot for the current orchestrator process.</p>
      <div class="bar">
        <div class="card">
          <div class="label">Running</div>
          <div class="value">${readCount(snapshot, "counts", "running")}</div>
        </div>
        <div class="card">
          <div class="label">Retrying</div>
          <div class="value">${readCount(snapshot, "counts", "retrying")}</div>
        </div>
      </div>
      <pre>${escapeHtml(pretty)}</pre>
    </main>
  </body>
</html>`;
}

function readCount(snapshot: Record<string, unknown>, parentKey: string, childKey: string): number {
  const parent = snapshot[parentKey];
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
    return 0;
  }
  const value = (parent as Record<string, unknown>)[childKey];
  return typeof value === "number" ? value : 0;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
