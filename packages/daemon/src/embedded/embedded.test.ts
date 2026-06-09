import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ScorelRuntime, loadScorelConfig, loadScorelConfigProfile, type RuntimeProvider, type RuntimeProviderTurn, type ScorelConfig } from "@scorel/core";
import {
  asClientId,
  asDeviceId,
  asRequestId,
  asSessionId,
  type DaemonMessage,
  type HostProject,
  type ScorelMessage,
} from "@scorel/protocol";

import { ScorelHost, createEmbeddedTransport } from "../index.js";

const assistantMessage = (text: string): ScorelMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason: "end_turn",
});

const provider: RuntimeProvider = {
  streamTurn: async function* () {
    return assistantMessage("ok");
  },
};

const modelProfile: ScorelConfig = {
  providers: {
    test: {
      type: "custom",
      api: "openai-completions",
      provider: "scorel-test",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "secret",
    },
  },
  providerModels: {
    main: {
      provider: "test",
      id: "main-model",
      displayName: "Main Model",
      contextWindow: 400000,
      maxTokens: 128000,
      reasoning: true,
    },
    aux: {
      provider: "test",
      id: "aux-model",
      displayName: "Aux Model",
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: false,
    },
  },
  models: {
    main: { model: "main", displayName: "Main Model" },
    aux: { model: "aux", displayName: "Aux Model" },
  },
  modelProfile: {
    roles: {
      primary: "main",
      standard: "main",
      auxiliary: "aux",
    },
  },
};

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "scorel-host-"));
  const sessionsDir = join(root, "sessions");
  const projectsPath = join(root, "projects.json");
  await mkdir(sessionsDir);
  const runtimeProjects: HostProject[] = [];
  const host = new ScorelHost({
    sessionsDir,
    projectsPath,
    deviceId: asDeviceId("device_test"),
    createRuntime: async ({ project }) => {
      runtimeProjects.push(project);
      return new ScorelRuntime({ provider });
    },
    now: () => 1_000,
  });
  await host.start();
  return { root, sessionsDir, projectsPath, runtimeProjects, host };
};

const fixtureWithModelProfile = async () => {
  const root = await mkdtemp(join(tmpdir(), "scorel-host-models-"));
  const sessionsDir = join(root, "sessions");
  const projectsPath = join(root, "projects.json");
  await mkdir(sessionsDir);
  const runtimeSelections: string[] = [];
  const host = new ScorelHost({
    sessionsDir,
    projectsPath,
    deviceId: asDeviceId("device_test"),
    modelProfile,
    createRuntime: async ({ selectedModel }) => {
      runtimeSelections.push(selectedModel?.modelId ?? "none");
      return new ScorelRuntime({ provider });
    },
    now: () => 1_000,
  });
  await host.start();
  return { root, sessionsDir, projectsPath, runtimeSelections, host };
};

describe("ScorelHost + embedded transport", () => {
  it("treats concurrent explicit create_session requests as the same session", async () => {
    const { root, host } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const sessionId = asSessionId("ses_create_race");
    const transportA = createEmbeddedTransport(host);
    const transportB = createEmbeddedTransport(host);
    await transportA.connect({ clientId: asClientId("client_a"), sessionId });
    await transportB.connect({ clientId: asClientId("client_b"), sessionId });
    const responseA = waitForResponse(transportA, "req_a");
    const responseB = waitForResponse(transportB, "req_b");

    await Promise.all([
      transportA.send({
        type: "create_session",
        requestId: asRequestId("req_a"),
        sessionId,
        meta: { projectId: project.projectId },
      }),
      transportB.send({
        type: "create_session",
        requestId: asRequestId("req_b"),
        sessionId,
        meta: { projectId: project.projectId },
      }),
    ]);

    await expect(responseA).resolves.toMatchObject({ type: "response", requestType: "create_session" });
    await expect(responseB).resolves.toMatchObject({ type: "response", requestType: "create_session" });
  });

  it("isolates runtime work directories for sessions in two registered projects", async () => {
    const { root, runtimeProjects, host } = await fixture();
    const repoA = join(root, "repo-a");
    const repoB = join(root, "repo-b");
    await Promise.all([mkdir(repoA), mkdir(repoB)]);
    const projectA = await host.registerProject(repoA);
    const projectB = await host.registerProject(repoB);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });

    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_a"),
      sessionId: asSessionId("ses_a"),
      meta: { projectId: projectA.projectId },
    });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_b"),
      sessionId: asSessionId("ses_b"),
      meta: { projectId: projectB.projectId },
    });

    expect(runtimeProjects.map((project) => project.workDir).sort()).toEqual(
      (await Promise.all([realpath(repoA), realpath(repoB)])).sort(),
    );
    expect((await host.listProjects()).map((project) => project.projectId).sort()).toEqual(
      [projectA.projectId, projectB.projectId].sort(),
    );
  });

  it("lists configured models without provider credentials", async () => {
    const { root, host } = await fixtureWithModelProfile();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_models");

    await transport.send({
      type: "list_models",
      requestId: asRequestId("req_models"),
      projectId: project.projectId,
    });

    const resolved = await response;
    expect(resolved).toMatchObject({
      type: "response",
      requestType: "list_models",
      data: {
        roles: {
          primary: "main",
          standard: "main",
          auxiliary: "aux",
        },
        models: [
          {
            modelId: "main",
            providerId: "test",
            provider: "scorel-test",
            id: "main-model",
            displayName: "Main Model",
            roles: ["primary", "standard"],
          },
          {
            modelId: "aux",
            providerId: "test",
            provider: "scorel-test",
            id: "aux-model",
            displayName: "Aux Model",
            roles: ["auxiliary"],
          },
        ],
      },
    });
    if (resolved.type !== "response") throw new Error("expected response");
    expect(JSON.stringify(resolved.data)).not.toContain("secret");
  });

  it("returns an empty model profile when project config is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-empty-models-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(repo)]);
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_models_empty");

    await transport.send({
      type: "list_models",
      requestId: asRequestId("req_models_empty"),
      projectId: project.projectId,
    });

    await expect(response).resolves.toMatchObject({
      type: "response",
      requestType: "list_models",
      data: {
        models: [],
        roles: {
          primary: "",
          standard: "",
          auxiliary: "",
        },
      },
    });
  });

  it("lets GUI recover from development-stage legacy models config", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-legacy-models-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(join(repo, ".scorel"), { recursive: true })]);
    await writeFile(join(repo, ".scorel", "config.toml"), `
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

[models.main]
provider = "openai"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"
`);
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_models_legacy");

    await transport.send({
      type: "list_models",
      requestId: asRequestId("req_models_legacy"),
      projectId: project.projectId,
    });

    await expect(response).resolves.toMatchObject({
      type: "response",
      requestType: "list_models",
      data: {
        providers: [],
        providerModels: [],
        models: [],
        roles: {
          primary: "",
          standard: "",
          auxiliary: "",
        },
        warnings: [expect.stringContaining("[models.*]")],
      },
    });

    const upsertResponse = waitForResponse(transport, "req_replace_legacy_provider");
    await transport.send({
      type: "upsert_model_profile",
      requestId: asRequestId("req_replace_legacy_provider"),
      projectId: project.projectId,
      providerId: "chanleramp",
      providerType: "custom",
      provider: "chanleramp",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1",
      apiKeyEnv: "SCOREL_API_KEY",
    });

    await expect(upsertResponse).resolves.toMatchObject({
      type: "response",
      requestType: "upsert_model_profile",
      data: {
        providers: [{ providerId: "chanleramp" }],
        providerModels: [],
        models: [],
      },
    });
    const rewrittenConfig = await readFile(join(repo, ".scorel", "config.toml"), "utf8");
    expect(rewrittenConfig).toContain("[providers.chanleramp]");
    expect(rewrittenConfig).not.toContain("[models.main]");
  });

  it("surfaces invalid model profile config instead of treating it as empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-invalid-models-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(join(repo, ".scorel"), { recursive: true })]);
    await writeFile(join(repo, ".scorel", "config.toml"), `
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

[provider_models.openai_gpt_54_mini]
provider = "openai"
id = "gpt-5.4-mini"
displayName = "GPT 5.4 Mini"

[available_models.main]
model = "openai_gpt_54_mini"
displayName = "GPT 5.4 Mini"

[model_profile.roles]
primary = "main"
standard = "missing"
auxiliary = "main"
`);
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_models_invalid");

    await transport.send({
      type: "list_models",
      requestId: asRequestId("req_models_invalid"),
      projectId: project.projectId,
    });

    await expect(response).resolves.toMatchObject({
      type: "error",
      requestId: "req_models_invalid",
      message: "model_profile.roles.standard must reference a configured model",
    });
  });

  it("writes GUI model profile changes without requiring provider credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-upsert-models-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(repo)]);
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      loadConfig: async ({ project }) =>
        loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      loadConfigProfile: async ({ project }) =>
        loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: {} }),
      createRuntime: async () => new ScorelRuntime({ provider }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    const response = waitForResponse(transport, "req_upsert_models");

    await transport.send({
      type: "upsert_model_profile",
      requestId: asRequestId("req_upsert_models"),
      projectId: project.projectId,
      providerId: "chanleramp",
      providerType: "custom",
      provider: "chanleramp",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1/",
      apiKeyEnv: "SCOREL_API_KEY",
      modelId: "main",
      providerModelId: "deepseek-v4-flash",
      displayName: "DeepSeek Flash",
      contextWindow: 128000,
      maxTokens: 32000,
      reasoning: false,
    });

    await expect(response).resolves.toMatchObject({
      type: "response",
      requestType: "upsert_model_profile",
      data: {
        providers: [
          {
            providerId: "chanleramp",
            provider: "chanleramp",
            apiKeyEnv: "SCOREL_API_KEY",
            credentialSource: "env",
            credentialStatus: "missing",
          },
        ],
        roles: {
          primary: "main",
          standard: "main",
          auxiliary: "main",
        },
        models: [
          {
            modelId: "main",
            providerId: "chanleramp",
            provider: "chanleramp",
            id: "deepseek-v4-flash",
            displayName: "DeepSeek Flash",
            roles: ["primary", "standard", "auxiliary"],
          },
        ],
      },
    });
    const config = await readFile(join(repo, ".scorel", "config.toml"), "utf8");
    expect(config).toContain("[providers.chanleramp]");
    expect(config).toContain("[provider_models.chanleramp_main]");
    expect(config).toContain("[available_models.main]");
    expect(config).toContain('apiKeyEnv = "SCOREL_API_KEY"');
    expect(config).not.toContain("secret");

    const secondResponse = waitForResponse(transport, "req_upsert_aux_model");
    await transport.send({
      type: "upsert_model_profile",
      requestId: asRequestId("req_upsert_aux_model"),
      projectId: project.projectId,
      providerId: "chanleramp",
      providerType: "custom",
      provider: "chanleramp",
      api: "openai-completions",
      baseUrl: "https://amp.chanler.dev/v1/",
      apiKeyEnv: "SCOREL_API_KEY",
      modelId: "aux",
      providerModelId: "deepseek-v4-lite",
      displayName: "DeepSeek Lite",
      contextWindow: 64000,
      maxTokens: 16000,
      reasoning: false,
      roles: {
        primary: "main",
        standard: "main",
        auxiliary: "aux",
      },
    });

    await expect(secondResponse).resolves.toMatchObject({
      type: "response",
      requestType: "upsert_model_profile",
      data: {
        roles: {
          primary: "main",
          standard: "main",
          auxiliary: "aux",
        },
        models: [
          { modelId: "aux" },
          { modelId: "main" },
        ],
      },
    });
    const mergedConfig = await readFile(join(repo, ".scorel", "config.toml"), "utf8");
    expect(mergedConfig).toContain("[provider_models.chanleramp_main]");
    expect(mergedConfig).toContain("[provider_models.chanleramp_aux]");
    expect(mergedConfig).toContain("[available_models.main]");
    expect(mergedConfig).toContain("[available_models.aux]");
  });

  it("fetches provider catalog models through a real /models endpoint", async () => {
    const server = createServer((request, response) => {
      if (request.url !== "/v1/models") {
        response.writeHead(404).end();
        return;
      }
      if (request.headers.authorization !== "Bearer secret") {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-lite", name: "DeepSeek Lite" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected local server address");
    try {
      const root = await mkdtemp(join(tmpdir(), "scorel-host-provider-catalog-"));
      const sessionsDir = join(root, "sessions");
      const projectsPath = join(root, "projects.json");
      const repo = join(root, "repo");
      await Promise.all([mkdir(sessionsDir), mkdir(join(repo, ".scorel"), { recursive: true })]);
      await writeFile(join(repo, ".scorel", "config.toml"), `
[providers.chanleramp]
type = "custom"
api = "openai-completions"
provider = "chanleramp"
baseUrl = "http://127.0.0.1:${address.port}/v1"
apiKey = "secret"
`);
      const host = new ScorelHost({
        sessionsDir,
        projectsPath,
        deviceId: asDeviceId("device_test"),
        loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir, homeDir: join(root, "home"), env: process.env }),
        loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir, homeDir: join(root, "home"), env: process.env }),
        createRuntime: async () => new ScorelRuntime({ provider }),
        now: () => 1_000,
      });
      await host.start();
      const project = await host.registerProject(repo);
      const transport = createEmbeddedTransport(host);
      await transport.connect({ clientId: asClientId("client_test") });
      const response = waitForResponse(transport, "req_fetch_provider_models");

      await transport.send({
        type: "fetch_provider_models",
        requestId: asRequestId("req_fetch_provider_models"),
        projectId: project.projectId,
        providerId: "chanleramp",
      });

      await expect(response).resolves.toMatchObject({
        type: "response",
        requestType: "fetch_provider_models",
        data: {
          models: [
            { id: "deepseek-v4-flash", displayName: "deepseek-v4-flash" },
            { id: "deepseek-v4-lite", displayName: "DeepSeek Lite" },
          ],
        },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("persists the default standard model selection in new session headers", async () => {
    const { root, sessionsDir, host, runtimeSelections } = await fixtureWithModelProfile();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });

    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_model_default"),
      meta: { projectId: project.projectId },
    });

    const header = JSON.parse((await readFile(join(sessionsDir, "ses_model_default.jsonl"), "utf8")).split("\n")[0]!);
    expect(header.meta.selectedModel).toMatchObject({
      modelId: "main",
      role: "standard",
      displayName: "Main Model",
    });
    expect(runtimeSelections).toEqual(["main"]);
  });

  it("persists explicit model selection and reuses it when restoring a session", async () => {
    const { root, sessionsDir, projectsPath, host, runtimeSelections } = await fixtureWithModelProfile();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_seed") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_model_restore"),
      meta: { projectId: project.projectId, modelSelection: { modelId: "aux" } },
    });
    await host.shutdown();

    const restoredSelections: string[] = [];
    const restored = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      modelProfile,
      createRuntime: async ({ selectedModel }) => {
        restoredSelections.push(selectedModel?.modelId ?? "none");
        return new ScorelRuntime({ provider });
      },
    });
    await restored.start();
    const restoredTransport = createEmbeddedTransport(restored);
    await restoredTransport.connect({ clientId: asClientId("client_restored") });
    await restoredTransport.send({
      type: "load_session",
      requestId: asRequestId("req_load"),
      sessionId: asSessionId("ses_model_restore"),
    });

    const header = JSON.parse((await readFile(join(sessionsDir, "ses_model_restore.jsonl"), "utf8")).split("\n")[0]!);
    expect(header.meta.selectedModel).toMatchObject({
      modelId: "aux",
      displayName: "Aux Model",
    });
    expect(runtimeSelections).toEqual(["aux"]);
    expect(restoredSelections).toEqual(["aux"]);
  });

  it("generates a first-message session title with the auxiliary model", async () => {
    const { root, sessionsDir, host, runtimeSelections } = await fixtureWithModelProfile();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_title"),
      meta: { projectId: project.projectId },
    });
    const response = waitForResponse(transport, "req_send_title");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_send_title"),
      sessionId: asSessionId("ses_title"),
      content: "Help me configure provider models.",
    });
    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const lines = (await readFile(join(sessionsDir, "ses_title.jsonl"), "utf8")).trim().split("\n");
    const events = lines.slice(1).map((line) => JSON.parse(line) as { type: string; title?: string; source?: string; model?: { modelId?: string } });
    expect(events).toContainEqual(expect.objectContaining({
      type: "session_title_updated",
      title: "ok",
      source: "model",
      model: expect.objectContaining({ modelId: "aux" }),
    }));
    expect(runtimeSelections).toEqual(["main", "aux"]);

    const listResponse = waitForResponse(transport, "req_list_title");
    await transport.send({
      type: "list_sessions",
      requestId: asRequestId("req_list_title"),
      projectId: project.projectId,
    });
    await expect(listResponse).resolves.toMatchObject({
      type: "response",
      requestType: "list_sessions",
      data: {
        sessions: [
          expect.objectContaining({
            sessionId: "ses_title",
            title: "ok",
          }),
        ],
      },
    });
  });

  it("does not generate a model title when the session already has an explicit title", async () => {
    const { root, sessionsDir, host, runtimeSelections } = await fixtureWithModelProfile();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_explicit_title"),
      meta: { projectId: project.projectId, title: "Manual title" },
    });
    const response = waitForResponse(transport, "req_send_explicit_title");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_send_explicit_title"),
      sessionId: asSessionId("ses_explicit_title"),
      content: "hello",
    });
    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const file = await readFile(join(sessionsDir, "ses_explicit_title.jsonl"), "utf8");
    expect(file).not.toContain("session_title_updated");
    expect(runtimeSelections).toEqual(["main"]);
  });

  it("persists project ownership in session headers and restores lanes through the registry", async () => {
    const { root, sessionsDir, projectsPath, host } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_seed") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_restart"),
      meta: { projectId: project.projectId },
    });
    await host.shutdown();

    const restoredProjects: HostProject[] = [];
    const restored = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async ({ project: restoredProject }) => {
        restoredProjects.push(restoredProject);
        return new ScorelRuntime({ provider });
      },
    });
    await restored.start();
    const restoredTransport = createEmbeddedTransport(restored);
    await restoredTransport.connect({ clientId: asClientId("client_restored") });
    await restoredTransport.send({
      type: "load_session",
      requestId: asRequestId("req_load"),
      sessionId: asSessionId("ses_restart"),
    });

    expect(restoredProjects).toEqual([project]);
    const header = JSON.parse((await readFile(join(sessionsDir, "ses_restart.jsonl"), "utf8")).split("\n")[0]!);
    expect(header.meta).toEqual({ projectId: project.projectId });
  });

  it("writes an instruction snapshot before the first user message and passes it as systemPrompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-instructions-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(sessionsDir);
    await writeFile(join(repo, "AGENTS.md"), "Always say repo-rule.");
    const providerTurns: RuntimeProviderTurn[] = [];
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async () =>
        new ScorelRuntime({
          provider: {
            streamTurn: async function* (turn) {
              providerTurns.push(turn);
              return assistantMessage("ok");
            },
          },
        }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_instruction"),
      meta: { projectId: project.projectId },
    });
    const response = waitForResponse(transport, "req_send");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_send"),
      sessionId: asSessionId("ses_instruction"),
      content: "hello",
    });
    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const lines = (await readFile(join(sessionsDir, "ses_instruction.jsonl"), "utf8")).trim().split("\n");
    const events = lines.slice(1).map((line) => JSON.parse(line) as { type: string; snapshot?: unknown });
    expect(events.map((event) => event.type).slice(0, 4)).toEqual([
      "instruction_snapshot",
      "skill_index_snapshot",
      "harness_item",
      "user_message",
    ]);
    expect(providerTurns[0]?.systemPrompt).toContain("Always say repo-rule.");
    expect(providerTurns[0]?.systemPrompt).toContain("Workspace cwd:");
  });

  it("queues send_message as follow-up while a turn is running and consumes it after the final leaf", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-follow-up-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(repo)]);
    const releases = [deferred<void>(), deferred<void>()];
    let providerCall = 0;
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async () =>
        new ScorelRuntime({
          provider: {
            streamTurn: async function* () {
              const release = releases[providerCall++]!;
              await release.promise;
              return assistantMessage(`ok ${providerCall}`);
            },
          },
        }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_follow"),
      meta: { projectId: project.projectId },
    });
    const firstResponse = waitForResponse(transport, "req_first");
    const secondResponse = waitForResponse(transport, "req_second");
    void transport.send({
      type: "send_message",
      requestId: asRequestId("req_first"),
      sessionId: asSessionId("ses_follow"),
      content: "first",
    });
    await eventually(() => expect(providerCall).toBe(1));
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_second"),
      sessionId: asSessionId("ses_follow"),
      content: "second",
    });

    releases[0]!.resolve();
    await expect(firstResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });
    await eventually(() => expect(providerCall).toBe(2));
    releases[1]!.resolve();
    await expect(secondResponse).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const events = (await readFile(join(sessionsDir, "ses_follow.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line) as { type: string; message?: { meta?: Record<string, unknown> }; parentId?: string; id?: string });
    const followUpUser = events.find((event) => event.type === "user_message" && event.message?.meta?.source === "follow_up");
    const firstAssistant = events.find((event) => event.type === "assistant_message");
    expect(events.some((event) => event.type === "queue_update")).toBe(true);
    expect(followUpUser?.parentId).toBe(firstAssistant?.id);
    expect(followUpUser?.message?.meta?.queueItemId).toEqual(expect.any(String));
  });

  it("broadcasts a durable user_message before completing an idle send request", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-accepted-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(repo)]);
    const release = deferred<void>();
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async () =>
        new ScorelRuntime({
          provider: {
            streamTurn: async function* () {
              await release.promise;
              return assistantMessage("ok");
            },
          },
        }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_accepted"),
      meta: { projectId: project.projectId },
    });

    const response = waitForResponse(transport, "req_send");
    void transport.send({
      type: "send_message",
      requestId: asRequestId("req_send"),
      sessionId: asSessionId("ses_accepted"),
      content: "first",
    });

    let eventsBeforeRelease: Array<{ type: string }> = [];
    for (let i = 0; i < 50; i += 1) {
      eventsBeforeRelease = (await readFile(join(sessionsDir, "ses_accepted.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string });
      if (eventsBeforeRelease.some((event) => event.type === "user_message")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(eventsBeforeRelease.some((event) => event.type === "user_message")).toBe(true);
    expect(eventsBeforeRelease.some((event) => event.type === "assistant_message")).toBe(false);

    release.resolve();
    await expect(response).resolves.toMatchObject({
      type: "response",
      requestType: "send_message",
      data: { status: "completed", userEventId: expect.any(String), assistantEventId: expect.any(String) },
    });
    for (let i = 0; i < 50; i += 1) {
      const text = await readFile(join(sessionsDir, "ses_accepted.jsonl"), "utf8");
      if (text.includes("\"assistant_message\"")) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await readFile(join(sessionsDir, "ses_accepted.jsonl"), "utf8")).toContain("\"assistant_message\"");
  });

  it("queues a running steer request separately from follow-up", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-steer-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await Promise.all([mkdir(sessionsDir), mkdir(repo)]);
    const release = deferred<void>();
    let providerCall = 0;
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async () =>
        new ScorelRuntime({
          provider: {
            streamTurn: async function* () {
              providerCall += 1;
              await release.promise;
              return assistantMessage("ok");
            },
          },
        }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_steer"),
      meta: { projectId: project.projectId },
    });
    void transport.send({
      type: "send_message",
      requestId: asRequestId("req_first"),
      sessionId: asSessionId("ses_steer"),
      content: "first",
    });
    await eventually(() => expect(providerCall).toBe(1));

    const steerResponse = waitForResponse(transport, "req_steer");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_steer"),
      sessionId: asSessionId("ses_steer"),
      content: "guide current run",
      options: { runningBehavior: "steer" },
    });

    await expect(steerResponse).resolves.toMatchObject({
      type: "response",
      requestType: "send_message",
      data: { status: "queued", queue: "steer", queueItemId: expect.any(String) },
    });
    const events = (await readFile(join(sessionsDir, "ses_steer.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line) as { type: string; queue?: string; items?: unknown[] });
    const queueEvent = events.find((event) => event.type === "queue_update" && event.queue === "steer");
    expect(queueEvent?.items).toHaveLength(1);
    expect(events.some((event) => event.type === "queue_update" && event.queue === "follow_up")).toBe(false);

    release.resolve();
  });

  it("syncs skill index before a user turn and registers the Skill tool", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorel-host-skills-"));
    const sessionsDir = join(root, "sessions");
    const projectsPath = join(root, "projects.json");
    const repo = join(root, "repo");
    await mkdir(join(repo, ".scorel", "skills", "verify"), { recursive: true });
    await mkdir(sessionsDir);
    await writeFile(join(repo, ".scorel", "skills", "verify", "SKILL.md"), "---\ndescription: verify repo\n---\nRun checks.");
    const providerTurns: RuntimeProviderTurn[] = [];
    const host = new ScorelHost({
      sessionsDir,
      projectsPath,
      deviceId: asDeviceId("device_test"),
      createRuntime: async () =>
        new ScorelRuntime({
          provider: {
            streamTurn: async function* (turn) {
              providerTurns.push(turn);
              return assistantMessage("ok");
            },
          },
        }),
      now: () => 1_000,
    });
    await host.start();
    const project = await host.registerProject(repo);
    const transport = createEmbeddedTransport(host);
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_create"),
      sessionId: asSessionId("ses_skills"),
      meta: { projectId: project.projectId },
    });
    const response = waitForResponse(transport, "req_send");
    await transport.send({
      type: "send_message",
      requestId: asRequestId("req_send"),
      sessionId: asSessionId("ses_skills"),
      content: "hello",
    });
    await expect(response).resolves.toMatchObject({ type: "response", requestType: "send_message" });

    const events = (await readFile(join(sessionsDir, "ses_skills.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line) as { type: string; entries?: Array<{ name: string }>; item?: { kind: string } });
    expect(events.map((event) => event.type).slice(0, 4)).toEqual([
      "instruction_snapshot",
      "skill_index_snapshot",
      "harness_item",
      "user_message",
    ]);
    expect(events.find((event) => event.type === "skill_index_snapshot")?.entries?.map((entry) => entry.name)).toEqual([
      "verify",
    ]);
    expect(events.find((event) => event.type === "harness_item")?.item?.kind).toBe("skill_listing");
    expect(providerTurns[0]?.context[0]?.content[0]).toEqual({
      type: "text",
      text: "<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- verify: verify repo\n</system-reminder>",
    });
    expect(providerTurns[0]?.tools.map((tool) => tool.name)).toContain("Skill");
  });

  it("rejects creating a session for an unregistered project", async () => {
    const { host } = await fixture();
    const transport = createEmbeddedTransport(host);
    const response = waitForResponse(transport, "req_missing");
    await transport.connect({ clientId: asClientId("client_test") });
    await transport.send({
      type: "create_session",
      requestId: asRequestId("req_missing"),
      sessionId: asSessionId("ses_missing"),
      meta: { projectId: "prj_missing" as never },
    });
    await expect(response).resolves.toMatchObject({ type: "error", code: "project_not_found" });
  });
});

const waitForResponse = (transport: ReturnType<typeof createEmbeddedTransport>, requestId: string): Promise<DaemonMessage> =>
  new Promise((resolve) => {
    transport.onMessage((message) => {
      if ("requestId" in message && message.requestId === requestId) {
        resolve(message);
      }
    });
  });

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const eventually = async (assertion: () => void): Promise<void> => {
  let lastError: unknown;
  for (let i = 0; i < 50; i += 1) {
    try {
      assertion();
      return;
    } catch (cause) {
      lastError = cause;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
};
