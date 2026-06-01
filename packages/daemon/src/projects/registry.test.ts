import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { asProjectId } from "@scorel/protocol";

import { ProjectRegistry } from "./registry.js";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "scorel-registry-"));
  const sessionsDir = join(root, "sessions");
  const projectsPath = join(root, "projects.json");
  await mkdir(sessionsDir);
  let nextId = 0;
  const registry = new ProjectRegistry({
    projectsPath,
    sessionsDir,
    createId: () => `id_${++nextId}`,
    now: () => 100,
  });
  return { root, sessionsDir, projectsPath, registry };
};

describe("ProjectRegistry", () => {
  it("registers canonical directories idempotently and restores persisted projects", async () => {
    const { root, sessionsDir, projectsPath, registry } = await fixture();
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const canonicalWorkspace = await realpath(workspace);

    const first = await registry.register(workspace);
    const second = await registry.register(join(workspace, "."));

    expect(first).toEqual({
      projectId: "prj_id_1",
      displayName: "workspace",
      workDir: canonicalWorkspace,
      createdAt: 100,
      updatedAt: 100,
    });
    expect(second).toEqual(first);
    expect(await registry.list()).toEqual([first]);

    const restored = new ProjectRegistry({ projectsPath, sessionsDir });
    expect(await restored.require(first.projectId)).toEqual(first);
  });

  it("rejects missing paths and files", async () => {
    const { root, registry } = await fixture();
    const file = join(root, "file.txt");
    await writeFile(file, "not a directory");

    await expect(registry.register(join(root, "missing"))).rejects.toMatchObject({
      code: "filesystem_error",
    });
    await expect(registry.register(file)).rejects.toMatchObject({
      code: "filesystem_error",
    });
  });

  it("serializes concurrent registration and keeps stable ordering", async () => {
    const { root, registry } = await fixture();
    const alpha = join(root, "alpha");
    const beta = join(root, "beta");
    await Promise.all([mkdir(alpha), mkdir(beta)]);

    const [first, second, duplicate] = await Promise.all([
      registry.register(beta),
      registry.register(alpha),
      registry.register(beta),
    ]);

    expect(duplicate).toEqual(first);
    expect(second.projectId).toBe("prj_id_2");
    expect((await registry.list()).map((project) => project.projectId)).toEqual([
      "prj_id_1",
      "prj_id_2",
    ]);
  });

  it("removes projects without deleting workspace files", async () => {
    const { root, registry } = await fixture();
    const workspace = join(root, "workspace");
    const marker = join(workspace, "marker.txt");
    await mkdir(workspace);
    await writeFile(marker, "keep");

    const project = await registry.register(workspace);
    await expect(registry.remove(project.projectId)).resolves.toBe(true);

    expect(await registry.list()).toEqual([]);
    await expect(readFile(marker, "utf8")).resolves.toBe("keep");
  });

  it("rejects removal while a session still references the project", async () => {
    const { root, sessionsDir, registry } = await fixture();
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const project = await registry.register(workspace);
    await writeFile(
      join(sessionsDir, "ses_1.jsonl"),
      `${JSON.stringify({
        version: 1,
        sessionId: "ses_1",
        deviceId: "device_test",
        createdAt: 1,
        meta: { projectId: project.projectId },
      })}\n`,
    );

    await expect(registry.remove(project.projectId)).rejects.toMatchObject({
      code: "project_has_sessions",
    });
    expect(await registry.require(project.projectId)).toEqual(project);
  });

  it("rejects unknown project ids", async () => {
    const { registry } = await fixture();

    await expect(registry.require(asProjectId("prj_missing"))).rejects.toMatchObject({
      code: "project_not_found",
    });
    await expect(registry.remove(asProjectId("prj_missing"))).rejects.toMatchObject({
      code: "project_not_found",
    });
  });
});
