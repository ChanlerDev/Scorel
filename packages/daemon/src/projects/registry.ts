import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { asProjectId, type HostProject, type ProjectId } from "@scorel/protocol";

type ProjectRegistryFile = {
  version: 1;
  projects: HostProject[];
};

export type ProjectRegistryOptions = {
  projectsPath: string;
  sessionsDir: string;
  createId?: () => string;
  now?: () => number;
};

export class ProjectRegistryError extends Error {
  readonly code: "project_not_found" | "project_has_sessions" | "filesystem_error" | "conflict";

  constructor(code: ProjectRegistryError["code"], message: string) {
    super(message);
    this.name = "ProjectRegistryError";
    this.code = code;
  }
}

export class ProjectRegistry {
  readonly #projectsPath: string;
  readonly #sessionsDir: string;
  readonly #createId: () => string;
  readonly #now: () => number;
  #mutation = Promise.resolve();

  constructor(options: ProjectRegistryOptions) {
    this.#projectsPath = options.projectsPath;
    this.#sessionsDir = options.sessionsDir;
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? Date.now;
  }

  async list(): Promise<HostProject[]> {
    const file = await this.#read();
    return sortProjects(file.projects);
  }

  async get(projectId: ProjectId): Promise<HostProject | undefined> {
    return (await this.list()).find((project) => project.projectId === projectId);
  }

  async require(projectId: ProjectId): Promise<HostProject> {
    const project = await this.get(projectId);
    if (!project) {
      throw new ProjectRegistryError("project_not_found", `Unknown project: ${projectId}`);
    }
    return project;
  }

  async register(workDir: string): Promise<HostProject> {
    return this.#mutate(async (file) => {
      const canonical = await canonicalDirectory(workDir);
      const existing = file.projects.find((project) => project.workDir === canonical);
      if (existing) {
        return { result: existing, changed: false };
      }
      const now = this.#now();
      const project: HostProject = {
        projectId: asProjectId(`prj_${this.#createId()}`),
        displayName: basename(canonical) || canonical,
        workDir: canonical,
        createdAt: now,
        updatedAt: now,
      };
      file.projects.push(project);
      return { result: project, changed: true };
    });
  }

  async remove(projectId: ProjectId): Promise<boolean> {
    return this.#mutate(async (file) => {
      const index = file.projects.findIndex((project) => project.projectId === projectId);
      if (index < 0) {
        throw new ProjectRegistryError("project_not_found", `Unknown project: ${projectId}`);
      }
      if (await sessionReferencesProject(this.#sessionsDir, projectId)) {
        throw new ProjectRegistryError("project_has_sessions", `Project still has sessions: ${projectId}`);
      }
      file.projects.splice(index, 1);
      return { result: true, changed: true };
    });
  }

  async #mutate<TResult>(
    mutation: (file: ProjectRegistryFile) => Promise<{ result: TResult; changed: boolean }>,
  ): Promise<TResult> {
    const operation = this.#mutation.then(async () => {
      const file = await this.#read();
      const { result, changed } = await mutation(file);
      if (changed) {
        await this.#write({ version: 1, projects: sortProjects(file.projects) });
      }
      return result;
    });
    this.#mutation = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #read(): Promise<ProjectRegistryFile> {
    try {
      const parsed = JSON.parse(await readFile(this.#projectsPath, "utf8")) as unknown;
      if (!isRegistryFile(parsed)) {
        throw new ProjectRegistryError("filesystem_error", `Invalid project registry: ${this.#projectsPath}`);
      }
      return { version: 1, projects: parsed.projects.map((project) => ({ ...project })) };
    } catch (cause) {
      if (isNodeError(cause, "ENOENT")) {
        return { version: 1, projects: [] };
      }
      if (cause instanceof ProjectRegistryError) {
        throw cause;
      }
      throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
    }
  }

  async #write(file: ProjectRegistryFile): Promise<void> {
    await mkdir(dirname(this.#projectsPath), { recursive: true });
    const temporaryPath = `${this.#projectsPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.#projectsPath);
    } catch (cause) {
      throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
    }
  }
}

const canonicalDirectory = async (workDir: string): Promise<string> => {
  try {
    const canonical = await realpath(workDir);
    if (!(await stat(canonical)).isDirectory()) {
      throw new ProjectRegistryError("filesystem_error", `Project path is not a directory: ${workDir}`);
    }
    return canonical;
  } catch (cause) {
    if (cause instanceof ProjectRegistryError) {
      throw cause;
    }
    throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
  }
};

const sessionReferencesProject = async (sessionsDir: string, projectId: ProjectId): Promise<boolean> => {
  let names: string[];
  try {
    names = await readdir(sessionsDir);
  } catch (cause) {
    if (isNodeError(cause, "ENOENT")) {
      return false;
    }
    throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
  }
  for (const name of names) {
    if (name.startsWith(".")) {
      continue;
    }
    const entryPath = join(sessionsDir, name);
    let entryIsDirectory = false;
    let entryIsFile = false;
    try {
      const info = await stat(entryPath);
      entryIsDirectory = info.isDirectory();
      entryIsFile = info.isFile();
    } catch (cause) {
      if (isNodeError(cause, "ENOENT")) {
        continue;
      }
      throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
    }
    const candidates = [
      ...(entryIsDirectory ? [join(entryPath, "events.jsonl")] : []),
      ...(entryIsFile && name.endsWith(".jsonl") ? [entryPath] : []),
    ];
    for (const filePath of candidates) {
      try {
        const firstLine = (await readFile(filePath, "utf8")).split(/\r?\n/, 1)[0];
        const parsed = firstLine ? (JSON.parse(firstLine) as unknown) : undefined;
        if (
          isRecord(parsed) &&
          isRecord(parsed.meta) &&
          parsed.meta.projectId === projectId &&
          parsed.meta.kind !== "subagent"
        ) {
          return true;
        }
      } catch (cause) {
        if (!isNodeError(cause, "ENOENT") && !isNodeError(cause, "ENOTDIR")) {
          throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
        }
      }
    }
  }
  return false;
};

const sortProjects = (projects: HostProject[]): HostProject[] =>
  [...projects].sort((left, right) => String(left.projectId).localeCompare(String(right.projectId)));

const isRegistryFile = (value: unknown): value is ProjectRegistryFile =>
  isRecord(value) &&
  value.version === 1 &&
  Array.isArray(value.projects) &&
  value.projects.every(
    (project) =>
      isRecord(project) &&
      typeof project.projectId === "string" &&
      typeof project.displayName === "string" &&
      typeof project.workDir === "string" &&
      typeof project.createdAt === "number" &&
      typeof project.updatedAt === "number",
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeError = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;

const errorMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
