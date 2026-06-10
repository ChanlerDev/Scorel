import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ExtensionKind = "im";

export type ExtensionManifest = {
  id: string;
  kind: ExtensionKind;
  displayName: string;
  adapter: string;
  skills: string[];
  mcp: unknown[];
  manifestPath: string;
  rootDir: string;
};

export const loadExtensionManifest = async (manifestPath: string): Promise<ExtensionManifest> =>
  parseExtensionManifest(await readFile(manifestPath, "utf8"), manifestPath);

export const parseExtensionManifest = (text: string, manifestPath = "scorel.extension.json"): ExtensionManifest => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid extension manifest JSON at ${manifestPath}: ${message}`);
  }
  if (!isRecord(value)) {
    throw new Error(`Extension manifest at ${manifestPath} must be an object`);
  }
  const rootDir = dirname(resolve(manifestPath));
  const id = requireIdentifier(value.id, "id", manifestPath);
  const kind = requireKind(value.kind, manifestPath);
  const displayName = requireString(value.displayName, "displayName", manifestPath);
  const adapter = requireRelativePath(value.adapter, "adapter", manifestPath);
  const skills = optionalRelativePaths(value.skills, "skills", manifestPath);
  const mcp = Array.isArray(value.mcp) ? value.mcp : [];
  return {
    id,
    kind,
    displayName,
    adapter,
    skills,
    mcp,
    manifestPath: resolve(manifestPath),
    rootDir,
  };
};

const requireString = (value: unknown, name: string, manifestPath: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Extension manifest ${manifestPath} field ${name} must be a non-empty string`);
  }
  return value;
};

const requireIdentifier = (value: unknown, name: string, manifestPath: string): string => {
  const text = requireString(value, name, manifestPath);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new Error(`Extension manifest ${manifestPath} field ${name} must contain only letters, numbers, underscores, or hyphens`);
  }
  return text;
};

const requireKind = (value: unknown, manifestPath: string): ExtensionKind => {
  if (value === "im") {
    return value;
  }
  throw new Error(`Extension manifest ${manifestPath} field kind must be im`);
};

const requireRelativePath = (value: unknown, name: string, manifestPath: string): string => {
  const text = requireString(value, name, manifestPath);
  if (text.startsWith("/") || text.includes("..")) {
    throw new Error(`Extension manifest ${manifestPath} field ${name} must be a relative path inside the extension`);
  }
  return text;
};

const optionalRelativePaths = (value: unknown, name: string, manifestPath: string): string[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Extension manifest ${manifestPath} field ${name} must be an array`);
  }
  return value.map((item, index) => requireRelativePath(item, `${name}.${index}`, manifestPath));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
