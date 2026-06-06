#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);

const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${cmd} ${args.join(" ")} failed\n${output}`);
  }
  return result.stdout.trim();
};

const runForOutput = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
};

const tempRoot = await mkdtemp(join(tmpdir(), "scorel-pack-smoke-"));
try {
  run("pnpm", ["build:package"]);
  const packOutput = run("npm", ["pack", "--json", "--pack-destination", tempRoot]);
  const [packed] = JSON.parse(packOutput);
  if (!packed?.filename) {
    throw new Error(`npm pack did not return a filename: ${packOutput}`);
  }
  const tarball = join(tempRoot, packed.filename);
  const projectDir = join(tempRoot, "project");
  await writeFile(join(tempRoot, "package.json"), "{}\n");
  await rm(projectDir, { recursive: true, force: true });
  await writeFile(join(tempRoot, "package-lock.json"), "", { flag: "a" });
  await rm(join(tempRoot, "package-lock.json"), { force: true });

  await writeFile(join(tempRoot, "smoke-package.json"), "{}\n");
  await rm(projectDir, { recursive: true, force: true });
  await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDir, { recursive: true }));
  await writeFile(join(projectDir, "package.json"), '{"private":true,"type":"module"}\n');

  run("npm", ["install", "--silent", tarball], { cwd: projectDir });
  const help = runForOutput(join(projectDir, "node_modules/.bin/scorel"), ["--help"], { cwd: projectDir });
  const helpOutput = [help.stdout, help.stderr].filter(Boolean).join("\n");
  if (help.status !== 0 || !helpOutput.includes("Usage: scorel")) {
    throw new Error(`scorel --help smoke failed status=${help.status}\nstdout:\n${help.stdout}\nstderr:\n${help.stderr}`);
  }

  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  console.log(`pack smoke passed for ${pkg.name}@${pkg.version}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
