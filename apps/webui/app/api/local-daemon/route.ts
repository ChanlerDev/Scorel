import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Read `~/.scorel/daemon.json` server-side and surface the connection info
 * to the WebUI Settings page. Only useful when WebUI runs on the same host
 * as the daemon; on other hosts the file does not exist and we 404.
 *
 * Token leak boundary: the route runs server-side, so the file contents
 * never enter the client JS bundle. Same-origin browser tabs that hit this
 * endpoint already have local filesystem access to read the same file via
 * any other channel — the response carries no privilege escalation.
 */
export async function GET(): Promise<Response> {
  const filePath = process.env.SCOREL_DAEMON_STATE_FILE ?? join(homedir(), ".scorel", "daemon.json");
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return NextResponse.json({ ok: false, reason: "missing" }, { status: 404 });
    }
    console.warn(`/api/local-daemon: failed to read ${filePath}: ${(cause as Error).message}`);
    return NextResponse.json({ ok: false, reason: "unreadable" }, { status: 404 });
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    console.warn(`/api/local-daemon: malformed JSON at ${filePath}: ${(cause as Error).message}`);
    return NextResponse.json({ ok: false, reason: "malformed" }, { status: 404 });
  }
  const wsUrl = typeof parsed.wsUrl === "string" ? parsed.wsUrl : undefined;
  const token = typeof parsed.token === "string" ? parsed.token : undefined;
  const host = typeof parsed.host === "string" ? parsed.host : undefined;
  const port = typeof parsed.port === "number" ? parsed.port : undefined;
  if (!wsUrl || !token || !host || port === undefined) {
    console.warn(`/api/local-daemon: invalid shape at ${filePath}`);
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    wsUrl,
    token,
    host,
    port,
  });
}
