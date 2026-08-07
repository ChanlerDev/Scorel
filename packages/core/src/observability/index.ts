import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";

import type { ContentBlock, PersistentEvent, ScorelEvent, SessionId, ToolCallContentBlock, ToolResultContentBlock, Usage } from "@scorel/protocol";

import type { ObservabilityTarget, ScorelConfig } from "../config/index.js";
import { buildSessionObservationSummary, type JsonlSession, type SessionObservationSummary } from "../session/index.js";

export type ObservationAsset = {
  format: "scorel-observation-asset-v1";
  assetId: string;
  revision: string;
  sessionId: string;
  deviceId: string;
  projectId: string;
  currentSeq: number;
  sourceSessionJsonl: string;
  summary: SessionObservationSummary;
  trajectory: {
    format: "scorel-session-trajectory-v1";
    events: PersistentEvent[];
  };
};

export type LangfuseSyncPayload = {
  target: "langfuse";
  format: "scorel-langfuse-sync-v1";
  assetId: string;
  revision: string;
  traceIds: string[];
  batch: LangfuseIngestionEvent[];
};

export type LangfuseIngestionEvent = {
  id: string;
  type: "trace-create" | "generation-create" | "observation-create";
  timestamp: string;
  body: Record<string, unknown> & { id: string; traceId?: string; sessionId?: string };
};

export type ObservabilitySyncState = {
  target: string;
  assetId: string;
  lastExportedSeq: number;
  lastRevision?: string;
  updatedAt?: number;
};

export type OtelDeltaPayload = {
  target: "otel";
  format: "scorel-otel-delta-v1";
  assetId: string;
  revision: string;
  fromSeq: number;
  toSeq: number;
  events: PersistentEvent[];
  metrics: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    eventCount: number;
  };
  otlp: OtelSyncPayload;
  nextState: ObservabilitySyncState;
};

export type OtelSyncPayload = {
  traces: OtelTracesPayload;
  metrics: OtelMetricsPayload;
  logs: OtelLogsPayload;
};

export type OtelTracesPayload = {
  resourceSpans: Array<{
    resource: { attributes: OtelAttribute[] };
    scopeSpans: Array<{
      scope: { name: string; version?: string };
      spans: OtelSpan[];
    }>;
  }>;
};

export type OtelMetricsPayload = {
  resourceMetrics: Array<{
    resource: { attributes: OtelAttribute[] };
    scopeMetrics: Array<{
      scope: { name: string; version?: string };
      metrics: OtelMetric[];
    }>;
  }>;
};

export type OtelLogsPayload = {
  resourceLogs: Array<{
    resource: { attributes: OtelAttribute[] };
    scopeLogs: Array<{
      scope: { name: string; version?: string };
      logRecords: OtelLogRecord[];
    }>;
  }>;
};

export type OtelAttribute = {
  key: string;
  value: { stringValue?: string; intValue?: string; boolValue?: boolean };
};

export type OtelSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtelAttribute[];
};

export type OtelMetric = {
  name: string;
  description: string;
  unit: string;
  sum: {
    aggregationTemporality: number;
    isMonotonic: boolean;
    dataPoints: Array<{
      timeUnixNano: string;
      asInt: string;
      attributes: OtelAttribute[];
    }>;
  };
};

export type OtelLogRecord = {
  timeUnixNano: string;
  severityText: string;
  body: { stringValue: string };
  attributes: OtelAttribute[];
};

export type ObservabilitySyncTargetResult = {
  target: ObservabilityTarget;
  status: "uploaded" | "skipped";
  events: number;
  reason?: string;
};

export const buildObservationAsset = (session: JsonlSession): ObservationAsset => {
  const events = [...session.tree];
  const summary = buildSessionObservationSummary(session);
  const currentSeq = events.reduce((max, event) => Math.max(max, Number(event.seq)), 0);
  const assetId = stableAssetId(summary.deviceId, summary.projectId, summary.sessionId);
  const revision = shortHash(JSON.stringify({ currentSeq, events }));
  return {
    format: "scorel-observation-asset-v1",
    assetId,
    revision,
    sessionId: summary.sessionId,
    deviceId: summary.deviceId,
    projectId: summary.projectId,
    currentSeq,
    sourceSessionJsonl: summary.sourceSessionJsonl,
    summary,
    trajectory: {
      format: "scorel-session-trajectory-v1",
      events,
    },
  };
};

export const buildLangfuseSyncPayload = (asset: ObservationAsset): LangfuseSyncPayload => {
  const batch: LangfuseIngestionEvent[] = [];
  const traceIds: string[] = [];
  const turns = langfuseTurns(asset.trajectory.events);

  turns.forEach((turn, index) => {
    const turnIndex = index + 1;
    const traceId = stableLangfuseId("scorel-turn", asset.assetId, String(turn.user.id));
    const output = turnOutput(turn);
    traceIds.push(traceId);
    batch.push({
      id: revisionEnvelopeId("trace", traceId, asset.revision),
      type: "trace-create",
      timestamp: isoFromMillis(turn.user.ts),
      body: {
        id: traceId,
        name: `scorel.chat.turn ${turnIndex}`,
        timestamp: isoFromMillis(turn.user.ts),
        sessionId: asset.sessionId,
        input: messageInput(turn.user),
        ...(output ? { output } : {}),
        release: scorelRelease(),
        version: asset.revision,
        tags: langfuseTags(asset),
        environment: "development",
        metadata: {
          scorelAssetId: asset.assetId,
          scorelRevision: asset.revision,
          scorelTurnIndex: turnIndex,
          userEventId: String(turn.user.id),
          deviceId: asset.deviceId,
          projectId: asset.projectId,
          sourceSessionJsonl: asset.sourceSessionJsonl,
          eventCount: turn.events.length,
          currentSeq: asset.currentSeq,
        },
      },
    });

    const generationParents = new Map<string, string>();
    const turnEventsById = new Map(turn.events.map((event) => [String(event.id), event]));
    for (const event of turn.events) {
      if (event.type === "assistant_message") {
        const generationId = stableLangfuseId("scorel-generation", traceId, String(event.id));
        generationParents.set(String(event.id), generationId);
        const costDetails = costDetailsFromSummary(asset, event.message.usage);
        batch.push({
          id: revisionEnvelopeId("generation", generationId, asset.revision),
          type: "generation-create",
          timestamp: isoFromMillis(event.ts),
          body: {
            id: generationId,
            traceId,
            sessionId: asset.sessionId,
            name: "llm.generate",
            startTime: isoFromMillis(event.ts),
            endTime: isoFromMillis(event.ts),
            model: stringValue(event.message.meta?.model) ?? asset.summary.model?.providerModelId ?? asset.summary.model?.modelId,
            input: turnInputMessages(turn.user),
            output: displayMessageText(event.message.content),
            usageDetails: usageDetailsFromUsage(event.message.usage),
            ...(costDetails ? { costDetails } : {}),
            environment: "development",
            version: asset.revision,
            metadata: {
              scorelEventId: String(event.id),
              seq: Number(event.seq),
              stopReason: event.message.stopReason,
              provider: stringValue(event.message.meta?.provider) ?? asset.summary.model?.provider,
              api: stringValue(event.message.meta?.api) ?? asset.summary.model?.api,
              toolCalls: toolCallsFromContent(event.message.content),
            },
          },
        });
      }

      if (event.type === "tool_result") {
        const toolBlock = toolResultBlock(event.message.content);
        const toolName = toolBlock?.toolName ?? "tool";
        const toolId = stableLangfuseId("scorel-tool", traceId, String(event.id));
        batch.push({
          id: revisionEnvelopeId("tool", toolId, asset.revision),
          type: "observation-create",
          timestamp: isoFromMillis(event.ts),
          body: {
            id: toolId,
            traceId,
            sessionId: asset.sessionId,
            type: "TOOL",
            name: `tool.${toolName}`,
            startTime: isoFromMillis(event.ts),
            endTime: isoFromMillis(event.ts),
            parentObservationId: parentGenerationId(event, generationParents, turnEventsById),
            input: matchingToolCallInput(event, turn.events),
            output: toolBlock ? safeObservationValue(toolBlock.result) : undefined,
            level: toolBlock?.isError ? "ERROR" : "DEFAULT",
            statusMessage: toolBlock?.isError ? "Tool result reported an error" : undefined,
            environment: "development",
            version: asset.revision,
            metadata: {
              scorelEventId: String(event.id),
              seq: Number(event.seq),
              toolCallId: toolBlock?.toolCallId,
              isError: toolBlock?.isError === true,
              outputTextLength: messageText(event.message.content).length,
            },
          },
        });
      }
    }
  });

  return {
    target: "langfuse",
    format: "scorel-langfuse-sync-v1",
    assetId: asset.assetId,
    revision: asset.revision,
    traceIds,
    batch,
  };
};

export const buildOtelDeltaPayload = (
  asset: ObservationAsset,
  state: ObservabilitySyncState | undefined,
): OtelDeltaPayload => {
  const lastExportedSeq = state?.lastExportedSeq ?? 0;
  const events = asset.trajectory.events.filter((event) => Number(event.seq) > lastExportedSeq);
  const metrics = events.reduce(
    (total, event) => {
      if (event.type === "assistant_message") {
        addUsage(total, event.message.usage);
      }
      return total;
    },
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, eventCount: events.length },
  );
  const toSeq = events.reduce((max, event) => Math.max(max, Number(event.seq)), lastExportedSeq);
  return {
    target: "otel",
    format: "scorel-otel-delta-v1",
    assetId: asset.assetId,
    revision: asset.revision,
    fromSeq: lastExportedSeq + 1,
    toSeq,
    events,
    metrics,
    otlp: buildOtelSyncPayload(asset, events, metrics),
    nextState: {
      target: state?.target ?? "otel",
      assetId: asset.assetId,
      lastExportedSeq: toSeq,
      lastRevision: asset.revision,
      updatedAt: Date.now(),
    },
  };
};

export const buildOtelSyncPayload = (
  asset: ObservationAsset,
  events: PersistentEvent[],
  metrics: OtelDeltaPayload["metrics"],
): OtelSyncPayload => {
  const resource = { attributes: otelResourceAttributes(asset) };
  const scope = { name: "scorel.observability", version: "1" };
  const traceId = stableOtelHex("trace", asset.assetId, 32);
  const sessionSpanId = stableOtelHex("span", asset.assetId, 16);
  const timestamps = events.map((event) => Number(event.ts));
  const startMillis = timestamps.length > 0 ? Math.min(...timestamps) : asset.summary.updatedAt;
  const endMillis = timestamps.length > 0 ? Math.max(...timestamps) : asset.summary.updatedAt;
  const spans: OtelSpan[] = [
    {
      traceId,
      spanId: sessionSpanId,
      name: "scorel.session",
      kind: 1,
      startTimeUnixNano: unixNanoFromMillis(startMillis),
      endTimeUnixNano: unixNanoFromMillis(endMillis),
      attributes: [
        stringAttribute("scorel.asset_id", asset.assetId),
        stringAttribute("scorel.revision", asset.revision),
        stringAttribute("scorel.session_id", asset.sessionId),
        intAttribute("scorel.current_seq", asset.currentSeq),
      ],
    },
    ...events.map((event) => ({
      traceId,
      spanId: stableOtelHex("span", asset.assetId, String(event.id), 16),
      parentSpanId: sessionSpanId,
      name: `scorel.${event.type}`,
      kind: otelSpanKind(event),
      startTimeUnixNano: unixNanoFromMillis(event.ts),
      endTimeUnixNano: unixNanoFromMillis(event.ts),
      attributes: otelEventAttributes(event),
    })),
  ];
  const timeUnixNano = unixNanoFromMillis(endMillis);
  return {
    traces: {
      resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }],
    },
    metrics: {
      resourceMetrics: [{
        resource,
        scopeMetrics: [{
          scope,
          metrics: [
            {
              name: "scorel.session.events",
              description: "Scorel session events exported in this delta",
              unit: "{event}",
              sum: {
                aggregationTemporality: 1,
                isMonotonic: true,
                dataPoints: [{
                  timeUnixNano,
                  asInt: String(metrics.eventCount),
                  attributes: [stringAttribute("scorel.asset_id", asset.assetId)],
                }],
              },
            },
            {
              name: "scorel.assistant.tokens",
              description: "Assistant token usage exported in this delta",
              unit: "{token}",
              sum: {
                aggregationTemporality: 1,
                isMonotonic: true,
                dataPoints: [
                  tokenDataPoint("input", metrics.inputTokens, timeUnixNano, asset.assetId),
                  tokenDataPoint("output", metrics.outputTokens, timeUnixNano, asset.assetId),
                  tokenDataPoint("cache_read", metrics.cacheReadTokens, timeUnixNano, asset.assetId),
                  tokenDataPoint("cache_write", metrics.cacheWriteTokens, timeUnixNano, asset.assetId),
                  tokenDataPoint("total", metrics.totalTokens, timeUnixNano, asset.assetId),
                ],
              },
            },
          ],
        }],
      }],
    },
    logs: {
      resourceLogs: [{
        resource,
        scopeLogs: [{
          scope,
          logRecords: events.map((event) => ({
            timeUnixNano: unixNanoFromMillis(event.ts),
            severityText: "INFO",
            body: { stringValue: event.type },
            attributes: otelEventAttributes(event),
          })),
        }],
      }],
    },
  };
};

export const syncObservationAssetTargets = async (input: {
  asset: ObservationAsset;
  config: ScorelConfig | undefined;
  stateDir: string;
}): Promise<ObservabilitySyncTargetResult[]> => {
  const observability = input.config?.observability;
  if (!observability?.sync.enabled || observability.sync.mode !== "auto") {
    return [];
  }
  const results: ObservabilitySyncTargetResult[] = [];
  for (const target of observability.sync.targets) {
    if (target === "langfuse") {
      const langfuse = observability.langfuse;
      if (!langfuse.enabled || !langfuse.publicKey || !langfuse.secretKey) {
        results.push({ target, status: "skipped", events: 0, reason: "langfuse credentials are not configured" });
        continue;
      }
      const payload = buildLangfuseSyncPayload(input.asset);
      await uploadLangfusePayload({
        host: langfuse.host ?? "https://cloud.langfuse.com",
        publicKey: langfuse.publicKey,
        secretKey: langfuse.secretKey,
        payload,
      });
      await writeObservabilitySyncState(input.stateDir, "langfuse", input.asset.assetId, {
        target: "langfuse",
        assetId: input.asset.assetId,
        lastExportedSeq: input.asset.currentSeq,
        lastRevision: input.asset.revision,
        updatedAt: Date.now(),
      });
      results.push({ target, status: "uploaded", events: payload.batch.length });
      continue;
    }
    const otel = observability.otel;
    if (!otel.enabled || !otel.endpoint) {
      results.push({ target, status: "skipped", events: 0, reason: "otel endpoint is not configured" });
      continue;
    }
    const state = await readObservabilitySyncState(input.stateDir, "otel", input.asset.assetId);
    const payload = buildOtelDeltaPayload(input.asset, state);
    if (payload.events.length > 0) {
      await uploadOtelPayload({ endpoint: otel.endpoint, payload: payload.otlp });
    }
    await writeObservabilitySyncState(input.stateDir, "otel", input.asset.assetId, payload.nextState);
    results.push({ target, status: "uploaded", events: payload.events.length });
  }
  return results;
};

export const uploadLangfusePayload = async (input: {
  host: string;
  publicKey: string;
  secretKey: string;
  payload: { batch: unknown[] };
}): Promise<void> => {
  const endpoint = `${stripTrailingSlashes(input.host)}/api/public/ingestion`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${input.publicKey}:${input.secretKey}`).toString("base64")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ batch: input.payload.batch }),
  });
  const text = await response.text();
  if (!response.ok && response.status !== 207) {
    throw new Error(`Langfuse ingestion failed: ${response.status} ${response.statusText}${text ? ` ${truncateForError(text)}` : ""}`);
  }
  if (!text) return;
  const payload = safeJson(text);
  const errors = Array.isArray((payload as { errors?: unknown }).errors)
    ? (payload as { errors: unknown[] }).errors
    : [];
  if (errors.length > 0) {
    throw new Error(`Langfuse ingestion returned ${errors.length} error(s): ${truncateForError(JSON.stringify(errors))}`);
  }
};

export const uploadOtelPayload = async (input: { endpoint: string; payload: OtelSyncPayload }): Promise<void> => {
  const endpoint = stripTrailingSlashes(input.endpoint);
  await postOtelJson(`${endpoint}/v1/traces`, input.payload.traces);
  await postOtelJson(`${endpoint}/v1/metrics`, input.payload.metrics);
  await postOtelJson(`${endpoint}/v1/logs`, input.payload.logs);
};

export const observabilitySyncStateFilePath = (stateDir: string, target: string, assetId: string): string =>
  join(stateDir, "observability-sync", target, `${shortHash(assetId)}.json`);

export const readObservabilitySyncState = async (
  stateDir: string,
  target: string,
  assetId: string,
): Promise<ObservabilitySyncState | undefined> => {
  try {
    const content = await readFile(observabilitySyncStateFilePath(stateDir, target, assetId), "utf8");
    return JSON.parse(content) as ObservabilitySyncState;
  } catch (cause) {
    if ((cause as { code?: string }).code === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
};

export const writeObservabilitySyncState = async (
  stateDir: string,
  target: string,
  assetId: string,
  state: ObservabilitySyncState,
): Promise<void> => {
  const path = observabilitySyncStateFilePath(stateDir, target, assetId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const stableAssetId = (deviceId: string, projectId: string, sessionId: string): string =>
  `scorel-session:${deviceId}:${projectId}:${sessionId}`;

const postOtelJson = async (url: string, body: unknown): Promise<void> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OTLP HTTP export failed: ${response.status} ${response.statusText}${text ? ` ${truncateForError(text)}` : ""}`);
  }
};

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, "");

const safeJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const truncateForError = (value: string): string =>
  value.length <= 500 ? value : `${value.slice(0, 500)}...`;

const stableLangfuseId = (...parts: string[]): string => `${parts[0]}-${shortHash(parts.slice(1).join(":"))}`;

const revisionEnvelopeId = (kind: string, bodyId: string, revision: string): string =>
  `${kind}-${shortHash(`${bodyId}:${revision}`)}`;

const shortHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 24);

const stableOtelHex = (...parts: Array<string | number>): string => {
  const width = Number(parts.at(-1));
  const hashParts = typeof width === "number" && Number.isInteger(width) ? parts.slice(0, -1) : parts;
  const length = typeof width === "number" && Number.isInteger(width) ? width : 16;
  return createHash("sha256").update(hashParts.join(":")).digest("hex").slice(0, length);
};

const isoFromMillis = (value: number): string => new Date(value).toISOString();

const unixNanoFromMillis = (value: number): string => `${Math.trunc(value) * 1_000_000}`;

type LangfuseTurn = {
  user: Extract<PersistentEvent, { type: "user_message" }>;
  events: PersistentEvent[];
};

const langfuseTurns = (events: PersistentEvent[]): LangfuseTurn[] => {
  const turns: LangfuseTurn[] = [];
  for (const event of events) {
    if (event.type === "user_message") {
      turns.push({ user: event, events: [event] });
      continue;
    }
    const current = turns.at(-1);
    if (current) {
      current.events.push(event);
    }
  }
  return turns;
};

const messageInput = (event: Extract<PersistentEvent, { type: "user_message" }>): { role: "user"; content: string } => ({
  role: "user",
  content: displayMessageText(event.message.content),
});

const turnInputMessages = (event: Extract<PersistentEvent, { type: "user_message" }>): Array<{ role: "user"; content: string }> => [
  messageInput(event),
];

const turnOutput = (turn: LangfuseTurn): string | undefined => {
  const text = turn.events
    .filter((event): event is Extract<PersistentEvent, { type: "assistant_message" }> => event.type === "assistant_message")
    .map((event) => displayMessageText(event.message.content))
    .filter(Boolean)
    .join("\n\n");
  return text || undefined;
};

const langfuseTags = (asset: ObservationAsset): string[] => [
  "scorel",
  "scorel.chat",
  ...(asset.summary.model?.provider ? [`provider:${asset.summary.model.provider}`] : []),
  ...(asset.summary.model?.modelId ? [`model:${asset.summary.model.modelId}`] : []),
].filter((tag) => tag.length <= 200);

const scorelRelease = (): string | undefined =>
  stringValue(process.env.SCOREL_RELEASE) ?? stringValue(process.env.npm_package_version);

const usageDetailsFromUsage = (usage: Usage | undefined): { input: number; output: number; cache_read: number; cache_write: number; total: number } => {
  const normalized = normalizeUsage(usage);
  return {
    input: normalized.inputTokens,
    output: normalized.outputTokens,
    cache_read: normalized.cacheReadTokens,
    cache_write: normalized.cacheWriteTokens,
    total: normalized.totalTokens,
  };
};

const costDetailsFromSummary = (asset: ObservationAsset, usage: Usage | undefined): { input: number; output: number; total: number } | undefined => {
  if (!asset.summary.cost.known) {
    return undefined;
  }
  const normalized = normalizeUsage(usage);
  const summaryUsage = asset.summary.usage;
  const input = prorateCost(asset.summary.cost.input, normalized.inputTokens, summaryUsage.inputTokens);
  const output = prorateCost(asset.summary.cost.output, normalized.outputTokens, summaryUsage.outputTokens);
  const total = input + output;
  return { input, output, total };
};

const prorateCost = (cost: number, part: number, total: number): number =>
  total > 0 ? Number(((cost * part) / total).toFixed(12)) : 0;

const toolCallsFromContent = (content: ContentBlock[]): Array<{ id: string; name: string; args: unknown }> =>
  content
    .filter((block): block is ToolCallContentBlock => block.type === "tool_call")
    .map((block) => ({ id: block.toolCallId, name: block.toolName, args: safeObservationValue(block.args) }));

const toolResultBlock = (content: ContentBlock[]): ToolResultContentBlock | undefined =>
  content.find((block): block is ToolResultContentBlock => block.type === "tool_result");

const matchingToolCallInput = (event: Extract<PersistentEvent, { type: "tool_result" }>, events: PersistentEvent[]): unknown => {
  const result = toolResultBlock(event.message.content);
  if (!result) {
    return undefined;
  }
  for (const candidate of events) {
    if (candidate.type !== "assistant_message") {
      continue;
    }
    const call = candidate.message.content.find(
      (block): block is ToolCallContentBlock => block.type === "tool_call" && block.toolCallId === result.toolCallId,
    );
    if (call) {
      return safeObservationValue(call.args);
    }
  }
  return undefined;
};

const parentGenerationId = (
  event: PersistentEvent,
  generationParents: Map<string, string>,
  eventsById: Map<string, PersistentEvent>,
): string | undefined => {
  let parentId = event.parentId ? String(event.parentId) : undefined;
  while (parentId) {
    const generationId = generationParents.get(parentId);
    if (generationId) {
      return generationId;
    }
    parentId = eventsById.get(parentId)?.parentId ? String(eventsById.get(parentId)?.parentId) : undefined;
  }
  return undefined;
};

const safeObservationValue = (value: unknown): unknown => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text || text.length <= 4_000) {
    return value;
  }
  return {
    truncated: true,
    characters: text.length,
    preview: text.slice(0, 4_000),
  };
};

const otelResourceAttributes = (asset: ObservationAsset): OtelAttribute[] => [
  stringAttribute("service.name", "scorel"),
  stringAttribute("scorel.device_id", asset.deviceId),
  stringAttribute("scorel.project_id", asset.projectId),
  stringAttribute("scorel.session_id", asset.sessionId),
];

const otelEventAttributes = (event: PersistentEvent): OtelAttribute[] => [
  stringAttribute("scorel.event_id", String(event.id)),
  stringAttribute("scorel.event_type", event.type),
  intAttribute("scorel.seq", Number(event.seq)),
  stringAttribute("scorel.session_id", String(event.sessionId)),
  ...(event.type === "assistant_message"
    ? [
      intAttribute("scorel.usage.input_tokens", normalizeUsage(event.message.usage).inputTokens),
      intAttribute("scorel.usage.output_tokens", normalizeUsage(event.message.usage).outputTokens),
      intAttribute("scorel.usage.cache_read_tokens", normalizeUsage(event.message.usage).cacheReadTokens),
      intAttribute("scorel.usage.cache_write_tokens", normalizeUsage(event.message.usage).cacheWriteTokens),
      intAttribute("scorel.usage.total_tokens", normalizeUsage(event.message.usage).totalTokens),
    ]
    : []),
  ...(event.type === "tool_result"
    ? [boolAttribute("scorel.tool.is_error", toolResultIsError(event))]
    : []),
].filter((attribute) => attribute.value.stringValue !== "" && attribute.value.intValue !== "");

const otelSpanKind = (event: PersistentEvent): number => event.type === "tool_result" ? 3 : 1;

const toolResultIsError = (event: Extract<PersistentEvent, { type: "tool_result" }>): boolean => {
  const toolBlock = Array.isArray(event.message.content)
    ? event.message.content.find((block) => block.type === "tool_result")
    : undefined;
  return toolBlock?.type === "tool_result" ? toolBlock.isError === true : false;
};

const tokenDataPoint = (kind: string, value: number, timeUnixNano: string, assetId: string): OtelMetric["sum"]["dataPoints"][number] => ({
  timeUnixNano,
  asInt: String(value),
  attributes: [
    stringAttribute("scorel.asset_id", assetId),
    stringAttribute("scorel.token.kind", kind),
  ],
});

const stringAttribute = (key: string, value: string | undefined): OtelAttribute => ({
  key,
  value: { stringValue: value ?? "" },
});

const intAttribute = (key: string, value: number | undefined): OtelAttribute => ({
  key,
  value: { intValue: String(nonNegativeInteger(value)) },
});

const boolAttribute = (key: string, value: boolean): OtelAttribute => ({
  key,
  value: { boolValue: value },
});

const addUsage = (total: Required<Usage>, usage: Usage | undefined): void => {
  total.inputTokens += nonNegativeInteger(usage?.inputTokens);
  total.outputTokens += nonNegativeInteger(usage?.outputTokens);
  total.cacheReadTokens += nonNegativeInteger(usage?.cacheReadTokens);
  total.cacheWriteTokens += nonNegativeInteger(usage?.cacheWriteTokens);
  const totalTokens = nonNegativeInteger(usage?.totalTokens);
  total.totalTokens += totalTokens > 0
    ? totalTokens
    : nonNegativeInteger(usage?.inputTokens) + nonNegativeInteger(usage?.cacheReadTokens)
      + nonNegativeInteger(usage?.cacheWriteTokens) + nonNegativeInteger(usage?.outputTokens);
};

const normalizeUsage = (usage: Usage | undefined): Required<Usage> => {
  const normalized = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
  addUsage(normalized, usage);
  return normalized;
};

const nonNegativeInteger = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const displayMessageText = (content: ContentBlock[]): string =>
  content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n");

const messageText = (content: ScorelEvent extends never ? never : unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      if ("text" in block && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
};
