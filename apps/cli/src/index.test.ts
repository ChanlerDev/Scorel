import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { cliAppName, cliClientDependency, cliDaemonDependency, runCli } from "@scorel/app-cli";

describe("@scorel/app-cli", () => {
  it("is an entrypoint shell over client/daemon", () => {
    expect(cliAppName).toBe("@scorel/app-cli");
    expect(cliClientDependency).toBe("@scorel/client");
    expect(cliDaemonDependency).toBe("@scorel/daemon");
  });

  it("runs scorel chat through embedded daemon/client and resumes persisted sessions", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-cli-"));
    const sessionId = "ses_cli_alpha";

    const first = await runCliWithInput(
      ["chat", "--sessions-dir", sessionsDir, "--session", sessionId],
      "hello\n/echo tools\n.exit\n",
    );
    expect(first.code).toBe(0);
    expect(first.stderr).toContain("created session ses_cli_alpha");
    expect(first.stdout).toContain("Echo: hello");
    expect(first.stdout).toContain("Tool: tools");

    const second = await runCliWithInput(
      ["chat", "--sessions-dir", sessionsDir, "--session", sessionId],
      "again\n.exit\n",
    );
    expect(second.code).toBe(0);
    expect(second.stderr).toContain("resumed session ses_cli_alpha");
    expect(second.stdout).toContain("Echo: again");

    const jsonl = await readFile(join(sessionsDir, `${sessionId}.jsonl`), "utf8");
    const lines = jsonl.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type ?? "header")).toEqual([
      "header",
      "user_message",
      "assistant_message",
      "user_message",
      "assistant_message",
      "tool_result",
      "assistant_message",
      "user_message",
      "assistant_message",
    ]);

    const finalFirstRunEvent = lines[6];
    const resumedUserEvent = lines[7];
    expect(resumedUserEvent.parentId).toBe(finalFirstRunEvent.id);
    expect(lines.at(-1)).toMatchObject({ type: "assistant_message" });
    expect(lines.at(-1).seq).toBeGreaterThan(resumedUserEvent.seq);
  });

  it("runs S0008 coding tools through CLI-visible daemon/client flow", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-cli-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-workspace-"));
    const sessionId = "ses_cli_tools";
    await import("node:fs/promises").then(({ writeFile }) => writeFile(join(workspaceDir, "note.txt"), "hello\nworld\n"));

    const result = await runCliWithInput(
      ["chat", "--sessions-dir", sessionsDir, "--session", sessionId, "--cwd", workspaceDir],
      [
        "/read note.txt",
        "/edit note.txt world scorel",
        "/bash cat note.txt",
        "/write created.txt done",
        ".exit",
        "",
      ].join("\n"),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[tool:Read]");
    expect(result.stdout).toContain("hello");
    expect(result.stdout).toContain("[tool:Edit]");
    expect(result.stdout).toContain("[tool:Bash]");
    expect(result.stdout).toContain("scorel");
    expect(result.stdout).toContain("[tool:Write]");

    const jsonl = await readFile(join(sessionsDir, `${sessionId}.jsonl`), "utf8");
    const lines = jsonl.trim().split("\n").map((line) => JSON.parse(line));
    const toolResults = lines.filter((line) => line.type === "tool_result");
    expect(toolResults.map((line) => line.message.content[0].toolName)).toEqual(["Read", "Edit", "Bash", "Write"]);
  });

  it("runs S0009 code discovery tools through CLI-visible daemon/client flow", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-cli-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-workspace-"));
    const sessionId = "ses_cli_search";
    const { mkdir: makeDir, writeFile } = await import("node:fs/promises");
    await makeDir(join(workspaceDir, "src"));
    await writeFile(join(workspaceDir, "src", "target.ts"), "export const target = true;\n");
    await writeFile(join(workspaceDir, "src", "other.js"), "target\n");

    const result = await runCliWithInput(
      ["chat", "--sessions-dir", sessionsDir, "--session", sessionId, "--cwd", workspaceDir],
      ["/glob src/*.ts", "/grep target src/*.ts", ".exit", ""].join("\n"),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[tool:Glob]");
    expect(result.stdout).toContain("src/target.ts");
    expect(result.stdout).toContain("[tool:Grep]");
    expect(result.stdout).toContain("src/target.ts");

    const jsonl = await readFile(join(sessionsDir, `${sessionId}.jsonl`), "utf8");
    const lines = jsonl.trim().split("\n").map((line) => JSON.parse(line));
    const toolResults = lines.filter((line) => line.type === "tool_result");
    expect(toolResults.map((line) => line.message.content[0].toolName)).toEqual(["Glob", "Grep"]);
  });
});

const runCliWithInput = async (
  argv: string[],
  input: string,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const stdout = new StringWritable();
  const stderr = new StringWritable();
  const code = await runCli(argv, {
    input: Readable.from([input]),
    output: stdout,
    error: stderr,
  });
  return { code, stdout: stdout.toString(), stderr: stderr.toString() };
};

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
