import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { asProjectId, asSeq, asSessionId, type ProjectId, type SessionSummary } from "@scorel/protocol";

export type SessionSummaryOverrides = Map<string, { currentSeq?: number; updatedAt?: number }>;

export const listSessionSummaries = async (
  sessionsDir: string,
  filter: { projectId?: ProjectId; limit?: number } = {},
  overrides?: SessionSummaryOverrides,
): Promise<SessionSummary[]> => {
  let names: string[];
  try {
    names = await readdir(sessionsDir);
  } catch (cause) {
    if (isNodeError(cause, "ENOENT")) {
      return [];
    }
    throw cause;
  }
  const sessions = (
    await Promise.all(
      names
        .filter((name) => name.endsWith(".jsonl") && !name.startsWith("."))
        .map((name) => readSummary(join(sessionsDir, name), overrides)),
    )
  )
    .filter((session): session is SessionSummary => session !== undefined)
    .filter((session) => filter.projectId === undefined || session.projectId === filter.projectId)
    .sort((left, right) => right.updatedAt - left.updatedAt || String(left.sessionId).localeCompare(String(right.sessionId)));
  return sessions.slice(0, clampLimit(filter.limit));
};

const readSummary = async (
  filePath: string,
  overrides?: SessionSummaryOverrides,
): Promise<SessionSummary | undefined> => {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (cause) {
    if (isNodeError(cause, "ENOENT")) {
      return undefined;
    }
    throw cause;
  }
  const lines = content.split(/\r?\n/).filter(Boolean);
  const header = parseRecord(lines[0]);
  if (
    header?.version !== 1 ||
    typeof header.sessionId !== "string" ||
    typeof header.createdAt !== "number" ||
    !isRecord(header.meta) ||
    typeof header.meta.projectId !== "string"
  ) {
    return undefined;
  }
  const override = overrides?.get(header.sessionId);
  return {
    sessionId: asSessionId(header.sessionId),
    projectId: asProjectId(header.meta.projectId),
    title: typeof header.meta.title === "string" ? header.meta.title : undefined,
    model: typeof header.meta.model === "string" ? header.meta.model : undefined,
    updatedAt: override?.updatedAt ?? (typeof header.meta.updatedAt === "number" ? header.meta.updatedAt : header.createdAt),
    currentSeq: asSeq(override?.currentSeq ?? tailSeq(lines.slice(1))),
  };
};

const tailSeq = (lines: string[]): number => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const event = parseRecord(lines[index]);
    if (typeof event?.seq === "number") {
      return event.seq;
    }
  }
  return 0;
};

const clampLimit = (limit: number | undefined): number =>
  limit === undefined || !Number.isFinite(limit) || limit <= 0 ? 200 : Math.min(Math.floor(limit), 1_000);

const parseRecord = (line: string | undefined): Record<string, unknown> | undefined => {
  try {
    const value = line === undefined ? undefined : JSON.parse(line) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeError = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;
