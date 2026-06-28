import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { cliAppName, cliClientDependency, cliDaemonDependency, createSigintHandler, runCli } from "@scorel/app-cli";
import {
  ScorelHost,
  createLocalDaemonState,
  startScorelHostWebSocketServer,
  startRemoteDaemonWebSocketServer,
  type RemoteDaemonWebSocketConnection,
  type ScorelConfig,
} from "@scorel/daemon";
import { asClientId, asDeviceId, asEventId, asProjectId, asSeq, asSessionId } from "@scorel/protocol";

describe("@scorel/app-cli", () => {
  it("is an entrypoint shell over client/daemon", () => {
    expect(cliAppName).toBe("@scorel/app-cli");
    expect(cliClientDependency).toBe("@scorel/client");
    expect(cliDaemonDependency).toBe("@scorel/daemon");
  });

  it("cancels on SIGINT during an in-flight turn and exits on idle SIGINT", async () => {
    const output = new StringWritable();
    let inFlight = true;
    let cancelCalls = 0;
    let exitCalls = 0;
    const handler = createSigintHandler({
      isInFlight: () => inFlight,
      cancel: async () => {
        cancelCalls += 1;
      },
      output,
      exit: () => {
        exitCalls += 1;
      },
    });

    handler();
    expect(cancelCalls).toBe(1);
    expect(exitCalls).toBe(0);
    expect(output.toString()).toContain("[cancelled]");

    inFlight = false;
    handler();
    expect(cancelCalls).toBe(1);
    expect(exitCalls).toBe(1);
  });

  it("swallows cancel rejections so SIGINT never crashes the REPL", async () => {
    const output = new StringWritable();
    let exitCalls = 0;
    const handler = createSigintHandler({
      isInFlight: () => true,
      cancel: () => Promise.reject(new Error("daemon disconnected")),
      output,
      exit: () => {
        exitCalls += 1;
      },
    });

    handler();
    // Allow any microtasks to settle without throwing.
    await Promise.resolve();
    await Promise.resolve();
    expect(exitCalls).toBe(0);
    expect(output.toString()).toContain("[cancelled]");
  });

  it("daemon status reports not configured when there is no state file", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-cli-state-"));
    const result = await runCliWithInput(["daemon", "status"], "", testConfig("http://127.0.0.1:1"), sessionsDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("scorel daemon not configured");
  });

  it("host status routes through the local Host command surface", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-cli-host-state-"));
    const result = await runCliWithInput(["host", "status"], "", testConfig("http://127.0.0.1:1"), sessionsDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("scorel daemon not configured");
  });

  it("attach requires a remote URL since the local-socket path was retired", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-cli-attach-"));
    const result = await runCliWithInput(["attach", "--session", "ses_missing"], "", testConfig("http://127.0.0.1:1"), sessionsDir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--remote is required");
  });

  it("prints a local session diagnostics log with tail support", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-cli-logs-"));
    await writeFile(
      join(sessionsDir, "ses_logs.log"),
      [
        "ts=1 level=info event=session_created sessionId=ses_logs",
        "ts=2 level=info event=send_message_started sessionId=ses_logs",
        "ts=3 level=error event=provider_request_failed sessionId=ses_logs message=\"boom\"",
      ].join("\n") + "\n",
    );

    const result = await runCliWithInput(["logs", "--session", "ses_logs", "--tail", "2"], "", testConfig("http://127.0.0.1:1"), sessionsDir);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("session_created");
    expect(result.stdout).toContain("send_message_started");
    expect(result.stdout).toContain("provider_request_failed");
  });

  it("manages the local Host project registry over WebSocket", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-project-command-"));
    const sessionsDir = join(stateDir, "sessions");
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-project-command-workspace-"));
    const host = new ScorelHost({
      sessionsDir,
      projectsPath: join(stateDir, "projects.json"),
      deviceId: asDeviceId("device_project_command"),
      createRuntime: async () => {
        throw new Error("project commands must not create runtimes");
      },
    });
    await host.start();
    const server = await startScorelHostWebSocketServer({
      hostService: host,
      host: "127.0.0.1",
      port: 0,
      token: "project-command-secret",
    });
    await createLocalDaemonState({
      stateDir,
      host: server.host,
      port: server.port,
      wsUrl: server.url,
      token: "project-command-secret",
      pid: process.pid,
      startedAt: Date.now(),
      stoppedAt: null,
    });

    try {
      const added = await runCliWithInput(["project", "add", workspaceDir], "", testConfig("http://127.0.0.1:1"), sessionsDir);
      expect(added.code).toBe(0);
      const [projectId] = added.stdout.trim().split("\t");
      expect(projectId).toMatch(/^prj_/);

      const listed = await runCliWithInput(["project", "list"], "", testConfig("http://127.0.0.1:1"), sessionsDir);
      expect(listed.code).toBe(0);
      expect(listed.stdout).toContain(`${projectId}\t${basename(workspaceDir)}\t${await realpath(workspaceDir)}`);

      const removed = await runCliWithInput(["project", "remove", projectId], "", testConfig("http://127.0.0.1:1"), sessionsDir);
      expect(removed).toMatchObject({ code: 0, stdout: `removed ${projectId}\n` });
    } finally {
      await server.close();
      await host.shutdown();
    }
  });

  it("registers local chat projects by canonical workdir", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-project-registry-"));
    const sessionsDir = join(stateDir, "sessions");
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-workspace-index-"));
    const server = await startChatServer([{ content: "Indexed local project.", tool_calls: [] }]);

    try {
      const result = await runCliWithInput(
        ["chat", "--session", "ses_local_project_index", "--cwd", workspaceDir],
        "index this project\n.exit\n",
        testConfig(server.baseURL),
        sessionsDir,
      );

      expect(result.code, result.stderr).toBe(0);
      const canonicalWorkDir = await realpath(workspaceDir);
      const registry = JSON.parse(await readFile(join(stateDir, "projects.json"), "utf8")) as { version: 1; projects: Array<{ projectId: string; displayName: string; workDir: string }> };
      expect(registry.version).toBe(1);
      expect(registry.projects).toHaveLength(1);
      expect(registry.projects[0]).toMatchObject({
        projectId: expect.stringMatching(/^prj_/),
        workDir: canonicalWorkDir,
        displayName: basename(canonicalWorkDir),
      });
    } finally {
      await server.close();
    }
  });

  it("runs interactive chat when scorel has no subcommand", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-default-command-"));
    const sessionsDir = join(stateDir, "sessions");
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-default-command-workspace-"));
    const server = await startChatServer([{ content: "Default command response.", tool_calls: [] }]);

    try {
      const result = await runCliWithCwd(
        [],
        "hello from default command\n.exit\n",
        testConfig(server.baseURL),
        sessionsDir,
        workspaceDir,
      );

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("Default command response.");
      const registry = JSON.parse(await readFile(join(stateDir, "projects.json"), "utf8")) as { projects: Array<{ workDir: string }> };
      expect(registry.projects[0]?.workDir).toBe(await realpath(workspaceDir));
    } finally {
      await server.close();
    }
  });

  it("runs a non-interactive prompt and writes summary json", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-run-"));
    const sessionsDir = join(stateDir, "sessions");
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-run-workspace-"));
    const summaryPath = join(stateDir, "scorel-summary.json");
    const server = await startChatServer([{ content: "Run command response.", tool_calls: [] }]);

    try {
      const result = await runCliWithInput(
        [
          "run",
          "--prompt",
          "complete one task",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_run_test",
          "--output-format",
          "json",
          "--summary",
          summaryPath,
        ],
        "",
        testConfig(server.baseURL),
        sessionsDir,
      );

      expect(result.code, result.stderr).toBe(0);
      const stdout = JSON.parse(result.stdout) as { status: string; result: string; sessionJsonl: string };
      expect(stdout).toMatchObject({
        status: "completed",
        result: "Run command response.",
        sessionJsonl: join(sessionsDir, "ses_run_test.jsonl"),
      });
      const summary = JSON.parse(await readFile(summaryPath, "utf8")) as { status: string; sessionId: string; cwd: string; sessionJsonl: string };
      expect(summary).toMatchObject({
        status: "completed",
        sessionId: "ses_run_test",
        cwd: workspaceDir,
        sessionJsonl: join(sessionsDir, "ses_run_test.jsonl"),
      });
      const jsonl = await readFile(join(sessionsDir, "ses_run_test.jsonl"), "utf8");
      expect(jsonl).toContain("complete one task");
      expect(jsonl).toContain("Run command response.");
    } finally {
      await server.close();
    }
  });

  it("writes run reporting usage, cost, metadata, events, and trajectory without leaking api keys", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-run-reporting-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-run-reporting-workspace-"));
    const reportDir = join(stateDir, "report");
    const summaryPath = join(stateDir, "custom-summary.json");
    const server = await startChatServer([
      {
        content: "Reporting response.",
        tool_calls: [],
        usage: { prompt_tokens: 1200, completion_tokens: 800, total_tokens: 2000 },
      },
    ]);

    try {
      const result = await runCliWithInput(
        [
          "run",
          "--prompt",
          "collect reporting",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_run_reporting",
          "--api",
          "openai-completions",
          "--base-url",
          server.baseURL,
          "--api-key",
          "direct-secret-reporting",
          "--model",
          "gpt-4o-mini",
          "--output-format",
          "none",
          "--summary",
          summaryPath,
          "--report-dir",
          reportDir,
        ],
        "",
        undefined,
        join(stateDir, "sessions"),
      );

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toBe("");
      const summaryText = await readFile(summaryPath, "utf8");
      const reportSummaryText = await readFile(join(reportDir, "scorel-summary.json"), "utf8");
      const eventsText = await readFile(join(reportDir, "scorel-events.jsonl"), "utf8");
      const metadataText = await readFile(join(reportDir, "scorel-metadata.json"), "utf8");
      const trajectoryText = await readFile(join(reportDir, "scorel-trajectory.json"), "utf8");
      const combinedReportText = [summaryText, reportSummaryText, eventsText, metadataText, trajectoryText].join("\n");
      expect(combinedReportText).not.toContain("direct-secret-reporting");

      const summary = JSON.parse(summaryText) as {
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
        model?: { modelId?: string; providerModelId?: string; provider?: string; api?: string };
        cost?: {
          known?: boolean;
          input?: number;
          output?: number;
          total?: number;
          currency?: string;
          pricingSource?: string;
          pricingModelId?: string;
        };
        reports?: Record<string, string>;
      };
      expect(summary.usage).toEqual({ inputTokens: 1200, outputTokens: 800, totalTokens: 2000 });
      expect(summary.model).toMatchObject({
        modelId: "gpt-4o-mini",
        providerModelId: "gpt-4o-mini",
        provider: "openai",
        api: "openai-completions",
      });
      expect(summary.cost).toMatchObject({
        known: true,
        currency: "USD",
        pricingSource: "models.dev-api-2026-06-27",
        pricingModelId: "gpt-4o-mini",
      });
      expect(summary.cost?.total).toBeGreaterThan(0);
      expect(summary.reports).toMatchObject({
        summary: join(reportDir, "scorel-summary.json"),
        events: join(reportDir, "scorel-events.jsonl"),
        trajectory: join(reportDir, "scorel-trajectory.json"),
        metadata: join(reportDir, "scorel-metadata.json"),
        sessionJsonl: join(stateDir, "sessions", "ses_run_reporting.jsonl"),
        sessionSummary: join(stateDir, "sessions", "ses_run_reporting.summary.json"),
        diagnosticsLog: join(stateDir, "sessions", "ses_run_reporting.log"),
        sessionFilesDir: join(stateDir, "sessions", "ses_run_reporting.artifacts"),
      });
      expect(eventsText.trim().split("\n").some((line) => JSON.parse(line).type === "assistant_message")).toBe(true);
      expect(JSON.parse(metadataText)).toMatchObject({
        usage: { inputTokens: 1200, outputTokens: 800, totalTokens: 2000 },
        cost: { known: true },
      });
      expect(JSON.parse(trajectoryText)).toMatchObject({
        format: "scorel-run-trajectory-v1",
        sessionId: "ses_run_reporting",
      });
    } finally {
      await server.close();
    }
  });

  it("writes a Langfuse observe sync payload with stable trace ids", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-observe-langfuse-"));
    const sessionsDir = join(stateDir, "sessions");
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-observe-langfuse-workspace-"));
    const outPath = join(stateDir, "langfuse.json");
    const server = await startChatServer([
      {
        content: "Observable response.",
        tool_calls: [],
        usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 },
      },
    ]);

    try {
      const run = await runCliWithInput(
        [
          "run",
          "--prompt",
          "observe this",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_observe_cli",
          "--api",
          "openai-completions",
          "--base-url",
          server.baseURL,
          "--api-key",
          "direct-secret-observe",
          "--model",
          "gpt-4o-mini",
          "--output-format",
          "none",
        ],
        "",
        undefined,
        sessionsDir,
      );
      expect(run.code, run.stderr).toBe(0);

      const observed = await runCliWithInput(
        ["observe", "sync", "--session", "ses_observe_cli", "--target", "langfuse", "--state-dir", stateDir, "--out", outPath],
        "",
        undefined,
        sessionsDir,
      );

      expect(observed.code, observed.stderr).toBe(0);
      expect(observed.stdout).toContain("target=langfuse");
      const payload = JSON.parse(await readFile(outPath, "utf8")) as {
        target?: string;
        traceIds?: string[];
        batch?: Array<{ type?: string; body?: { id?: string; sessionId?: string; input?: unknown; output?: unknown; usageDetails?: unknown } }>;
      };
      expect(payload.target).toBe("langfuse");
      expect(payload.traceIds?.[0]).toContain("scorel-turn");
      expect(payload.batch?.find((event) => event.type === "trace-create")?.body?.id).toBe(payload.traceIds?.[0]);
      expect(payload.batch?.find((event) => event.type === "trace-create")?.body?.input).toMatchObject({ role: "user", content: "observe this" });
      expect(payload.batch?.find((event) => event.type === "trace-create")?.body?.output).toBe("Observable response.");
      expect(payload.batch?.find((event) => event.type === "generation-create")?.body?.sessionId).toBe("ses_observe_cli");
      expect(payload.batch?.find((event) => event.type === "generation-create")?.body?.usageDetails).toMatchObject({ input: 21, output: 8, total: 29 });
      expect(JSON.stringify(payload)).not.toContain("direct-secret-observe");
    } finally {
      await server.close();
    }
  });

  it("uploads Langfuse observe sync payloads when credentials are configured", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-observe-langfuse-upload-"));
    const sessionsDir = join(stateDir, "sessions");
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-observe-langfuse-upload-workspace-"));
    const chatServer = await startChatServer([
      {
        content: "Uploaded observable response.",
        tool_calls: [],
        usage: { prompt_tokens: 18, completion_tokens: 9, total_tokens: 27 },
      },
    ]);
    const langfuseServer = await startLangfuseServer();

    try {
      const config = {
        ...testConfig(chatServer.baseURL),
        observability: {
          local: true,
          sync: { enabled: true, mode: "manual" as const, targets: ["langfuse" as const] },
          langfuse: {
            enabled: true,
            host: langfuseServer.baseURL,
            publicKey: "pk-lf-test",
            secretKey: "sk-lf-test",
          },
          otel: { enabled: false, protocol: "otlp-http" as const },
        },
      };
      const run = await runCliWithInput(
        [
          "run",
          "--prompt",
          "upload observe",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_observe_langfuse_upload",
          "--api",
          "openai-completions",
          "--base-url",
          chatServer.baseURL,
          "--api-key",
          "direct-secret-observe",
          "--model",
          "gpt-4o-mini",
          "--output-format",
          "none",
        ],
        "",
        config,
        sessionsDir,
      );
      expect(run.code, run.stderr).toBe(0);

      const observed = await runCliWithInput(
        ["observe", "sync", "--session", "ses_observe_langfuse_upload", "--target", "langfuse", "--state-dir", stateDir],
        "",
        config,
        sessionsDir,
      );

      expect(observed.code, observed.stderr).toBe(0);
      expect(observed.stdout).toContain("target=langfuse");
      expect(observed.stdout).toContain("uploaded=true");
      expect(langfuseServer.requests).toHaveLength(1);
      expect(langfuseServer.requests[0]?.url).toBe("/api/public/ingestion");
      expect(langfuseServer.requests[0]?.authorization).toBe(`Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`);
      expect(langfuseServer.requests[0]?.body).toMatchObject({
        batch: expect.arrayContaining([
          expect.objectContaining({ type: "trace-create" }),
          expect.objectContaining({ type: "generation-create" }),
        ]),
      });
      expect(JSON.stringify(langfuseServer.requests[0]?.body)).not.toContain("direct-secret-observe");
    } finally {
      await chatServer.close();
      await langfuseServer.close();
    }
  });

  it("loads Langfuse credentials from the Scorel state config for observe sync", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-observe-langfuse-config-"));
    const sessionsDir = join(stateDir, "sessions");
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-observe-langfuse-config-workspace-"));
    const chatServer = await startChatServer([
      {
        content: "Config observable response.",
        tool_calls: [],
        usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
      },
    ]);
    const langfuseServer = await startLangfuseServer();

    try {
      const run = await runCliWithInput(
        [
          "run",
          "--prompt",
          "config observe",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_observe_langfuse_config",
          "--api",
          "openai-completions",
          "--base-url",
          chatServer.baseURL,
          "--api-key",
          "direct-secret-observe",
          "--model",
          "gpt-4o-mini",
          "--output-format",
          "none",
        ],
        "",
        testConfig(chatServer.baseURL),
        sessionsDir,
      );
      expect(run.code, run.stderr).toBe(0);
      await writeFile(join(stateDir, "config.toml"), langfuseConfigToml(chatServer.baseURL, langfuseServer.baseURL), "utf8");

      const observed = await runCliWithInput(
        ["observe", "sync", "--session", "ses_observe_langfuse_config", "--target", "langfuse", "--state-dir", stateDir],
        "",
        undefined,
        sessionsDir,
      );

      expect(observed.code, observed.stderr).toBe(0);
      expect(observed.stdout).toContain("uploaded=true");
      expect(langfuseServer.requests).toHaveLength(1);
    } finally {
      await chatServer.close();
      await langfuseServer.close();
    }
  });

  it("does not checkpoint OpenTelemetry inspect-only output", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-observe-otel-"));
    const sessionsDir = join(stateDir, "sessions");
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-observe-otel-workspace-"));
    const firstOut = join(stateDir, "otel-first.json");
    const secondOut = join(stateDir, "otel-second.json");
    const server = await startChatServer([
      {
        content: "OTel response.",
        tool_calls: [],
        usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
      },
    ]);

    try {
      const run = await runCliWithInput(
        [
          "run",
          "--prompt",
          "observe otel",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_observe_otel",
          "--api",
          "openai-completions",
          "--base-url",
          server.baseURL,
          "--api-key",
          "direct-secret-otel",
          "--model",
          "gpt-4o-mini",
          "--output-format",
          "none",
        ],
        "",
        undefined,
        sessionsDir,
      );
      expect(run.code, run.stderr).toBe(0);

      const first = await runCliWithInput(
        ["observe", "sync", "--session", "ses_observe_otel", "--target", "otel", "--state-dir", stateDir, "--out", firstOut],
        "",
        undefined,
        sessionsDir,
      );
      const second = await runCliWithInput(
        ["observe", "sync", "--session", "ses_observe_otel", "--target", "otel", "--state-dir", stateDir, "--out", secondOut],
        "",
        undefined,
        sessionsDir,
      );

      expect(first.code, first.stderr).toBe(0);
      expect(second.code, second.stderr).toBe(0);
      const firstPayload = JSON.parse(await readFile(firstOut, "utf8")) as { metrics?: { totalTokens?: number }; events?: unknown[] };
      const secondPayload = JSON.parse(await readFile(secondOut, "utf8")) as { metrics?: { totalTokens?: number }; events?: unknown[] };
      expect(firstPayload.metrics?.totalTokens).toBe(42);
      expect(firstPayload.events?.length).toBeGreaterThan(0);
      expect(secondPayload.metrics?.totalTokens).toBe(42);
      expect(secondPayload.events?.length).toBe(firstPayload.events?.length);
    } finally {
      await server.close();
    }
  });

  it("uploads OpenTelemetry observe sync payloads to OTLP HTTP endpoints when configured", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-observe-otel-upload-"));
    const sessionsDir = join(stateDir, "sessions");
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-observe-otel-upload-workspace-"));
    const chatServer = await startChatServer([
      {
        content: "OTLP response.",
        tool_calls: [],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      },
    ]);
    const otelServer = await startOtelServer();

    try {
      const config = {
        ...testConfig(chatServer.baseURL),
        observability: {
          local: true,
          sync: { enabled: true, mode: "manual" as const, targets: ["otel" as const] },
          langfuse: { enabled: false },
          otel: { enabled: true, endpoint: otelServer.baseURL, protocol: "otlp-http" as const },
        },
      };
      const run = await runCliWithInput(
        [
          "run",
          "--prompt",
          "observe otlp",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_observe_otel_upload",
          "--api",
          "openai-completions",
          "--base-url",
          chatServer.baseURL,
          "--api-key",
          "direct-secret-otel",
          "--model",
          "gpt-4o-mini",
          "--output-format",
          "none",
        ],
        "",
        config,
        sessionsDir,
      );
      expect(run.code, run.stderr).toBe(0);

      const observed = await runCliWithInput(
        ["observe", "sync", "--session", "ses_observe_otel_upload", "--target", "otel", "--state-dir", stateDir],
        "",
        config,
        sessionsDir,
      );

      expect(observed.code, observed.stderr).toBe(0);
      expect(observed.stdout).toContain("uploaded=true");
      expect(otelServer.requests.map((request) => request.url).sort()).toEqual([
        "/v1/logs",
        "/v1/metrics",
        "/v1/traces",
      ]);
      expect(JSON.stringify(otelServer.requests.map((request) => request.body))).toContain("scorel.session");
      expect(JSON.stringify(otelServer.requests.map((request) => request.body))).not.toContain("direct-secret-otel");

      const second = await runCliWithInput(
        ["observe", "sync", "--session", "ses_observe_otel_upload", "--target", "otel", "--state-dir", stateDir],
        "",
        config,
        sessionsDir,
      );

      expect(second.code, second.stderr).toBe(0);
      expect(second.stdout).toContain("events=0");
      expect(second.stdout).toContain("uploaded=false");
      expect(otelServer.requests).toHaveLength(3);
    } finally {
      await chatServer.close();
      await otelServer.close();
    }
  });

  it("runs with prompt file and output-format none", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-run-file-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-run-file-workspace-"));
    const promptPath = join(stateDir, "instruction.txt");
    await writeFile(promptPath, "read from file\n");
    const server = await startChatServer([{ content: "File response.", tool_calls: [] }]);

    try {
      const result = await runCliWithInput(
        [
          "run",
          "--prompt-file",
          promptPath,
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_run_file",
          "--output-format",
          "none",
        ],
        "",
        testConfig(server.baseURL),
        join(stateDir, "sessions"),
      );

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toBe("");
      const jsonl = await readFile(join(stateDir, "sessions", "ses_run_file.jsonl"), "utf8");
      expect(jsonl).toContain("read from file");
    } finally {
      await server.close();
    }
  });

  it("runs with stdin prompt and stream-json output", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-run-stdin-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-run-stdin-workspace-"));
    const server = await startChatServer([{ content: "Stdin response.", tool_calls: [] }]);

    try {
      const result = await runCliWithInput(
        [
          "run",
          "--stdin",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_run_stdin",
          "--output-format",
          "stream-json",
        ],
        "stdin instruction\n",
        testConfig(server.baseURL),
        join(stateDir, "sessions"),
      );

      expect(result.code, result.stderr).toBe(0);
      const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as { type: string; result?: string });
      expect(lines.some((line) => line.type === "event")).toBe(true);
      expect(lines.at(-1)).toMatchObject({ type: "result", result: "Stdin response." });
    } finally {
      await server.close();
    }
  });

  it("runs with provider settings supplied directly on the command", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-run-provider-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-run-provider-workspace-"));
    const server = await startChatServer([{ content: "Provider override response.", tool_calls: [] }]);

    try {
      const result = await runCliWithInput(
        [
          "run",
          "--prompt",
          "use direct provider",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_run_provider",
          "--api",
          "openai-completions",
          "--baseurl",
          server.baseURL,
          "--apikey",
          "direct-secret",
          "--model",
          "gpt-direct",
          "--output-format",
          "json",
        ],
        "",
        undefined,
        join(stateDir, "sessions"),
      );

      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: "completed", result: "Provider override response." });
      expect(server.requests[0]).toMatchObject({ model: "gpt-direct" });
    } finally {
      await server.close();
    }
  });

  it("returns a runtime error and writes full events when the provider stops with error", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-run-provider-error-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-run-provider-error-workspace-"));
    const summaryPath = join(stateDir, "summary.json");
    const server = await startErrorChatServer("content_filter");

    try {
      const result = await runCliWithInput(
        [
          "run",
          "--prompt",
          "trigger provider error",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_run_provider_error",
          "--output-format",
          "json",
          "--summary",
          summaryPath,
        ],
        "",
        testConfig(server.baseURL),
        join(stateDir, "sessions"),
      );

      expect(result.code).toBe(1);
      const stdout = JSON.parse(result.stdout) as { status: string; error?: { message?: string }; events?: Array<{ type: string }> };
      expect(stdout).toMatchObject({
        status: "error",
        error: { message: "Provider finish_reason: content_filter" },
      });
      expect(stdout.events?.some((event) => event.type === "assistant_message")).toBe(true);
      const summary = JSON.parse(await readFile(summaryPath, "utf8")) as { status: string; error?: { message?: string }; events?: Array<{ type: string }> };
      expect(summary).toMatchObject({
        status: "error",
        error: { message: "Provider finish_reason: content_filter" },
      });
      expect(summary.events?.some((event) => event.type === "assistant_message")).toBe(true);
      const log = await readFile(join(stateDir, "sessions", "ses_run_provider_error.log"), "utf8");
      expect(log).toContain("errorMessage=\"Provider finish_reason: content_filter\"");
    } finally {
      await server.close();
    }
  });

  it("rejects conflicting run prompt sources as usage errors", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-run-conflict-"));
    const result = await runCliWithInput(
      ["run", "positional prompt", "--prompt", "flag prompt"],
      "",
      testConfig("http://127.0.0.1:1"),
      join(stateDir, "sessions"),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("requires exactly one prompt source");
  });

  it("times out a non-interactive run and writes timeout summary", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-run-timeout-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-run-timeout-workspace-"));
    const summaryPath = join(stateDir, "summary.json");
    const server = await startSlowChatServer(100);

    try {
      const result = await runCliWithInput(
        [
          "run",
          "--prompt",
          "wait too long",
          "--cwd",
          workspaceDir,
          "--state-dir",
          stateDir,
          "--session",
          "ses_run_timeout",
          "--timeout-ms",
          "1",
          "--output-format",
          "json",
          "--summary",
          summaryPath,
        ],
        "",
        testConfig(server.baseURL),
        join(stateDir, "sessions"),
      );

      expect(result.code).toBe(124);
      const stdout = JSON.parse(result.stdout) as { status: string; exitReason: string };
      expect(stdout).toMatchObject({ status: "timeout", exitReason: "timeout" });
      const summary = JSON.parse(await readFile(summaryPath, "utf8")) as { status: string; exitReason: string; error?: { message?: string } };
      expect(summary).toMatchObject({ status: "timeout", exitReason: "timeout" });
      expect(summary.error?.message).toContain("timed out");
    } finally {
      await server.close();
    }
  });

  it("attaches to a remote daemon WebSocket endpoint with an explicit token", async () => {
    const messages: string[] = [];
    const server = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientMessage: (_connection, message) => {
        messages.push(message.type);
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_remote_attach"),
              activeLeafId: null,
              currentSeq: asSeq(0),
              meta: { projectId: asProjectId("prj_test") },
              events: [],
            },
          };
        }
        if (message.type === "resync_events") {
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data: { events: [], throughSeq: asSeq(0), mode: "stream_resume" as const },
          };
        }
        return undefined;
      },
    });

    try {
      const result = await runCliWithInput(
        ["attach", "--remote", server.url, "--token", "remote-secret", "--session", "ses_remote_attach"],
        ".exit\n",
        testConfig("http://127.0.0.1:1"),
        await mkdtemp(join(tmpdir(), "scorel-cli-remote-attach-")),
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("scorel attach resumed session ses_remote_attach");
      expect(messages).toContain("resync_events");
      expect(result.stdout).not.toContain("remote-secret");
      expect(result.stderr).not.toContain("remote-secret");
    } finally {
      await server.close();
    }
  });

  it("requires a token for remote attach", async () => {
    const result = await runCliWithInput(
      ["attach", "--remote", "ws://127.0.0.1:1", "--session", "ses_remote_attach"],
      "",
      testConfig("http://127.0.0.1:1"),
      await mkdtemp(join(tmpdir(), "scorel-cli-remote-attach-")),
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--token is required with --remote");
  });

  it("keeps remote attach subscribed to future session events from other clients", async () => {
    const connections: RemoteDaemonWebSocketConnection[] = [];
    const server = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientConnect: (connection, params) => {
        connections.push(connection);
        return { clientId: params.clientId, sessionId: params.sessionId, currentSeq: asSeq(0), deviceId: asDeviceId("device_test") };
      },
      onClientMessage: (_connection, message) => {
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_remote_watch"),
              activeLeafId: null,
              currentSeq: asSeq(0),
              meta: { projectId: asProjectId("prj_test") },
              events: [],
            },
          };
        }
        if (message.type === "resync_events") {
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data: { events: [], throughSeq: asSeq(0), mode: "stream_resume" as const },
          };
        }
        return undefined;
      },
    });
    const inputA = new PassThrough();
    const inputB = new PassThrough();

    try {
      const attachA = runCliWithStream(
        ["attach", "--remote", server.url, "--token", "remote-secret", "--session", "ses_remote_watch"],
        inputA,
        testConfig("http://127.0.0.1:1"),
        await mkdtemp(join(tmpdir(), "scorel-cli-remote-watch-")),
      );
      const attachB = runCliWithStream(
        ["attach", "--remote", server.url, "--token", "remote-secret", "--session", "ses_remote_watch"],
        inputB,
        testConfig("http://127.0.0.1:1"),
        await mkdtemp(join(tmpdir(), "scorel-cli-remote-watch-")),
      );
      await waitFor(() => connections.length >= 2, "two remote attach connections");
      await waitFor(() => attachA.stdout.toString().includes("scorel attach resumed session ses_remote_watch"), "attach A ready");
      await waitFor(() => attachB.stdout.toString().includes("scorel attach resumed session ses_remote_watch"), "attach B ready");

      for (const connection of connections) {
        connection.send({
          type: "event",
          event: {
            type: "text_delta",
            seq: asSeq(1),
            sessionId: asSessionId("ses_remote_watch"),
            clientId: asClientId("client_remote_test"),
            ts: 1,
            eventId: asEventId("evt_remote_test"),
            delta: "REMOTE_MULTI_CLIENT_OK",
          },
        });
      }
      await waitFor(() => attachA.stdout.toString().includes("REMOTE_MULTI_CLIENT_OK"), "attach A rendered remote event");
      await waitFor(() => attachB.stdout.toString().includes("REMOTE_MULTI_CLIENT_OK"), "attach B rendered remote event");
      inputA.end(".exit\n");
      inputB.end(".exit\n");

      await expect(attachA.result).resolves.toMatchObject({ code: 0 });
      await expect(attachB.result).resolves.toMatchObject({ code: 0 });
    } finally {
      inputA.destroy();
      inputB.destroy();
      await server.close();
    }
  }, 10_000);

  it("renders recovered persistent session events when remote attach resumes", async () => {
    const server = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientMessage: (_connection, message) => {
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_remote_recovered"),
              activeLeafId: asEventId("evt_assistant_recovered"),
              currentSeq: asSeq(2),
              meta: { projectId: asProjectId("prj_test") },
              events: [
                {
                  type: "user_message",
                  id: asEventId("evt_user_recovered"),
                  parentId: null,
                  seq: asSeq(1),
                  sessionId: asSessionId("ses_remote_recovered"),
                  clientId: asClientId("client_other"),
                  ts: 1,
                  message: { role: "user", content: [{ type: "text", text: "hello from terminal 2" }] },
                },
                {
                  type: "assistant_message",
                  id: asEventId("evt_assistant_recovered"),
                  parentId: asEventId("evt_user_recovered"),
                  seq: asSeq(2),
                  sessionId: asSessionId("ses_remote_recovered"),
                  clientId: asClientId("client_other"),
                  ts: 2,
                  message: { role: "assistant", content: [{ type: "text", text: "recovered assistant output" }] },
                },
              ],
            },
          };
        }
        if (message.type === "resync_events") {
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data: { events: [], throughSeq: asSeq(2), mode: "stream_resume" as const },
          };
        }
        return undefined;
      },
    });

    try {
      const result = await runCliWithInput(
        ["attach", "--remote", server.url, "--token", "remote-secret", "--session", "ses_remote_recovered"],
        ".exit\n",
        testConfig("http://127.0.0.1:1"),
        await mkdtemp(join(tmpdir(), "scorel-cli-remote-recovered-")),
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[user] hello from terminal 2");
      expect(result.stdout).toContain("recovered assistant output\n");
    } finally {
      await server.close();
    }
  });

  it("does not duplicate persistent output when attach cache and daemon replay contain the same event", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-cache-dedupe-"));
    const server = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientMessage: (_connection, message) => {
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_cache_dedupe"),
              activeLeafId: asEventId("evt_cache_assistant"),
              currentSeq: asSeq(2),
              meta: { projectId: asProjectId("prj_test") },
              events: cachedAttachEvents("ses_cache_dedupe", "cached assistant output"),
            },
          };
        }
        if (message.type === "resync_events") {
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data: { events: [], throughSeq: asSeq(2), mode: "stream_resume" as const },
          };
        }
        return undefined;
      },
    });

    try {
      await runCliWithInput(
        ["attach", "--remote", server.url, "--token", "remote-secret", "--session", "ses_cache_dedupe"],
        ".exit\n",
        testConfig("http://127.0.0.1:1"),
        stateDir,
      );
      const second = await runCliWithInput(
        ["attach", "--remote", server.url, "--token", "remote-secret", "--session", "ses_cache_dedupe"],
        ".exit\n",
        testConfig("http://127.0.0.1:1"),
        stateDir,
      );

      expect(second.code).toBe(0);
      expect(second.stdout.match(/cached assistant output/g)).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("keeps attach cache separated by remote project scope even with the same session id", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-cache-scope-"));
    const serverA = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientMessage: (_connection, message) => {
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_same"),
              activeLeafId: asEventId("evt_scope_a_assistant"),
              currentSeq: asSeq(2),
              meta: { projectId: asProjectId("prj_test") },
              events: cachedAttachEvents("ses_same", "remote A cached text", "evt_scope_a"),
            },
          };
        }
        if (message.type === "resync_events") {
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data: { events: [], throughSeq: asSeq(2), mode: "stream_resume" as const },
          };
        }
        return undefined;
      },
    });
    const serverB = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientMessage: (_connection, message) => {
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_same"),
              activeLeafId: null,
              currentSeq: asSeq(0),
              meta: { projectId: asProjectId("prj_other") },
              events: [],
            },
          };
        }
        if (message.type === "resync_events") {
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data: { events: [], throughSeq: asSeq(0), mode: "full_reload" as const },
          };
        }
        return undefined;
      },
    });

    try {
      await runCliWithInput(
        ["attach", "--remote", serverA.url, "--token", "remote-secret", "--session", "ses_same"],
        ".exit\n",
        testConfig("http://127.0.0.1:1"),
        stateDir,
      );
      const scoped = await runCliWithInput(
        ["attach", "--remote", serverB.url, "--token", "remote-secret", "--session", "ses_same"],
        ".exit\n",
        testConfig("http://127.0.0.1:1"),
        stateDir,
      );

      expect(scoped.code).toBe(0);
      expect(scoped.stdout).not.toContain("remote A cached text");
    } finally {
      await serverA.close();
      await serverB.close();
    }
  });

  it("reuses remote attach cache when the endpoint changes but device and project match", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-cache-device-project-"));
    const serverA = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientConnect: (connection, params) => {
        connection.send({
          type: "connected",
          clientId: params.clientId,
          sessionId: params.sessionId,
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_tokyo"),
          deviceDisplayName: "Tokyo VPS",
        });
        return { clientId: params.clientId, sessionId: params.sessionId, currentSeq: asSeq(0), deviceId: asDeviceId("device_tokyo") };
      },
      onClientMessage: (_connection, message) => {
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_same_remote_project"),
              activeLeafId: asEventId("evt_device_project_assistant"),
              currentSeq: asSeq(2),
              meta: { projectId: asProjectId("prj_test") },
              events: cachedAttachEvents("ses_same_remote_project", "device scoped cached text", "evt_device_project"),
            },
          };
        }
        if (message.type === "resync_events") {
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data: { events: [], throughSeq: asSeq(2), mode: "stream_resume" as const },
          };
        }
        return undefined;
      },
    });
    const serverB = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientConnect: (connection, params) => {
        connection.send({
          type: "connected",
          clientId: params.clientId,
          sessionId: params.sessionId,
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_tokyo"),
          deviceDisplayName: "Tokyo VPS",
        });
        return { clientId: params.clientId, sessionId: params.sessionId, currentSeq: asSeq(0), deviceId: asDeviceId("device_tokyo") };
      },
      onClientMessage: (_connection, message) => {
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_same_remote_project"),
              activeLeafId: null,
              currentSeq: asSeq(0),
              meta: { projectId: asProjectId("prj_test") },
              events: [],
            },
          };
        }
        if (message.type === "resync_events") {
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data: { events: [], throughSeq: asSeq(2), mode: "stream_resume" as const },
          };
        }
        return undefined;
      },
    });

    try {
      await runCliWithInput(
        ["attach", "--remote", serverA.url, "--token", "remote-secret", "--session", "ses_same_remote_project"],
        ".exit\n",
        testConfig("http://127.0.0.1:1"),
        stateDir,
      );
      const changedEndpoint = await runCliWithInput(
        ["attach", "--remote", serverB.url, "--token", "remote-secret", "--session", "ses_same_remote_project"],
        ".exit\n",
        testConfig("http://127.0.0.1:1"),
        stateDir,
      );

      expect(changedEndpoint.code).toBe(0);
      expect(changedEndpoint.stdout).toContain("device scoped cached text");
    } finally {
      await serverA.close();
      await serverB.close();
    }
  });

  it("writes remote attach diagnostics beside the cache and redacts tokens", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-attach-log-"));
    const server = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientConnect: (connection, params) => {
        connection.send({
          type: "connected",
          clientId: params.clientId,
          sessionId: params.sessionId,
          currentSeq: asSeq(0),
          deviceId: asDeviceId("device_log"),
          deviceDisplayName: "Log Device",
        });
        return { clientId: params.clientId, sessionId: params.sessionId, currentSeq: asSeq(0), deviceId: asDeviceId("device_log") };
      },
      onClientMessage: (_connection, message) => {
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_attach_log"),
              activeLeafId: null,
              currentSeq: asSeq(0),
              meta: { projectId: asProjectId("prj_test") },
              events: [],
            },
          };
        }
        if (message.type === "resync_events") {
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data: { events: [], throughSeq: asSeq(0), mode: "stream_resume" as const },
          };
        }
        if (message.type === "send_message") {
          return {
            type: "response",
            requestType: "send_message",
            requestId: message.requestId,
            ok: true,
            data: {
              status: "completed" as const,
              userEventId: asEventId("evt_log_user"),
              assistantEventId: asEventId("evt_log_assistant"),
            },
          };
        }
        return undefined;
      },
    });

    try {
      const result = await runCliWithInput(
        ["attach", "--remote", server.url, "--token", "remote-secret", "--session", "ses_attach_log"],
        "hello from attach log\n.exit\n",
        testConfig("http://127.0.0.1:1"),
        stateDir,
      );
      expect(result.code).toBe(0);
      const logPath = await findAttachLogPath(stateDir, "ses_attach_log");
      const log = await readFile(logPath, "utf8");
      expect(log).toContain("event=attach_connect_started");
      expect(log).toContain("event=attach_connect_succeeded");
      expect(log).toContain("deviceId=device_log");
      expect(log).toContain("projectId=prj_test");
      expect(log).toContain("event=attach_resync_finished");
      expect(log).toContain("mode=stream_resume");
      expect(log).toContain("event=attach_send_message_started");
      expect(log).toContain("event=attach_send_message_finished");
      expect(log).toContain("event=attach_disconnected");
      expect(log).not.toContain("remote-secret");

      const printed = await runCliWithInput(
        ["logs", "--attach", "--session", "ses_attach_log", "--remote", server.url, "--tail", "3"],
        "",
        testConfig("http://127.0.0.1:1"),
        stateDir,
      );
      expect(printed.code).toBe(0);
      expect(printed.stdout).toContain("attach_send_message_finished");
      expect(printed.stdout).toContain("attach_disconnected");
    } finally {
      await server.close();
    }
  });

  it("restores cached transient assistant text and resumes from the cached stream seq", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "scorel-cli-transient-cache-"));
    const connections: RemoteDaemonWebSocketConnection[] = [];
    const resyncRequests: Array<{ persistentLastSeq?: number; streamLastSeq?: number }> = [];
    let resyncCount = 0;
    const userEvent = {
      type: "user_message" as const,
      id: asEventId("evt_transient_user"),
      parentId: null,
      seq: asSeq(1),
      sessionId: asSessionId("ses_transient_cache"),
      clientId: asClientId("client_other"),
      ts: 1,
      message: { role: "user" as const, content: [{ type: "text" as const, text: "write story" }] },
    };
    const server = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientConnect: (connection, params) => {
        connections.push(connection);
        return { clientId: params.clientId, sessionId: params.sessionId, currentSeq: asSeq(1), deviceId: asDeviceId("device_test") };
      },
      onClientMessage: (_connection, message) => {
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_transient_cache"),
              activeLeafId: asEventId("evt_transient_user"),
              currentSeq: asSeq(1),
              meta: { projectId: asProjectId("prj_test") },
              events: [userEvent],
            },
          };
        }
        if (message.type === "resync_events") {
          resyncCount += 1;
          resyncRequests.push({
            persistentLastSeq: Number(message.persistentLastSeq),
            streamLastSeq: Number(message.streamLastSeq),
          });
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data:
              resyncCount === 1
                ? { events: [], throughSeq: asSeq(1), mode: "stream_resume" as const }
                : {
                    events: [
                      {
                        type: "text_delta" as const,
                        seq: asSeq(3),
                        sessionId: asSessionId("ses_transient_cache"),
                        clientId: asClientId("client_other"),
                        ts: 3,
                        eventId: asEventId("evt_transient_assistant"),
                        delta: " continuation",
                      },
                      {
                        type: "assistant_message" as const,
                        id: asEventId("evt_transient_assistant"),
                        parentId: asEventId("evt_transient_user"),
                        seq: asSeq(4),
                        sessionId: asSessionId("ses_transient_cache"),
                        clientId: asClientId("client_other"),
                        ts: 4,
                        message: { role: "assistant" as const, content: [{ type: "text" as const, text: "partial continuation" }] },
                      },
                    ],
                    throughSeq: asSeq(4),
                    mode: "stream_resume" as const,
                  },
          };
        }
        return undefined;
      },
    });
    const firstInput = new PassThrough();

    try {
      const first = runCliWithStream(
        ["attach", "--remote", server.url, "--token", "remote-secret", "--session", "ses_transient_cache"],
        firstInput,
        testConfig("http://127.0.0.1:1"),
        stateDir,
      );
      await waitFor(() => connections.length >= 1, "transient attach connection");
      await waitFor(() => first.stdout.toString().includes("scorel attach resumed session ses_transient_cache"), "transient attach ready");
      connections[0].send({
        type: "event",
        event: {
          type: "text_delta",
          seq: asSeq(2),
          sessionId: asSessionId("ses_transient_cache"),
          clientId: asClientId("client_other"),
          ts: 2,
          eventId: asEventId("evt_transient_assistant"),
          delta: "partial",
        },
      });
      await waitFor(() => first.stdout.toString().includes("partial"), "cached transient rendered");
      firstInput.end(".exit\n");
      await expect(first.result).resolves.toMatchObject({ code: 0 });

      const second = await runCliWithInput(
        ["attach", "--remote", server.url, "--token", "remote-secret", "--session", "ses_transient_cache"],
        ".exit\n",
        testConfig("http://127.0.0.1:1"),
        stateDir,
      );

      expect(second.code).toBe(0);
      expect(second.stdout).toContain("partial continuation\n");
      expect(second.stdout.match(/partial continuation/g)).toHaveLength(1);
      expect(resyncRequests.at(-1)).toEqual({ persistentLastSeq: 1, streamLastSeq: 2 });
    } finally {
      firstInput.destroy();
      await server.close();
    }
  }, 10_000);

  it("renders live remote user events and ends streamed assistant output on a clean line", async () => {
    const connections: RemoteDaemonWebSocketConnection[] = [];
    const server = await startRemoteDaemonWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      token: "remote-secret",
      onClientConnect: (connection, params) => {
        connections.push(connection);
        return { clientId: params.clientId, sessionId: params.sessionId, currentSeq: asSeq(0), deviceId: asDeviceId("device_test") };
      },
      onClientMessage: (_connection, message) => {
        if (message.type === "load_session") {
          return {
            type: "response",
            requestType: "load_session",
            requestId: message.requestId,
            ok: true,
            data: {
              sessionId: asSessionId("ses_remote_format"),
              activeLeafId: null,
              currentSeq: asSeq(0),
              meta: { projectId: asProjectId("prj_test") },
              events: [],
            },
          };
        }
        if (message.type === "resync_events") {
          return {
            type: "response",
            requestType: "resync_events",
            requestId: message.requestId,
            ok: true,
            data: { events: [], throughSeq: asSeq(0), mode: "stream_resume" as const },
          };
        }
        return undefined;
      },
    });
    const input = new PassThrough();

    try {
      const attach = runCliWithStream(
        ["attach", "--remote", server.url, "--token", "remote-secret", "--session", "ses_remote_format"],
        input,
        testConfig("http://127.0.0.1:1"),
        await mkdtemp(join(tmpdir(), "scorel-cli-remote-format-")),
      );
      await waitFor(() => connections.length >= 1);
      connections[0].send({
        type: "event",
        event: {
          type: "user_message",
          id: asEventId("evt_format_user"),
          parentId: null,
          seq: asSeq(1),
          sessionId: asSessionId("ses_remote_format"),
          clientId: asClientId("client_other"),
          ts: 1,
          message: { role: "user", content: [{ type: "text", text: "format check" }] },
        },
      });
      connections[0].send({
        type: "event",
        event: {
          type: "text_delta",
          seq: asSeq(2),
          sessionId: asSessionId("ses_remote_format"),
          clientId: asClientId("client_other"),
          ts: 2,
          eventId: asEventId("evt_format_assistant"),
          delta: "assistant stream",
        },
      });
      connections[0].send({
        type: "event",
        event: {
          type: "assistant_message",
          id: asEventId("evt_format_assistant"),
          parentId: asEventId("evt_format_user"),
          seq: asSeq(3),
          sessionId: asSessionId("ses_remote_format"),
          clientId: asClientId("client_other"),
          ts: 3,
          message: { role: "assistant", content: [{ type: "text", text: "assistant stream" }] },
        },
      });
      await waitFor(() => attach.stdout.toString().includes("assistant stream\n"));
      input.end(".exit\n");

      await expect(attach.result).resolves.toMatchObject({ code: 0 });
      expect(attach.stdout.toString()).toContain("[user] format check\nassistant stream\n");
      expect(attach.stdout.toString().match(/assistant stream/g)).toHaveLength(1);
    } finally {
      input.destroy();
      await server.close();
    }
  });

  it("runs a real OpenAI-compatible coding loop through CLI, tools, persistence, and resume", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "scorel-cli-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "scorel-workspace-"));
    const sessionId = "ses_cli_real_coding_alpha";
    await mkdir(join(workspaceDir, "src"));
    await writeFile(join(workspaceDir, "src", "value.txt"), "status=wrong\n");
    const server = await startChatServer([
      {
        content: null,
        tool_calls: [
          toolCall("call_todo_1", "TodoWrite", {
            todos: [
              { content: "Find value", status: "in_progress", activeForm: "Finding value" },
              { content: "Fix value", status: "pending", activeForm: "Fixing value" },
              { content: "Verify", status: "pending", activeForm: "Verifying" },
            ],
          }),
        ],
      },
      {
        content: null,
        tool_calls: [toolCall("call_grep", "Grep", { pattern: "wrong", glob: "src/*.txt", output_mode: "content" })],
      },
      {
        content: null,
        tool_calls: [toolCall("call_read", "Read", { file_path: "src/value.txt" })],
      },
      {
        content: null,
        tool_calls: [toolCall("call_edit", "Edit", { file_path: "src/value.txt", old_string: "wrong", new_string: "right" })],
      },
      {
        content: null,
        tool_calls: [toolCall("call_bash", "Bash", { command: "grep right src/value.txt" })],
      },
      {
        content: null,
        tool_calls: [
          toolCall("call_todo_2", "TodoWrite", {
            todos: [
              { content: "Find value", status: "completed", activeForm: "Finding value" },
              { content: "Fix value", status: "completed", activeForm: "Fixing value" },
              { content: "Verify", status: "completed", activeForm: "Verifying" },
            ],
          }),
        ],
      },
      { content: "Done. status is fixed.", tool_calls: [] },
      { content: "Resume sees completed work.", tool_calls: [] },
    ], {
      titleResponse: { content: "Fix Status Value", tool_calls: [] },
    });

    try {
      const config = testConfig(server.baseURL);
      const first = await runCliWithInput(
        ["chat", "--session", sessionId, "--cwd", workspaceDir],
        "Fix the failing status value and verify it.\n.exit\n",
        config,
        sessionsDir,
      );

      expect(first.code, first.stderr).toBe(0);
      expect(first.stderr).toContain("created session ses_cli_real_coding_alpha");
      for (const toolName of ["TodoWrite", "Grep", "Read", "Edit", "Bash"]) {
        expect(first.stdout).toContain(`[tool:${toolName}]`);
      }
      expect(first.stdout).toContain("All items are completed");
      expect(first.stdout).toContain("status=right");
      expect(first.stdout).toContain("Done. status is fixed.");

      const second = await runCliWithInput(
        ["chat", "--session", sessionId, "--cwd", workspaceDir],
        "Continue from previous context.\n.exit\n",
        config,
        sessionsDir,
      );
      expect(second.code).toBe(0);
      expect(second.stderr).toContain("resumed session ses_cli_real_coding_alpha");
      expect(second.stdout).toContain("Resume sees completed work.");

      const jsonl = await readFile(join(sessionsDir, `${sessionId}.jsonl`), "utf8");
      const lines = jsonl.trim().split("\n").map((line) => JSON.parse(line));
      const toolNames = lines
        .filter((line) => line.type === "tool_result")
        .map((line) => line.message.content[0].toolName);
      expect(toolNames).toEqual(["TodoWrite", "Grep", "Read", "Edit", "Bash", "TodoWrite"]);
      expect(server.requests.length).toBe(9);
      const firstRequest = server.requests.find(isToolChatRequest) as
        | { tools?: Array<{ function?: { name?: string; parameters?: unknown } }> }
        | undefined;
      const titleRequest = server.requests.find(isTitleGenerationRequest) as
        | { tools?: unknown[]; messages?: Array<{ content?: unknown }> }
        | undefined;
      if (!firstRequest) {
        throw new Error("missing tool chat request");
      }
      if (!titleRequest) {
        throw new Error("missing title generation request");
      }
      const readTool = firstRequest.tools?.find((tool) => tool.function?.name === "Read");
      expect(firstRequest).toMatchObject({
        model: "gpt-5.4-mini",
        tools: expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: "TodoWrite" }) })]),
      });
      expect(readTool).toMatchObject({
        function: {
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              file_path: expect.any(Object),
              full: expect.any(Object),
            }),
          }),
        },
      });
      expect(titleRequest.tools ?? []).toEqual([]);
      expect(requestMessageText(titleRequest)).toContain("Write a session title");
      expect(requestMessageText(titleRequest)).toContain("<user_request>");
      expect(requestMessageText(titleRequest)).toContain("Fix the failing status value");
      expect(server.requests.at(-1)).toMatchObject({
        messages: expect.arrayContaining([expect.objectContaining({ role: "tool" })]),
      });
    } finally {
      await server.close();
    }
  });
});

const runCliWithInput = async (
  argv: string[],
  input: string,
  config: ScorelConfig | undefined,
  sessionsDir: string,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const stdout = new StringWritable();
  const stderr = new StringWritable();
  const code = await runCli(argv, {
    input: Readable.from([input]),
    output: stdout,
    error: stderr,
  }, { config, sessionsDir });
  return { code, stdout: stdout.toString(), stderr: stderr.toString() };
};

const runCliWithCwd = async (
  argv: string[],
  input: string,
  config: ScorelConfig | undefined,
  sessionsDir: string,
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await runCliWithInput(argv, input, config, sessionsDir);
  } finally {
    process.chdir(previous);
  }
};

const cachedAttachEvents = (sessionId: string, assistantText: string, idPrefix = "evt_cache") => [
  {
    type: "user_message" as const,
    id: asEventId(`${idPrefix}_user`),
    parentId: null,
    seq: asSeq(1),
    sessionId: asSessionId(sessionId),
    clientId: asClientId("client_other"),
    ts: 1,
    message: { role: "user" as const, content: [{ type: "text" as const, text: "cached user input" }] },
  },
  {
    type: "assistant_message" as const,
    id: asEventId(`${idPrefix}_assistant`),
    parentId: asEventId(`${idPrefix}_user`),
    seq: asSeq(2),
    sessionId: asSessionId(sessionId),
    clientId: asClientId("client_other"),
    ts: 2,
    message: { role: "assistant" as const, content: [{ type: "text" as const, text: assistantText }] },
  },
];

const runCliWithStream = (
  argv: string[],
  input: NodeJS.ReadableStream,
  config: ScorelConfig,
  sessionsDir: string,
): { result: Promise<{ code: number; stdout: string; stderr: string }>; stdout: StringWritable; stderr: StringWritable } => {
  const stdout = new StringWritable();
  const stderr = new StringWritable();
  return {
    stdout,
    stderr,
    result: runCli(argv, { input, output: stdout, error: stderr }, { config, sessionsDir }).then((code) => ({
      code,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    })),
  };
};

const findAttachLogPath = async (stateDir: string, sessionId: string): Promise<string> => {
  const root = join(stateDir, "attach-cache");
  const scopes = await readdir(root);
  for (const scope of scopes) {
    const candidate = join(root, scope, `${sessionId}.log`);
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`attach log not found for ${sessionId}`);
};

const waitFor = (predicate: () => boolean, label = "condition"): Promise<void> =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - startedAt > 5000) {
        clearInterval(interval);
        reject(new Error(`timed out waiting for ${label}`));
      }
    }, 5);
  });

class StringWritable extends Writable {
  #chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.#chunks.push(chunk.toString());
    callback();
  }

  override toString(): string {
    return this.#chunks.join("");
  }
}

type AssistantResponse = {
  content: string | null;
  tool_calls: Array<ReturnType<typeof toolCall>>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

const startChatServer = async (
  responses: AssistantResponse[],
  options: { titleResponse?: AssistantResponse } = {},
) => {
  const requests: unknown[] = [];
  let index = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const payload = await readJson(request);
    requests.push(payload);
    const item = options.titleResponse && isTitleGenerationRequest(payload)
      ? options.titleResponse
      : responses[index++];
    if (!item) {
      response.writeHead(500).end(JSON.stringify({ error: { message: "unexpected request" } }));
      return;
    }
    writeSse(response, toSseChunks(item));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("missing server address");
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

const startSlowChatServer = async (delayMs: number) => {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    await readJson(request);
    setTimeout(() => {
      if (!response.destroyed) {
        writeSse(response, toSseChunks({ content: "late response", tool_calls: [] }));
      }
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("missing server address");
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

const startErrorChatServer = async (finishReason: string) => {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    await readJson(request);
    writeSse(response, [
      {
        id: "chatcmpl-scorel-cli-test",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      },
    ]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("missing server address");
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

const startLangfuseServer = async () => {
  const requests: Array<{ url?: string; authorization?: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/api/public/ingestion") {
      response.writeHead(404).end();
      return;
    }
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      body: await readJson(request),
    });
    response.writeHead(207, { "content-type": "application/json" }).end(JSON.stringify({ successes: [{ id: "ok" }], errors: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("missing server address");
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

const startOtelServer = async () => {
  const requests: Array<{ url?: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !["/v1/traces", "/v1/metrics", "/v1/logs"].includes(request.url ?? "")) {
      response.writeHead(404).end();
      return;
    }
    requests.push({
      url: request.url,
      body: await readJson(request),
    });
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("missing server address");
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

const isToolChatRequest = (
  request: unknown,
): request is { tools: Array<{ function?: { name?: string; parameters?: unknown } }> } => {
  return Array.isArray((request as { tools?: unknown }).tools);
};

const isTitleGenerationRequest = (request: unknown): boolean => {
  const text = requestMessageText(request);
  return text.includes("You generate concise chat session titles")
    || text.includes("Write a session title for the following first user request.")
    || text.includes("<user_request>");
};

const requestMessageText = (request: unknown): string => {
  const messages = (request as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return "";
  }
  return messages.map((message) => {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content.map((part) => {
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      }).join("\n");
    }
    return "";
  }).join("\n");
};

const toolCall = (id: string, name: string, args: unknown) => ({
  id,
  type: "function" as const,
  function: {
    name,
    arguments: JSON.stringify(args),
  },
});

const testConfig = (baseURL: string): ScorelConfig => ({
  providers: {
    test: {
      type: "custom",
      api: "openai-completions",
      provider: "scorel-test",
      baseUrl: baseURL,
      apiKey: "chanleramp",
    },
  },
  providerModels: {
    main: {
      provider: "test",
      id: "gpt-5.4-mini",
      displayName: "GPT 5.4 Mini",
      contextWindow: 400000,
      maxTokens: 128000,
      reasoning: true,
    },
  },
  models: {
    main: { model: "main", displayName: "GPT 5.4 Mini" },
  },
  modelProfile: {
    roles: {
      primary: "main",
      standard: "main",
      auxiliary: "main",
    },
  },
  memory: {
    enabled: false,
    daily: false,
    sessionMemory: false,
    autoDream: false,
    promoteRoot: false,
    dreamIdleMinutes: 60,
    autoCompactThreshold: 0.8,
  },
  runtime: {
    tokenSavingRtk: false,
  },
  extensions: {},
});

const langfuseConfigToml = (providerBaseUrl: string, langfuseHost: string): string => `
[providers.test]
type = "custom"
provider = "scorel-test"
api = "openai-completions"
baseUrl = "${providerBaseUrl}"
apiKey = "chanleramp"

[provider_models.main]
provider = "test"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"

[available_models.main]
model = "main"
displayName = "GPT 5.4 Mini"

[model_profile.roles]
primary = "main"
standard = "main"
auxiliary = "main"

[observability]
local = true

[observability.sync]
enabled = true
mode = "manual"
targets = "langfuse"

[observability.langfuse]
enabled = true
host = "${langfuseHost}"
publicKey = "pk-lf-test"
secretKey = "sk-lf-test"
`;

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const writeSse = (response: ServerResponse, chunks: unknown[]): void => {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.write("data: [DONE]\n\n");
  response.end();
};

const toSseChunks = (item: AssistantResponse): unknown[] => {
  const chunks = [];
  if (item.content) {
    chunks.push({
      id: "chatcmpl-scorel-cli-test",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: item.content } }],
    });
  }
  for (const [index, toolCall] of item.tool_calls.entries()) {
    chunks.push({
      id: "chatcmpl-scorel-cli-test",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index, ...toolCall }] } }],
    });
  }
  chunks.push({
    id: "chatcmpl-scorel-cli-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: item.tool_calls.length > 0 ? "tool_calls" : "stop" }],
    ...(item.usage ? { usage: item.usage } : {}),
  });
  return chunks;
};
