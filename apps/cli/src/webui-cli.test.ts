import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { runCliWebUi } from "./webui-cli.js";

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

const fakeChild = (): EventEmitter & { stdout: null; stderr: null } => {
  const emitter = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
  emitter.stdout = null;
  emitter.stderr = null;
  return emitter;
};

describe("scorel webui CLI", () => {
  it("spawns next dev with the configured port + host when node_modules exists", async () => {
    const webuiAppDir = await mkdtemp(join(tmpdir(), "scorel-webui-cli-"));
    await mkdir(join(webuiAppDir, "node_modules", "next", "dist", "bin"), { recursive: true });
    const nextBin = join(webuiAppDir, "node_modules", "next", "dist", "bin", "next");
    await writeFile(nextBin, "#!/usr/bin/env node\n", "utf8");

    let captured:
      | { command: string; argv: string[]; opts: { cwd?: string; env?: NodeJS.ProcessEnv } }
      | undefined;
    const child = fakeChild();
    const code = runCliWebUi(["--port", "4000", "--host", "0.0.0.0"], {
      output: new StringWritable(),
      error: new StringWritable(),
      webuiAppDir,
      spawn: (command, argv, opts) => {
        captured = { command, argv, opts: opts as { cwd?: string; env?: NodeJS.ProcessEnv } };
        return child as unknown as ReturnType<typeof require>["spawn"]; // shape-compatible for our test
      },
    });
    // Resolve the promise after asserting via emitting exit.
    await Promise.resolve();
    child.emit("exit", 0);
    await expect(code).resolves.toBe(0);

    expect(captured).toBeDefined();
    expect(captured!.command).toBe(process.execPath);
    expect(captured!.argv).toEqual([nextBin, "dev", "-p", "4000", "-H", "0.0.0.0"]);
    expect(captured!.opts.cwd).toBe(webuiAppDir);
    expect(captured!.opts.env?.PORT).toBe("4000");
    expect(captured!.opts.env?.HOST).toBe("0.0.0.0");
  });

  it("falls back to pnpm when next is not yet hydrated", async () => {
    const webuiAppDir = await mkdtemp(join(tmpdir(), "scorel-webui-cli-fallback-"));
    let captured:
      | { command: string; argv: string[]; opts: { cwd?: string } }
      | undefined;
    const child = fakeChild();
    const code = runCliWebUi([], {
      output: new StringWritable(),
      error: new StringWritable(),
      webuiAppDir,
      spawn: (command, argv, opts) => {
        captured = { command, argv, opts: opts as { cwd?: string } };
        return child as unknown as ReturnType<typeof require>["spawn"];
      },
    });
    await Promise.resolve();
    child.emit("exit", 0);
    await expect(code).resolves.toBe(0);

    expect(captured!.command).toBe("pnpm");
    expect(captured!.argv).toEqual(["--filter", "@scorel/app-webui", "dev"]);
    expect(captured!.opts.cwd).toBe(webuiAppDir);
  });

  it("rejects unknown flags up-front", async () => {
    const err = new StringWritable();
    const code = await runCliWebUi(["--bogus"], {
      output: new StringWritable(),
      error: err,
      webuiAppDir: "/tmp/nope",
      spawn: () => {
        throw new Error("should not spawn");
      },
    });
    expect(code).toBe(1);
    expect(err.toString()).toContain("Unknown webui option");
  });
});
