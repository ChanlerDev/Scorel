import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  asSeq,
  asSessionId,
  type DaemonProjectSummary,
  type SessionId,
  type SessionSummary,
  type Seq,
} from "@scorel/protocol";

/**
 * Per-session entry derived from a JSONL header. Internal aggregator type;
 * the public protocol shape is `SessionSummary` (no `workDirHint`, no
 * `createdAt`).
 */
export type AggregatedSession = {
  sessionId: SessionId;
  projectSlug: string;
  title?: string;
  model?: string;
  updatedAt: number;
  createdAt: number;
  currentSeq: Seq;
  workDirHint?: string;
};

export type AggregatorOverride = {
  currentSeq?: number;
  updatedAt?: number;
};

export type AggregatorOverrides = Map<string, AggregatorOverride>;

export type AggregatorScanInput = {
  sessionsDir: string;
  /**
   * Slug applied to legacy headers without `meta.projectSlug`. Daemon owns
   * its own working directory and computes this once at construction.
   */
  fallbackProjectSlug: string;
  /**
   * Workdir of the daemon, used as the displayed `workDirHint` when a
   * session header omits `meta.workDirHint` (legacy sessions).
   */
  fallbackWorkDirHint?: string;
};

export const sortAggregatedSessions = (sessions: AggregatedSession[]): AggregatedSession[] =>
  [...sessions].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return String(left.sessionId).localeCompare(String(right.sessionId));
  });

export const filterAndLimit = (
  sessions: AggregatedSession[],
  filter?: { projectSlug?: string; limit?: number },
): AggregatedSession[] => {
  const slug = filter?.projectSlug;
  const filtered = slug ? sessions.filter((session) => session.projectSlug === slug) : sessions;
  const limit = clampLimit(filter?.limit);
  return filtered.slice(0, limit);
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
};

export const toSessionSummaries = (sessions: AggregatedSession[]): SessionSummary[] =>
  sessions.map((session) => ({
    sessionId: session.sessionId,
    title: session.title,
    model: session.model,
    updatedAt: session.updatedAt,
    currentSeq: session.currentSeq,
    projectSlug: session.projectSlug,
  }));

export const buildProjectSummaries = (sessions: AggregatedSession[]): DaemonProjectSummary[] => {
  const byProject = new Map<string, { entry: DaemonProjectSummary; lastSeenAt: number }>();
  for (const session of sessions) {
    const slug = session.projectSlug;
    const existing = byProject.get(slug);
    const candidateLastSeen = Math.max(session.updatedAt, session.createdAt);
    if (existing) {
      existing.entry.sessionCount += 1;
      if (candidateLastSeen > existing.lastSeenAt) {
        existing.lastSeenAt = candidateLastSeen;
        existing.entry.lastSeenAt = candidateLastSeen;
      }
      if (!existing.entry.workDirHint && session.workDirHint) {
        existing.entry.workDirHint = session.workDirHint;
        existing.entry.displayName = basename(session.workDirHint) || slug;
      }
    } else {
      byProject.set(slug, {
        entry: {
          projectSlug: slug,
          displayName: session.workDirHint ? basename(session.workDirHint) || slug : slug,
          workDirHint: session.workDirHint,
          sessionCount: 1,
          lastSeenAt: candidateLastSeen,
        },
        lastSeenAt: candidateLastSeen,
      });
    }
  }
  return [...byProject.values()]
    .map(({ entry }) => entry)
    .sort((left, right) => {
      if (right.lastSeenAt !== left.lastSeenAt) {
        return right.lastSeenAt - left.lastSeenAt;
      }
      return left.projectSlug.localeCompare(right.projectSlug);
    });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseHeaderLine = (
  line: string,
  fallbackProjectSlug: string,
  fallbackWorkDirHint: string | undefined,
  currentSeqValue: number,
): AggregatedSession | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.version !== 1) {
    return undefined;
  }
  const sessionId = parsed.sessionId;
  if (typeof sessionId !== "string") {
    return undefined;
  }
  const meta = isRecord(parsed.meta) ? parsed.meta : {};
  const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;
  const updatedAt = typeof meta.updatedAt === "number" ? meta.updatedAt : createdAt;
  const projectSlug = typeof meta.projectSlug === "string" && meta.projectSlug.length > 0
    ? meta.projectSlug
    : fallbackProjectSlug;
  const workDirHint = typeof meta.workDirHint === "string" && meta.workDirHint.length > 0
    ? meta.workDirHint
    : fallbackWorkDirHint;
  const title = typeof meta.title === "string" ? meta.title : undefined;
  const model = typeof meta.model === "string" ? meta.model : undefined;
  return {
    sessionId: asSessionId(sessionId),
    projectSlug,
    title,
    model,
    updatedAt,
    createdAt,
    currentSeq: asSeq(currentSeqValue),
    workDirHint,
  };
};

/**
 * Extract the last persistent event's `seq` from a list of JSONL body lines.
 * Falls back to the number of body lines if no seq could be parsed (legacy /
 * malformed entries).
 */
const tailEventSeq = (bodyLines: string[]): number => {
  for (let index = bodyLines.length - 1; index >= 0; index -= 1) {
    const line = bodyLines[index];
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed) && typeof parsed.seq === "number") {
        return parsed.seq;
      }
    } catch {
      continue;
    }
  }
  return bodyLines.length;
};

const isJsonlSessionFileName = (name: string): boolean =>
  name.endsWith(".jsonl") && !name.startsWith(".");

export const scanSessionHeaders = async (
  input: AggregatorScanInput,
): Promise<AggregatedSession[]> => {
  let entries: string[];
  try {
    entries = await readdir(input.sessionsDir);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return [];
    }
    throw cause;
  }
  const aggregated: AggregatedSession[] = [];
  for (const entry of entries) {
    if (!isJsonlSessionFileName(entry)) {
      continue;
    }
    const filePath = join(input.sessionsDir, entry);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
        continue;
      }
      throw cause;
    }
    const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
    const headerLine = lines[0];
    if (!headerLine) {
      continue;
    }
    const bodyLines = lines.slice(1);
    const currentSeqValue = tailEventSeq(bodyLines);
    const parsed = parseHeaderLine(
      headerLine,
      input.fallbackProjectSlug,
      input.fallbackWorkDirHint,
      currentSeqValue,
    );
    if (parsed) {
      aggregated.push(parsed);
    }
  }
  return aggregated;
};

const applyOverrides = (
  sessions: AggregatedSession[],
  overrides: AggregatorOverrides | undefined,
): AggregatedSession[] => {
  if (!overrides || overrides.size === 0) {
    return sessions;
  }
  return sessions.map((session) => {
    const override = overrides.get(String(session.sessionId));
    if (!override) {
      return session;
    }
    const next: AggregatedSession = { ...session };
    if (typeof override.currentSeq === "number" && override.currentSeq > Number(session.currentSeq)) {
      next.currentSeq = asSeq(override.currentSeq);
    }
    if (typeof override.updatedAt === "number" && override.updatedAt > session.updatedAt) {
      next.updatedAt = override.updatedAt;
    }
    return next;
  });
};

/**
 * Lazy disk-scan cache for the daemon's sessions directory. The scan reads
 * each JSONL header line and counts subsequent lines for `currentSeq`. The
 * cache is invalidated by the daemon whenever a session is created or a
 * persistent event is appended.
 */
export class ProjectAggregator {
  readonly #scanInput: AggregatorScanInput;
  #cache: AggregatedSession[] | undefined;

  constructor(scanInput: AggregatorScanInput) {
    this.#scanInput = scanInput;
  }

  invalidate(): void {
    this.#cache = undefined;
  }

  async aggregate(overrides?: AggregatorOverrides): Promise<{
    sessions: AggregatedSession[];
    projects: DaemonProjectSummary[];
  }> {
    if (!this.#cache) {
      this.#cache = await scanSessionHeaders(this.#scanInput);
    }
    const live = applyOverrides(this.#cache, overrides);
    const sortedSessions = sortAggregatedSessions(live);
    return {
      sessions: sortedSessions,
      projects: buildProjectSummaries(live),
    };
  }

  async listSessions(
    filter: { projectSlug?: string; limit?: number } | undefined,
    overrides?: AggregatorOverrides,
  ): Promise<SessionSummary[]> {
    const { sessions } = await this.aggregate(overrides);
    return toSessionSummaries(filterAndLimit(sessions, filter));
  }

  async listProjects(overrides?: AggregatorOverrides): Promise<DaemonProjectSummary[]> {
    const { projects } = await this.aggregate(overrides);
    return projects;
  }
}
