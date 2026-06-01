import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

let stateFilePath: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "scorel-webui-api-local-daemon-"));
  stateFilePath = join(dir, "daemon.json");
  originalEnv = process.env.SCOREL_DAEMON_STATE_FILE;
  process.env.SCOREL_DAEMON_STATE_FILE = stateFilePath;
});

afterEach(async () => {
  if (originalEnv === undefined) {
    delete process.env.SCOREL_DAEMON_STATE_FILE;
  } else {
    process.env.SCOREL_DAEMON_STATE_FILE = originalEnv;
  }
  await rm(stateFilePath, { force: true }).catch(() => undefined);
});

describe("/api/local-daemon", () => {
  it("returns 200 with the parsed daemon state when the file is valid", async () => {
    await writeFile(
      stateFilePath,
      JSON.stringify({
        host: "127.0.0.1",
        port: 7777,
        wsUrl: "ws://127.0.0.1:7777",
        token: "tk",
        pid: 42,
        startedAt: 1,
        stoppedAt: null,
      }),
    );
    const { GET } = await import("../app/api/local-daemon/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      wsUrl: "ws://127.0.0.1:7777",
      token: "tk",
      host: "127.0.0.1",
      port: 7777,
    });
  });

  it("returns 404 when the state file is missing", async () => {
    const { GET } = await import("../app/api/local-daemon/route");
    const response = await GET();
    expect(response.status).toBe(404);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
  });

  it("returns 404 when the state file is malformed JSON", async () => {
    await writeFile(stateFilePath, "{ this is not json", "utf8");
    const { GET } = await import("../app/api/local-daemon/route");
    const response = await GET();
    expect(response.status).toBe(404);
  });

  it("returns 404 when the state file is missing required fields", async () => {
    await writeFile(stateFilePath, JSON.stringify({ host: "127.0.0.1" }), "utf8");
    const { GET } = await import("../app/api/local-daemon/route");
    const response = await GET();
    expect(response.status).toBe(404);
  });
});
