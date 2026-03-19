import * as fs from "node:fs";
import * as path from "node:path";
import type { ScorelEvent } from "../../shared/events.js";
import { EVENTLOG_VERSION } from "../../shared/constants.js";

type EventLogLine = {
  v: string;
  seq: number;
  event: ScorelEvent;
};

/**
 * Append-only JSONL writer for session events.
 *
 * Each line: {"v":"scorel.eventlog.v0","seq":123,"event":{...}}
 *
 * Best-effort: write errors are logged to stderr but never thrown,
 * so they don't block the main orchestration flow.
 */
export class EventLog {
  private fd: number | null = null;
  private readonly filePath: string;

  constructor(logDir: string, sessionId: string) {
    fs.mkdirSync(logDir, { recursive: true });
    this.filePath = path.join(logDir, `${sessionId}.jsonl`);
    try {
      this.fd = fs.openSync(this.filePath, "a");
    } catch (err: unknown) {
      console.error(
        `[EventLog] Failed to open ${this.filePath}:`,
        err,
      );
    }
  }

  append(seq: number, event: ScorelEvent): void {
    if (this.fd == null) return;
    const line: EventLogLine = {
      v: EVENTLOG_VERSION,
      seq,
      event,
    };
    try {
      fs.writeSync(this.fd, JSON.stringify(line) + "\n");
    } catch (err: unknown) {
      console.error(
        `[EventLog] Failed to append seq=${seq}:`,
        err,
      );
    }
  }

  close(): void {
    if (this.fd == null) return;
    try {
      fs.closeSync(this.fd);
    } catch (err: unknown) {
      console.error("[EventLog] Failed to close fd:", err);
    }
    this.fd = null;
  }
}
