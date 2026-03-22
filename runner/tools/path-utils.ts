import path from "node:path";

export function resolveToolPath(filePath: string, workspaceRoot: string): string {
  return path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workspaceRoot, filePath);
}

export function formatFileAccessError(
  action: "read" | "write" | "edit",
  filePath: string,
  error: unknown,
): string {
  const code = typeof error === "object" && error != null && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : null;

  if (code === "ENOENT") {
    return `File not found: ${filePath}`;
  }

  if (code === "EACCES" || code === "EPERM") {
    return `Permission denied: ${filePath}`;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return `Failed to ${action} file: ${detail}`;
}
