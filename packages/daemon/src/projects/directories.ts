import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readdir, realpath, stat } from "node:fs/promises";

import type { DirectoryEntry, DirectoryListing } from "@scorel/protocol";

import { ProjectRegistryError } from "./registry.js";

export const listDirectories = async (path = homedir()): Promise<DirectoryListing> => {
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) {
      throw new ProjectRegistryError("filesystem_error", `Path is not a directory: ${path}`);
    }
    const entries = await directoryEntries(canonical);
    const parent = dirname(canonical);
    return {
      path: canonical,
      parentPath: parent === canonical ? undefined : parent,
      entries,
    };
  } catch (cause) {
    if (cause instanceof ProjectRegistryError) {
      throw cause;
    }
    throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
  }
};

const directoryEntries = async (path: string): Promise<DirectoryEntry[]> => {
  const entries = await readdir(path, { withFileTypes: true });
  const directories = await Promise.all(
    entries.map(async (entry): Promise<DirectoryEntry | undefined> => {
      const candidate = join(path, entry.name);
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        return undefined;
      }
      try {
        const canonical = await realpath(candidate);
        return (await stat(canonical)).isDirectory()
          ? { name: entry.name, path: canonical, kind: "directory" }
          : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return directories
    .filter((entry): entry is DirectoryEntry => entry !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
};

const errorMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
