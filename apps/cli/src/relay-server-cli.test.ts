import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { runCliRelay } from "./relay-server-cli.js";

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

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("scorel relay CLI", () => {
  it("serves a file-backed relay until stopped", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "scorel-relay-cli-"));
    tempDirs.push(dataDir);
    const out = new StringWritable();
    const err = new StringWritable();
    const abort = new AbortController();
    const serving = runCliRelay(["serve", "--port", "0", "--data-dir", dataDir], {
      output: out,
      error: err,
      serveSignal: abort.signal,
    });
    await waitForText(out, "scorel relay serving url=ws://127.0.0.1:");
    abort.abort();
    await expect(serving).resolves.toBe(0);
    expect(out.toString()).toContain("scorel relay serve stopped");
    expect(err.toString()).toBe("");
  });
});

const waitForText = (writable: { toString(): string }, text: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (writable.toString().includes(text)) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - startedAt > 5000) {
        clearInterval(interval);
        reject(new Error(`timed out waiting for ${text}`));
      }
    }, 5);
  });
