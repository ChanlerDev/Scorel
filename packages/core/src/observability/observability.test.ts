import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { asClientId, asDeviceId, asEventId, asProjectId, asSeq, asSessionId } from "@scorel/protocol";

import { buildLangfuseSyncPayload, buildObservationAsset, buildOtelDeltaPayload, readObservabilitySyncState, writeObservabilitySyncState } from "./index.js";
import { createSession } from "../session/index.js";

const sessionId = asSessionId("ses_observe");
const deviceId = asDeviceId("device_observe");
const projectId = asProjectId("project_observe");
const clientId = asClientId("client_observe");

const tempRoot = () => mkdtemp(join(tmpdir(), "scorel-observability-"));

describe("observability sync assets", () => {
  it("maps Langfuse payloads to session-grouped turn traces with generation details", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta: {
          projectId,
          selectedModel: {
            modelId: "gpt-4o-mini",
            providerId: "openai",
            provider: "openai",
            id: "gpt-4o-mini",
            displayName: "GPT-4o mini",
          },
        },
      },
    });

    await session.append({
      type: "user_message",
      id: asEventId("evt_user_1"),
      parentId: null,
      seq: asSeq(1),
      sessionId,
      clientId,
      ts: 1_001,
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });
    await session.append({
      type: "assistant_message",
      id: asEventId("evt_assistant_1"),
      parentId: asEventId("evt_user_1"),
      seq: asSeq(2),
      sessionId,
      clientId,
      ts: 1_002,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 25, cacheWriteTokens: 5, totalTokens: 180 },
        meta: { model: "gpt-4o-mini", provider: "openai", api: "openai-completions" },
      },
    });

    const firstPayload = buildLangfuseSyncPayload(buildObservationAsset(session));
    const firstTraceCreates = firstPayload.batch.filter((event) => event.type === "trace-create");
    const firstTraceCreate = firstTraceCreates[0];
    const firstGenerationCreate = firstPayload.batch.find((event) => event.type === "generation-create");

    expect(firstPayload.traceIds).toHaveLength(1);
    expect(firstTraceCreate?.body).toMatchObject({
      id: firstPayload.traceIds[0],
      name: "scorel.chat.turn 1",
      sessionId,
      input: { role: "user", content: "hello" },
      output: "hi",
      tags: ["scorel", "scorel.chat", "provider:openai", "model:gpt-4o-mini"],
      environment: "development",
    });
    expect(firstGenerationCreate?.body).toMatchObject({
      traceId: firstPayload.traceIds[0],
      name: "llm.generate",
      input: [{ role: "user", content: "hello" }],
      output: "hi",
      model: "gpt-4o-mini",
      usageDetails: { input: 100, output: 50, cache_read: 25, cache_write: 5, total: 180 },
      costDetails: expect.any(Object),
      environment: "development",
    });
    expect(firstGenerationCreate?.body).not.toHaveProperty("usage");

    await session.append({
      type: "user_message",
      id: asEventId("evt_user_2"),
      parentId: asEventId("evt_assistant_1"),
      seq: asSeq(3),
      sessionId,
      clientId,
      ts: 1_003,
      message: { role: "user", content: [{ type: "text", text: "again" }] },
    });
    await session.append({
      type: "assistant_message",
      id: asEventId("evt_assistant_2"),
      parentId: asEventId("evt_user_2"),
      seq: asSeq(4),
      sessionId,
      clientId,
      ts: 1_004,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "second" }],
        usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
        meta: { model: "gpt-4o-mini", provider: "openai", api: "openai-completions" },
      },
    });

    const secondPayload = buildLangfuseSyncPayload(buildObservationAsset(session));
    const secondTraceCreates = secondPayload.batch.filter((event) => event.type === "trace-create");
    const secondFirstTraceCreate = secondTraceCreates[0];
    const secondGenerationCreates = secondPayload.batch.filter((event) => event.type === "generation-create");

    expect(secondPayload.assetId).toBe(firstPayload.assetId);
    expect(secondPayload.revision).not.toBe(firstPayload.revision);
    expect(secondPayload.traceIds).toHaveLength(2);
    expect(secondPayload.traceIds[0]).toBe(firstPayload.traceIds[0]);
    expect(secondFirstTraceCreate?.body.id).toBe(firstTraceCreate?.body.id);
    expect(secondFirstTraceCreate?.id).not.toBe(firstTraceCreate?.id);
    expect(secondGenerationCreates[0]?.body.id).toBe(firstGenerationCreate?.body.id);
    expect(secondTraceCreates[1]?.body).toMatchObject({
      name: "scorel.chat.turn 2",
      input: { role: "user", content: "again" },
      output: "second",
    });
  });

  it("maps tool results to Langfuse tool observations under the active turn", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta: { projectId },
      },
    });

    await session.append({
      type: "user_message",
      id: asEventId("evt_user_tool"),
      parentId: null,
      seq: asSeq(1),
      sessionId,
      clientId,
      ts: 1_001,
      message: { role: "user", content: [{ type: "text", text: "read package" }] },
    });
    await session.append({
      type: "assistant_message",
      id: asEventId("evt_assistant_tool_call"),
      parentId: asEventId("evt_user_tool"),
      seq: asSeq(2),
      sessionId,
      clientId,
      ts: 1_002,
      message: {
        role: "assistant",
        content: [{ type: "tool_call", toolCallId: "call_read", toolName: "Read", args: { path: "package.json" } }],
        stopReason: "tool_call",
      },
    });
    await session.append({
      type: "tool_result",
      id: asEventId("evt_tool_result"),
      parentId: asEventId("evt_assistant_tool_call"),
      seq: asSeq(3),
      sessionId,
      clientId,
      ts: 1_003,
      message: {
        role: "tool_result",
        content: [{ type: "tool_result", toolCallId: "call_read", toolName: "Read", result: { ok: true, bytes: 42 } }],
      },
    });
    await session.append({
      type: "assistant_message",
      id: asEventId("evt_assistant_final"),
      parentId: asEventId("evt_tool_result"),
      seq: asSeq(4),
      sessionId,
      clientId,
      ts: 1_004,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "package read" }],
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 3 },
      },
    });

    const payload = buildLangfuseSyncPayload(buildObservationAsset(session));
    const toolObservation = payload.batch.find((event) => event.type === "observation-create" && event.body.type === "TOOL");
    const generation = payload.batch.find((event) => event.type === "generation-create");

    expect(toolObservation?.body).toMatchObject({
      traceId: payload.traceIds[0],
      parentObservationId: generation?.body.id,
      name: "tool.Read",
      input: { path: "package.json" },
      output: { ok: true, bytes: 42 },
      level: "DEFAULT",
    });
  });

  it("builds OpenTelemetry deltas from the last exported seq checkpoint", async () => {
    const sessionsDir = await tempRoot();
    const stateDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta: { projectId },
      },
    });
    await session.append({
      type: "user_message",
      id: asEventId("evt_user_1"),
      parentId: null,
      seq: asSeq(1),
      sessionId,
      clientId,
      ts: 1_001,
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });
    await session.append({
      type: "assistant_message",
      id: asEventId("evt_assistant_1"),
      parentId: asEventId("evt_user_1"),
      seq: asSeq(2),
      sessionId,
      clientId,
      ts: 1_002,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 3 },
      },
    });

    const asset = buildObservationAsset(session);
    const firstDelta = buildOtelDeltaPayload(asset, { target: "otel", assetId: asset.assetId, lastExportedSeq: 0 });
    expect(firstDelta.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(firstDelta.metrics).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 7,
      cacheWriteTokens: 3,
      totalTokens: 25,
      eventCount: 2,
    });
    await writeObservabilitySyncState(stateDir, "otel", asset.assetId, firstDelta.nextState);

    const state = await readObservabilitySyncState(stateDir, "otel", asset.assetId);
    const secondDelta = buildOtelDeltaPayload(asset, state);
    expect(secondDelta.events).toEqual([]);
    expect(secondDelta.metrics).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      eventCount: 0,
    });
  });

  it("represents OpenTelemetry deltas as traces, metrics, and logs without raw message content", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta: { projectId },
      },
    });
    await session.append({
      type: "user_message",
      id: asEventId("evt_user_secret"),
      parentId: null,
      seq: asSeq(1),
      sessionId,
      clientId,
      ts: 1_001,
      message: { role: "user", content: [{ type: "text", text: "secret prompt" }] },
    });
    await session.append({
      type: "assistant_message",
      id: asEventId("evt_assistant_secret"),
      parentId: asEventId("evt_user_secret"),
      seq: asSeq(2),
      sessionId,
      clientId,
      ts: 1_002,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "secret answer" }],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    });

    const payload = buildOtelDeltaPayload(buildObservationAsset(session), undefined);

    expect(payload.otlp.traces.resourceSpans[0]?.scopeSpans[0]?.spans.map((span) => span.name)).toEqual([
      "scorel.session",
      "scorel.user_message",
      "scorel.assistant_message",
    ]);
    expect(payload.otlp.metrics.resourceMetrics[0]?.scopeMetrics[0]?.metrics.map((metric) => metric.name)).toEqual([
      "scorel.session.events",
      "scorel.assistant.tokens",
    ]);
    expect(payload.otlp.logs.resourceLogs[0]?.scopeLogs[0]?.logRecords.map((record) => record.body.stringValue)).toEqual([
      "user_message",
      "assistant_message",
    ]);
    expect(JSON.stringify(payload.otlp)).not.toContain("secret prompt");
    expect(JSON.stringify(payload.otlp)).not.toContain("secret answer");
  });
});
