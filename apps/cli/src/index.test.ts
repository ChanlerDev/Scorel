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

      expect(result.code).toBe(0);
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

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Default command response.");
      const registry = JSON.parse(await readFile(join(stateDir, "projects.json"), "utf8")) as { projects: Array<{ workDir: string }> };
      expect(registry.projects[0]?.workDir).toBe(await realpath(workspaceDir));
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
    ]);

    try {
      const config = testConfig(server.baseURL);
      const first = await runCliWithInput(
        ["chat", "--session", sessionId, "--cwd", workspaceDir],
        "Fix the failing status value and verify it.\n.exit\n",
        config,
        sessionsDir,
      );

      expect(first.code).toBe(0);
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
      expect(server.requests.length).toBe(8);
      const firstRequest = server.requests[0] as { tools?: Array<{ function?: { name?: string; parameters?: unknown } }> };
      const readTool = firstRequest.tools?.find((tool) => tool.function?.name === "Read");
      expect(server.requests[0]).toMatchObject({
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
  config: ScorelConfig,
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
  config: ScorelConfig,
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
};

const startChatServer = async (responses: AssistantResponse[]) => {
  const requests: unknown[] = [];
  let index = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    requests.push(await readJson(request));
    const item = responses[index++];
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

const toolCall = (id: string, name: string, args: unknown) => ({
  id,
  type: "function" as const,
  function: {
    name,
    arguments: JSON.stringify(args),
  },
});

const testConfig = (baseURL: string): ScorelConfig => ({
  model: {
    type: "custom",
    api: "openai-completions",
    provider: "scorel-test",
    id: "gpt-5.4-mini",
    baseUrl: baseURL,
    apiKey: "chanleramp",
    contextWindow: 400000,
    maxTokens: 128000,
    reasoning: true,
  },
});

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
  });
  return chunks;
};
