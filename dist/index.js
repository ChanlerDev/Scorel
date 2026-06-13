#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/protocol/src/ids.ts
var asSessionId, asEventId, asClientId, asDeviceId, asProjectId, asRequestId, asSeq;
var init_ids = __esm({
  "packages/protocol/src/ids.ts"() {
    "use strict";
    asSessionId = (value) => value;
    asEventId = (value) => value;
    asClientId = (value) => value;
    asDeviceId = (value) => value;
    asProjectId = (value) => value;
    asRequestId = (value) => value;
    asSeq = (value) => value;
  }
});

// packages/protocol/src/messages.ts
var init_messages = __esm({
  "packages/protocol/src/messages.ts"() {
    "use strict";
  }
});

// packages/protocol/src/events.ts
var init_events = __esm({
  "packages/protocol/src/events.ts"() {
    "use strict";
  }
});

// packages/protocol/src/wire.ts
var init_wire = __esm({
  "packages/protocol/src/wire.ts"() {
    "use strict";
  }
});

// packages/protocol/src/transport.ts
var init_transport = __esm({
  "packages/protocol/src/transport.ts"() {
    "use strict";
  }
});

// packages/protocol/src/relay.ts
var init_relay = __esm({
  "packages/protocol/src/relay.ts"() {
    "use strict";
  }
});

// packages/protocol/src/index.ts
var init_src = __esm({
  "packages/protocol/src/index.ts"() {
    "use strict";
    init_ids();
    init_messages();
    init_events();
    init_wire();
    init_transport();
    init_relay();
  }
});

// packages/client/src/relay-transport.ts
var init_relay_transport = __esm({
  "packages/client/src/relay-transport.ts"() {
    "use strict";
  }
});

// packages/client/src/index.ts
function isTransportDisconnectedError(cause) {
  if (cause instanceof TransportDisconnectedError) return true;
  if (typeof cause !== "object" || cause === null) return false;
  return cause.code === "transport_disconnected";
}
function toTransportError(cause) {
  if (cause instanceof TransportDisconnectedError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new TransportDisconnectedError(message);
}
function isTransportNotConnected(cause) {
  if (cause instanceof TransportDisconnectedError) return true;
  if (cause instanceof Error) {
    return /not connected/i.test(cause.message) && /transport/i.test(cause.message);
  }
  const text = String(cause);
  return /not connected/i.test(text) && /transport/i.test(text);
}
function wrapTransportThrow(cause) {
  if (isTransportDisconnectedError(cause) || isTransportNotConnected(cause)) {
    throw toTransportError(cause);
  }
  throw cause;
}
var clientPackageName, TransportDisconnectedError, websocketOpenState, DaemonClient, maxSeq, WsTransport;
var init_src2 = __esm({
  "packages/client/src/index.ts"() {
    "use strict";
    init_src();
    init_relay_transport();
    clientPackageName = "@scorel/client";
    TransportDisconnectedError = class extends Error {
      code = "transport_disconnected";
      constructor(message) {
        super(message);
        this.name = "TransportDisconnectedError";
      }
    };
    websocketOpenState = 1;
    DaemonClient = class {
      clientId;
      #transport;
      #createRequestId;
      #pending = /* @__PURE__ */ new Map();
      #subscribers = /* @__PURE__ */ new Set();
      #events = [];
      #unsubscribe;
      #state = "disconnected";
      #sessionId = null;
      #persistentLastSeq = asSeq(0);
      #streamLastSeq = asSeq(0);
      #connectionIdentity = {};
      #requestCounter = 0;
      constructor(transport, options) {
        this.#transport = transport;
        this.clientId = options.clientId;
        this.#createRequestId = options.createRequestId ?? (() => {
          this.#requestCounter += 1;
          return asRequestId(`req_${this.#requestCounter}`);
        });
      }
      get state() {
        return this.#state;
      }
      get sessionId() {
        return this.#sessionId;
      }
      get lastSeq() {
        return this.#streamLastSeq;
      }
      get persistentLastSeq() {
        return this.#persistentLastSeq;
      }
      get streamLastSeq() {
        return this.#streamLastSeq;
      }
      get connectionIdentity() {
        return { ...this.#connectionIdentity };
      }
      async connect(sessionId) {
        try {
          this.#state = "connecting";
          this.#unsubscribe ??= this.#transport.onMessage((message) => this.#handleMessage(message));
          const result = await this.#transport.connect({
            clientId: this.clientId,
            sessionId,
            persistentLastSeq: this.#persistentLastSeq,
            streamLastSeq: this.#streamLastSeq,
            lastSeq: this.#streamLastSeq
          });
          this.#sessionId = result.sessionId ?? sessionId ?? null;
          this.#connectionIdentity = {
            deviceId: result.deviceId,
            deviceDisplayName: result.deviceDisplayName
          };
          this.#state = "connected";
        } catch (cause) {
          wrapTransportThrow(cause);
        }
      }
      disconnect() {
        try {
          this.#transport.send({ type: "disconnect", sessionId: this.#sessionId ?? void 0 });
        } catch (cause) {
          if (!isTransportNotConnected(cause)) {
            console.warn("[scorel/client] transport.send(disconnect) threw:", cause);
          }
        }
        try {
          this.#transport.close();
        } catch {
        }
        this.#unsubscribe?.();
        this.#unsubscribe = void 0;
        this.#state = "disconnected";
      }
      async createSession(input) {
        const response = await this.#request("create_session", { meta: input.meta, sessionId: input.sessionId });
        return response.sessionId;
      }
      async loadSession(sessionId) {
        const response = await this.#request("load_session", { sessionId, lastSeq: this.#persistentLastSeq });
        this.#sessionId = response.sessionId;
        for (const event of response.events) {
          this.#recordEvent(event);
        }
        this.#persistentLastSeq = maxSeq(this.#persistentLastSeq, response.currentSeq);
        this.#streamLastSeq = maxSeq(this.#streamLastSeq, response.currentSeq);
        return response;
      }
      async sendMessage(content, options) {
        if (!this.#sessionId) {
          throw new Error("DaemonClient is not connected to a session");
        }
        return this.#request("send_message", { sessionId: this.#sessionId, content, options });
      }
      async cancel() {
        if (!this.#sessionId) {
          throw new Error("DaemonClient is not connected to a session");
        }
        return this.#request("cancel", { sessionId: this.#sessionId });
      }
      async rewriteQueue(queue, items) {
        if (!this.#sessionId) {
          throw new Error("DaemonClient is not connected to a session");
        }
        return (await this.#request("rewrite_queue", {
          sessionId: this.#sessionId,
          queue,
          items
        })).items;
      }
      async listSessions(filter) {
        this.#assertDaemonConnected();
        const response = await this.#request("list_sessions", {
          projectId: filter?.projectId,
          limit: filter?.limit
        });
        return response.sessions;
      }
      async listProjects() {
        this.#assertDaemonConnected();
        const response = await this.#request("list_projects", {});
        return response.projects;
      }
      async listModels(filter) {
        this.#assertDaemonConnected();
        return this.#request("list_models", { projectId: filter?.projectId });
      }
      async upsertModelProfile(input) {
        this.#assertDaemonConnected();
        return this.#request("upsert_model_profile", input);
      }
      async fetchProviderModels(input) {
        this.#assertDaemonConnected();
        return (await this.#request("fetch_provider_models", input)).models;
      }
      async removeModelProvider(input) {
        this.#assertDaemonConnected();
        return this.#request("remove_model_provider", input);
      }
      async getMemorySettings(input) {
        this.#assertDaemonConnected();
        return (await this.#request("get_memory_settings", input)).memory;
      }
      async getMemoryStatus(input) {
        this.#assertDaemonConnected();
        return (await this.#request("get_memory_status", input)).status;
      }
      async upsertMemorySettings(input) {
        this.#assertDaemonConnected();
        return (await this.#request("upsert_memory_settings", input)).memory;
      }
      async getRuntimeSettings(input) {
        this.#assertDaemonConnected();
        return (await this.#request("get_runtime_settings", input)).runtime;
      }
      async upsertRuntimeSettings(input) {
        this.#assertDaemonConnected();
        return (await this.#request("upsert_runtime_settings", input)).runtime;
      }
      async getExtensionSettings(input) {
        this.#assertDaemonConnected();
        return (await this.#request("get_extension_settings", input)).extension;
      }
      async upsertExtensionSettings(input) {
        this.#assertDaemonConnected();
        return (await this.#request("upsert_extension_settings", input)).extension;
      }
      async listDirectories(path) {
        this.#assertDaemonConnected();
        return this.#request("list_directories", { path });
      }
      async registerProject(workDir) {
        this.#assertDaemonConnected();
        return (await this.#request("register_project", { workDir })).project;
      }
      async removeProject(projectId) {
        this.#assertDaemonConnected();
        return (await this.#request("remove_project", { projectId })).removed;
      }
      #assertDaemonConnected() {
        if (this.#state !== "connected") {
          throw new Error("DaemonClient is not connected to a daemon");
        }
      }
      async resync(anchors) {
        if (!this.#sessionId) {
          throw new Error("DaemonClient is not connected to a session");
        }
        const legacyFromSeq = typeof anchors === "number" ? anchors : void 0;
        const response = await this.#request("resync_events", {
          sessionId: this.#sessionId,
          fromSeq: legacyFromSeq,
          persistentLastSeq: typeof anchors === "object" ? anchors.persistentLastSeq : this.#persistentLastSeq,
          streamLastSeq: typeof anchors === "object" ? anchors.streamLastSeq : legacyFromSeq ?? this.#streamLastSeq
        });
        if (response.mode === "full_reload") {
          this.#events.length = 0;
          this.#persistentLastSeq = asSeq(0);
        }
        for (const event of response.events) {
          this.#recordEvent(event);
          for (const subscriber of this.#subscribers) {
            subscriber(event);
          }
        }
        if (response.mode === "persistent_fallback" || response.mode === "full_reload") {
          this.#persistentLastSeq = maxSeq(this.#persistentLastSeq, response.throughSeq);
          this.#streamLastSeq = maxSeq(this.#streamLastSeq, response.throughSeq);
        } else {
          this.#streamLastSeq = maxSeq(this.#streamLastSeq, response.throughSeq);
        }
        return response;
      }
      subscribe(handler) {
        this.#subscribers.add(handler);
        return () => {
          this.#subscribers.delete(handler);
        };
      }
      getEvents() {
        return [...this.#events];
      }
      getActiveLeaf() {
        return this.#events.at(-1)?.id ?? null;
      }
      #request(type, payload) {
        const requestId = this.#createRequestId();
        const request = {
          type,
          requestId,
          ...payload
        };
        return new Promise((resolve7, reject) => {
          this.#pending.set(String(requestId), { resolve: resolve7, reject });
          try {
            this.#transport.send(request);
          } catch (cause) {
            this.#pending.delete(String(requestId));
            if (isTransportDisconnectedError(cause) || isTransportNotConnected(cause)) {
              reject(toTransportError(cause));
            } else {
              reject(cause instanceof Error ? cause : new Error(String(cause)));
            }
          }
        });
      }
      #handleMessage(message) {
        switch (message.type) {
          case "event":
            this.#recordEvent(message.event);
            for (const subscriber of this.#subscribers) {
              subscriber(message.event);
            }
            break;
          case "response": {
            const pending = this.#pending.get(String(message.requestId));
            if (pending) {
              this.#pending.delete(String(message.requestId));
              pending.resolve(message.data);
            }
            break;
          }
          case "error": {
            if (message.requestId) {
              const pending = this.#pending.get(String(message.requestId));
              if (pending) {
                this.#pending.delete(String(message.requestId));
                pending.reject(new Error(message.message));
              }
            }
            break;
          }
          case "connected":
            this.#sessionId = message.sessionId ?? this.#sessionId;
            this.#connectionIdentity = {
              deviceId: message.deviceId ?? this.#connectionIdentity.deviceId,
              deviceDisplayName: message.deviceDisplayName ?? this.#connectionIdentity.deviceDisplayName
            };
            break;
          case "disconnected":
            this.#state = "disconnected";
            break;
          case "pong":
            break;
        }
      }
      #recordEvent(event) {
        this.#streamLastSeq = maxSeq(this.#streamLastSeq, event.seq);
        if ("id" in event) {
          this.#persistentLastSeq = maxSeq(this.#persistentLastSeq, event.seq);
          const existingIndex = this.#events.findIndex((candidate) => candidate.id === event.id);
          if (existingIndex >= 0) {
            this.#events[existingIndex] = event;
          } else {
            this.#events.push(event);
          }
        }
      }
    };
    maxSeq = (left, right) => asSeq(Math.max(Number(left), Number(right)));
    WsTransport = class {
      url;
      #token;
      #createWebSocket;
      #handlers = /* @__PURE__ */ new Set();
      #socket;
      constructor(options) {
        this.url = options.url;
        this.#token = options.token;
        this.#createWebSocket = options.createWebSocket ?? ((url) => {
          if (typeof WebSocket === "undefined") {
            throw new Error("WebSocket is not available in this runtime");
          }
          return new WebSocket(url);
        });
      }
      connect(params) {
        return new Promise((resolve7, reject) => {
          const socket = this.#createWebSocket(this.url);
          this.#socket = socket;
          const rejectOnError = (event) => {
            socket.removeEventListener("error", rejectOnError);
            reject(event instanceof Error ? event : new Error("WebSocket connection failed"));
          };
          socket.addEventListener("error", rejectOnError, { once: true });
          socket.addEventListener("message", (event) => this.#handleMessageData(event.data));
          const unsubscribe = this.onMessage((message) => {
            if (message.type === "error") {
              unsubscribe();
              socket.removeEventListener("error", rejectOnError);
              reject(new Error(message.message));
              return;
            }
            if (message.type !== "connected") {
              return;
            }
            unsubscribe();
            socket.removeEventListener("error", rejectOnError);
            resolve7({
              clientId: message.clientId,
              sessionId: message.sessionId,
              currentSeq: message.currentSeq,
              deviceId: message.deviceId,
              deviceDisplayName: message.deviceDisplayName
            });
          });
          socket.addEventListener(
            "open",
            () => {
              this.#write({ type: "connect", ...params, token: this.#token });
            },
            { once: true }
          );
        });
      }
      send(message) {
        this.#write(message);
      }
      onMessage(handler) {
        this.#handlers.add(handler);
        return () => {
          this.#handlers.delete(handler);
        };
      }
      close() {
        this.#socket?.close();
        this.#socket = void 0;
        this.#handlers.clear();
      }
      #write(message) {
        if (!this.#socket || this.#socket.readyState !== websocketOpenState) {
          throw new Error("WsTransport is not connected");
        }
        this.#socket.send(JSON.stringify(message));
      }
      #handleMessageData(data) {
        const text = typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : String(data);
        const message = JSON.parse(text);
        for (const handler of this.#handlers) {
          handler(message);
        }
      }
    };
  }
});

// packages/daemon/src/projects/registry.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
var ProjectRegistryError, ProjectRegistry, canonicalDirectory, sessionReferencesProject, sortProjects, isRegistryFile, isRecord, isNodeError, errorMessage;
var init_registry = __esm({
  "packages/daemon/src/projects/registry.ts"() {
    "use strict";
    init_src();
    ProjectRegistryError = class extends Error {
      code;
      constructor(code, message) {
        super(message);
        this.name = "ProjectRegistryError";
        this.code = code;
      }
    };
    ProjectRegistry = class {
      #projectsPath;
      #sessionsDir;
      #createId;
      #now;
      #mutation = Promise.resolve();
      constructor(options) {
        this.#projectsPath = options.projectsPath;
        this.#sessionsDir = options.sessionsDir;
        this.#createId = options.createId ?? randomUUID;
        this.#now = options.now ?? Date.now;
      }
      async list() {
        const file = await this.#read();
        return sortProjects(file.projects);
      }
      async get(projectId) {
        return (await this.list()).find((project) => project.projectId === projectId);
      }
      async require(projectId) {
        const project = await this.get(projectId);
        if (!project) {
          throw new ProjectRegistryError("project_not_found", `Unknown project: ${projectId}`);
        }
        return project;
      }
      async register(workDir) {
        return this.#mutate(async (file) => {
          const canonical = await canonicalDirectory(workDir);
          const existing = file.projects.find((project2) => project2.workDir === canonical);
          if (existing) {
            return { result: existing, changed: false };
          }
          const now = this.#now();
          const project = {
            projectId: asProjectId(`prj_${this.#createId()}`),
            displayName: basename(canonical) || canonical,
            workDir: canonical,
            createdAt: now,
            updatedAt: now
          };
          file.projects.push(project);
          return { result: project, changed: true };
        });
      }
      async remove(projectId) {
        return this.#mutate(async (file) => {
          const index = file.projects.findIndex((project) => project.projectId === projectId);
          if (index < 0) {
            throw new ProjectRegistryError("project_not_found", `Unknown project: ${projectId}`);
          }
          if (await sessionReferencesProject(this.#sessionsDir, projectId)) {
            throw new ProjectRegistryError("project_has_sessions", `Project still has sessions: ${projectId}`);
          }
          file.projects.splice(index, 1);
          return { result: true, changed: true };
        });
      }
      async #mutate(mutation) {
        const operation = this.#mutation.then(async () => {
          const file = await this.#read();
          const { result, changed } = await mutation(file);
          if (changed) {
            await this.#write({ version: 1, projects: sortProjects(file.projects) });
          }
          return result;
        });
        this.#mutation = operation.then(
          () => void 0,
          () => void 0
        );
        return operation;
      }
      async #read() {
        try {
          const parsed = JSON.parse(await readFile(this.#projectsPath, "utf8"));
          if (!isRegistryFile(parsed)) {
            throw new ProjectRegistryError("filesystem_error", `Invalid project registry: ${this.#projectsPath}`);
          }
          return { version: 1, projects: parsed.projects.map((project) => ({ ...project })) };
        } catch (cause) {
          if (isNodeError(cause, "ENOENT")) {
            return { version: 1, projects: [] };
          }
          if (cause instanceof ProjectRegistryError) {
            throw cause;
          }
          throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
        }
      }
      async #write(file) {
        await mkdir(dirname(this.#projectsPath), { recursive: true });
        const temporaryPath = `${this.#projectsPath}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}
`, "utf8");
          await rename(temporaryPath, this.#projectsPath);
        } catch (cause) {
          throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
        }
      }
    };
    canonicalDirectory = async (workDir) => {
      try {
        const canonical = await realpath(workDir);
        if (!(await stat(canonical)).isDirectory()) {
          throw new ProjectRegistryError("filesystem_error", `Project path is not a directory: ${workDir}`);
        }
        return canonical;
      } catch (cause) {
        if (cause instanceof ProjectRegistryError) {
          throw cause;
        }
        throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
      }
    };
    sessionReferencesProject = async (sessionsDir, projectId) => {
      let names;
      try {
        names = await readdir(sessionsDir);
      } catch (cause) {
        if (isNodeError(cause, "ENOENT")) {
          return false;
        }
        throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
      }
      for (const name of names) {
        if (!name.endsWith(".jsonl") || name.startsWith(".")) {
          continue;
        }
        try {
          const firstLine = (await readFile(join(sessionsDir, name), "utf8")).split(/\r?\n/, 1)[0];
          const parsed = firstLine ? JSON.parse(firstLine) : void 0;
          if (isRecord(parsed) && isRecord(parsed.meta) && parsed.meta.projectId === projectId) {
            return true;
          }
        } catch (cause) {
          if (!isNodeError(cause, "ENOENT")) {
            throw new ProjectRegistryError("filesystem_error", errorMessage(cause));
          }
        }
      }
      return false;
    };
    sortProjects = (projects) => [...projects].sort((left, right) => String(left.projectId).localeCompare(String(right.projectId)));
    isRegistryFile = (value) => isRecord(value) && value.version === 1 && Array.isArray(value.projects) && value.projects.every(
      (project) => isRecord(project) && typeof project.projectId === "string" && typeof project.displayName === "string" && typeof project.workDir === "string" && typeof project.createdAt === "number" && typeof project.updatedAt === "number"
    );
    isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    isNodeError = (cause, code) => cause instanceof Error && "code" in cause && cause.code === code;
    errorMessage = (cause) => cause instanceof Error ? cause.message : String(cause);
  }
});

// packages/daemon/src/projects/directories.ts
import { homedir } from "node:os";
import { dirname as dirname2, join as join2 } from "node:path";
import { readdir as readdir2, realpath as realpath2, stat as stat2 } from "node:fs/promises";
var listDirectories, directoryEntries, errorMessage2;
var init_directories = __esm({
  "packages/daemon/src/projects/directories.ts"() {
    "use strict";
    init_registry();
    listDirectories = async (path = homedir()) => {
      try {
        const canonical = await realpath2(path);
        if (!(await stat2(canonical)).isDirectory()) {
          throw new ProjectRegistryError("filesystem_error", `Path is not a directory: ${path}`);
        }
        const entries = await directoryEntries(canonical);
        const parent = dirname2(canonical);
        return {
          path: canonical,
          parentPath: parent === canonical ? void 0 : parent,
          entries
        };
      } catch (cause) {
        if (cause instanceof ProjectRegistryError) {
          throw cause;
        }
        throw new ProjectRegistryError("filesystem_error", errorMessage2(cause));
      }
    };
    directoryEntries = async (path) => {
      const entries = await readdir2(path, { withFileTypes: true });
      const directories = await Promise.all(
        entries.map(async (entry) => {
          const candidate = join2(path, entry.name);
          if (!entry.isDirectory() && !entry.isSymbolicLink()) {
            return void 0;
          }
          try {
            const canonical = await realpath2(candidate);
            return (await stat2(canonical)).isDirectory() ? { name: entry.name, path: canonical, kind: "directory" } : void 0;
          } catch {
            return void 0;
          }
        })
      );
      return directories.filter((entry) => entry !== void 0).sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
    };
    errorMessage2 = (cause) => cause instanceof Error ? cause.message : String(cause);
  }
});

// packages/daemon/src/projects/sessions.ts
import { readFile as readFile2, readdir as readdir3 } from "node:fs/promises";
import { join as join3 } from "node:path";
var listSessionSummaries, readSummary, tailSeq, latestTitle, clampLimit, parseRecord, isRecord2, isNodeError2;
var init_sessions = __esm({
  "packages/daemon/src/projects/sessions.ts"() {
    "use strict";
    init_src();
    listSessionSummaries = async (sessionsDir, filter = {}, overrides) => {
      let names;
      try {
        names = await readdir3(sessionsDir);
      } catch (cause) {
        if (isNodeError2(cause, "ENOENT")) {
          return [];
        }
        throw cause;
      }
      const sessions = (await Promise.all(
        names.filter((name) => name.endsWith(".jsonl") && !name.startsWith(".")).map((name) => readSummary(join3(sessionsDir, name), overrides))
      )).filter((session) => session !== void 0).filter((session) => filter.projectId === void 0 || session.projectId === filter.projectId).sort((left, right) => right.updatedAt - left.updatedAt || String(left.sessionId).localeCompare(String(right.sessionId)));
      return sessions.slice(0, clampLimit(filter.limit));
    };
    readSummary = async (filePath, overrides) => {
      let content;
      try {
        content = await readFile2(filePath, "utf8");
      } catch (cause) {
        if (isNodeError2(cause, "ENOENT")) {
          return void 0;
        }
        throw cause;
      }
      const lines = content.split(/\r?\n/).filter(Boolean);
      const header = parseRecord(lines[0]);
      if (header?.version !== 1 || typeof header.sessionId !== "string" || typeof header.createdAt !== "number" || !isRecord2(header.meta) || typeof header.meta.projectId !== "string") {
        return void 0;
      }
      const override = overrides?.get(header.sessionId);
      const title = latestTitle(lines.slice(1)) ?? (typeof header.meta.title === "string" ? header.meta.title : void 0);
      return {
        sessionId: asSessionId(header.sessionId),
        projectId: asProjectId(header.meta.projectId),
        title,
        model: typeof header.meta.model === "string" ? header.meta.model : void 0,
        updatedAt: override?.updatedAt ?? (typeof header.meta.updatedAt === "number" ? header.meta.updatedAt : header.createdAt),
        currentSeq: asSeq(override?.currentSeq ?? tailSeq(lines.slice(1)))
      };
    };
    tailSeq = (lines) => {
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const event = parseRecord(lines[index]);
        if (typeof event?.seq === "number") {
          return event.seq;
        }
      }
      return 0;
    };
    latestTitle = (lines) => {
      let title;
      for (const line of lines) {
        const event = parseRecord(line);
        if (event?.type === "session_title_updated" && typeof event.title === "string" && event.title.trim()) {
          title = event.title.trim();
        }
      }
      return title;
    };
    clampLimit = (limit) => limit === void 0 || !Number.isFinite(limit) || limit <= 0 ? 200 : Math.min(Math.floor(limit), 1e3);
    parseRecord = (line) => {
      try {
        const value = line === void 0 ? void 0 : JSON.parse(line);
        return isRecord2(value) ? value : void 0;
      } catch {
        return void 0;
      }
    };
    isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    isNodeError2 = (cause, code) => cause instanceof Error && "code" in cause && cause.code === code;
  }
});

// packages/core/src/config/index.ts
import { readFile as readFile3 } from "node:fs/promises";
import { join as join4 } from "node:path";
var SCOREL_CONFIG_SCHEMA, scorelUserRoot, scorelUserConfigPath, scorelSessionsDir, scorelProjectConfigPath, loadScorelConfig, loadScorelConfigProfile, listProviderConnections, listAvailableModels, listProviderModels, resolveModelSelection, renderModelProfileConfig, removeProvider, renderMemoryConfig, renderRuntimeConfig, renderExtensionConfig, DEFAULT_MEMORY_CONFIG, DEFAULT_RUNTIME_CONFIG, loadMemory, loadRuntime, loadExtensions, loadProviders, loadProviderProfiles, loadProviderModels, loadAvailableModels, loadRoles, readConfigText, parseToml, parseEditableConfig, renderRawConfig, emptyRawConfig, stripComment, requireString, normalizeProviderName, requireProviderCredential, resolveProviderApiKey, providerCredentialSummary, requireNumber, requireNonNegativeNumber, requireCompactThreshold, requireBoolean, requireCustomApi, requireProviderType, requireSection, ensureSection, setConfigValue, assertKnownKey, setValue, parseTomlValue, stripTrailingSlashes, requireIdentifier, tomlString, renderTomlValue, requireModelRole, modelRoles;
var init_config = __esm({
  "packages/core/src/config/index.ts"() {
    "use strict";
    SCOREL_CONFIG_SCHEMA = {
      fixedPaths: {
        userRoot: "~/.scorel",
        userConfig: "~/.scorel/config.toml",
        sessionsDir: "~/.scorel/sessions",
        projectConfig: ".scorel/config.toml"
      },
      sections: {
        root: {
          keys: []
        },
        provider: {
          keys: ["type", "provider", "api", "baseUrl", "apiKeyEnv", "apiKey"]
        },
        providerModel: {
          keys: ["provider", "id", "displayName", "contextWindow", "maxTokens", "reasoning", "supportsDeveloperRole", "supportsImageInput"]
        },
        availableModel: {
          keys: ["model", "displayName"]
        },
        modelProfileRoles: {
          keys: ["primary", "standard", "auxiliary"]
        },
        memory: {
          keys: ["enabled", "daily", "sessionMemory", "autoDream", "promoteRoot", "dreamIdleMinutes", "autoCompactThreshold"]
        },
        runtime: {
          keys: ["tokenSavingRtk"]
        },
        extension: {
          keys: ["enabled", "kind"]
        },
        extensionConfig: {
          keys: []
        }
      }
    };
    scorelUserRoot = (homeDir) => join4(homeDir, ".scorel");
    scorelUserConfigPath = (homeDir) => join4(scorelUserRoot(homeDir), "config.toml");
    scorelSessionsDir = (homeDir) => join4(scorelUserRoot(homeDir), "sessions");
    scorelProjectConfigPath = (cwd) => join4(cwd, ".scorel", "config.toml");
    loadScorelConfig = async (options) => {
      const env = options.env ?? process.env;
      const raw = parseToml(await readConfigText(options));
      const providers = loadProviders(raw, env);
      const providerModels = loadProviderModels(raw, providers);
      const models = loadAvailableModels(raw, providerModels);
      const roles = loadRoles(raw, models);
      return {
        providers,
        providerModels,
        models,
        modelProfile: { roles },
        memory: loadMemory(raw),
        runtime: loadRuntime(raw),
        extensions: loadExtensions(raw)
      };
    };
    loadScorelConfigProfile = async (options) => {
      const env = options.env ?? process.env;
      const raw = parseToml(await readConfigText(options));
      const providers = loadProviderProfiles(raw, env, { includeSecrets: options.includeSecrets ?? false });
      const providerModels = loadProviderModels(raw, providers, { requireAny: false });
      const models = loadAvailableModels(raw, providerModels, { requireAny: false, includeAllProviderModels: false });
      const roles = loadRoles(raw, models, { requireComplete: false });
      return {
        providers,
        providerModels,
        models,
        modelProfile: { roles },
        memory: loadMemory(raw),
        runtime: loadRuntime(raw),
        extensions: loadExtensions(raw)
      };
    };
    listProviderConnections = (config) => Object.entries(config.providers).map(([providerId, provider]) => ({
      providerId,
      type: provider.type,
      provider: provider.provider,
      ...provider.type === "custom" ? { api: provider.api, baseUrl: provider.baseUrl } : {},
      ...provider.type === "builtin" && provider.baseUrl ? { baseUrl: provider.baseUrl } : {},
      ..."apiKeyEnv" in provider && provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {},
      credentialSource: "credentialSource" in provider ? provider.credentialSource : "apiKey" in provider ? "direct" : "env",
      credentialStatus: "credentialStatus" in provider ? provider.credentialStatus : "available"
    }));
    listAvailableModels = (config) => Object.entries(config.models).map(([modelId, available]) => {
      const providerModel = config.providerModels[available.model];
      if (!providerModel) {
        throw new Error(`available_models.${modelId}.model must reference a configured provider model`);
      }
      const provider = config.providers[providerModel.provider];
      if (!provider) {
        throw new Error(`provider_models.${available.model}.provider must reference a configured provider`);
      }
      return {
        modelId,
        providerModelId: available.model,
        providerId: providerModel.provider,
        provider: normalizeProviderName(provider.provider),
        id: providerModel.id,
        displayName: available.displayName ?? providerModel.displayName,
        roles: modelRoles(config, modelId),
        ...providerModel.contextWindow !== void 0 ? { contextWindow: providerModel.contextWindow } : {},
        ...providerModel.maxTokens !== void 0 ? { maxTokens: providerModel.maxTokens } : {},
        ...providerModel.reasoning !== void 0 ? { reasoning: providerModel.reasoning } : {},
        ...providerModel.compat?.supportsDeveloperRole !== void 0 ? { supportsDeveloperRole: providerModel.compat.supportsDeveloperRole } : {},
        ...providerModel.supportsImageInput !== void 0 ? { supportsImageInput: providerModel.supportsImageInput } : {}
      };
    });
    listProviderModels = (config) => Object.entries(config.providerModels).map(([providerModelId, model]) => {
      const provider = config.providers[model.provider];
      if (!provider) {
        throw new Error(`provider_models.${providerModelId}.provider must reference a configured provider`);
      }
      return {
        providerModelId,
        providerId: model.provider,
        provider: normalizeProviderName(provider.provider),
        id: model.id,
        displayName: model.displayName,
        availableModelIds: Object.entries(config.models).filter(([, available]) => available.model === providerModelId).map(([modelId]) => modelId),
        ...model.contextWindow !== void 0 ? { contextWindow: model.contextWindow } : {},
        ...model.maxTokens !== void 0 ? { maxTokens: model.maxTokens } : {},
        ...model.reasoning !== void 0 ? { reasoning: model.reasoning } : {},
        ...model.compat?.supportsDeveloperRole !== void 0 ? { supportsDeveloperRole: model.compat.supportsDeveloperRole } : {},
        ...model.supportsImageInput !== void 0 ? { supportsImageInput: model.supportsImageInput } : {}
      };
    });
    resolveModelSelection = (config, selection) => {
      const role = selection?.role ?? (selection?.modelId ? void 0 : "standard");
      const modelId = selection?.modelId ?? config.modelProfile.roles[role ?? "standard"];
      const model = config.models[modelId];
      if (!model) {
        throw new Error(`Unknown configured model: ${modelId}`);
      }
      const providerModel = config.providerModels[model.model];
      if (!providerModel) {
        throw new Error(`available_models.${modelId}.model must reference a configured provider model`);
      }
      const provider = config.providers[providerModel.provider];
      if (!provider) {
        throw new Error(`provider_models.${model.model}.provider must reference a configured provider`);
      }
      const displayName = model.displayName ?? providerModel.displayName;
      if (provider.type === "builtin") {
        return {
          modelId,
          role,
          displayName,
          providerId: providerModel.provider,
          config: {
            ...provider,
            id: providerModel.id,
            displayName
          }
        };
      }
      return {
        modelId,
        role,
        displayName,
        providerId: providerModel.provider,
        config: {
          ...provider,
          id: providerModel.id,
          displayName,
          ...providerModel.contextWindow !== void 0 ? { contextWindow: providerModel.contextWindow } : {},
          ...providerModel.maxTokens !== void 0 ? { maxTokens: providerModel.maxTokens } : {},
          ...providerModel.reasoning !== void 0 ? { reasoning: providerModel.reasoning } : {},
          ...providerModel.supportsImageInput !== void 0 ? { supportsImageInput: providerModel.supportsImageInput } : {},
          ...providerModel.compat ? { compat: providerModel.compat } : {}
        }
      };
    };
    renderModelProfileConfig = (input) => {
      const raw = parseEditableConfig(input.existingConfigText);
      if (input.removeProviderId) {
        removeProvider(raw, requireIdentifier(input.removeProviderId, "removeProviderId"));
      }
      if (input.providerType || input.provider || input.apiKeyEnv || input.apiKey || input.api || input.baseUrl) {
        const providerId = requireIdentifier(input.providerId, "providerId");
        const providerType = requireProviderType(input.providerType, "providerType");
        const existingProvider = raw.providers[providerId];
        raw.providers[providerId] = {
          type: providerType,
          provider: normalizeProviderName(requireString(input.provider, "provider"))
        };
        if (input.apiKey !== void 0) {
          raw.providers[providerId].apiKey = input.apiKey ? requireString(input.apiKey, "apiKey") : existingProvider?.apiKey;
        } else if (existingProvider?.apiKey) {
          raw.providers[providerId].apiKey = existingProvider.apiKey;
        }
        if (input.apiKeyEnv !== void 0) {
          raw.providers[providerId].apiKeyEnv = input.apiKeyEnv ? requireString(input.apiKeyEnv, "apiKeyEnv") : existingProvider?.apiKeyEnv;
        } else if (existingProvider?.apiKeyEnv) {
          raw.providers[providerId].apiKeyEnv = existingProvider.apiKeyEnv;
        }
        requireProviderCredential(raw.providers[providerId], `providers.${providerId}`);
        if (providerType === "custom") {
          raw.providers[providerId].api = requireCustomApi(input.api, "api");
          raw.providers[providerId].baseUrl = stripTrailingSlashes(requireString(input.baseUrl, "baseUrl"));
        } else {
          delete raw.providers[providerId].api;
          if (input.baseUrl) {
            raw.providers[providerId].baseUrl = stripTrailingSlashes(input.baseUrl);
          } else {
            delete raw.providers[providerId].baseUrl;
          }
        }
      }
      if (input.providerModelKey || input.providerModelId || input.displayName || input.contextWindow !== void 0 || input.maxTokens !== void 0 || input.reasoning !== void 0 || input.supportsDeveloperRole !== void 0 || input.supportsImageInput !== void 0) {
        const providerId = requireIdentifier(input.providerId, "providerId");
        const providerModelKey = requireIdentifier(input.providerModelKey ?? `${providerId}_${input.availableModelId ?? input.modelId ?? "main"}`, "providerModelKey");
        const providerType = raw.providers[providerId]?.type ?? input.providerType;
        raw.providerModels[providerModelKey] = {
          provider: providerId,
          id: requireString(input.providerModelId, "providerModelId"),
          displayName: requireString(input.displayName, "displayName")
        };
        if (providerType === "custom" && input.contextWindow !== void 0) {
          raw.providerModels[providerModelKey].contextWindow = requireNumber(input.contextWindow, "contextWindow");
        }
        if (providerType === "custom" && input.maxTokens !== void 0) {
          raw.providerModels[providerModelKey].maxTokens = requireNumber(input.maxTokens, "maxTokens");
        }
        if (providerType === "custom" && input.reasoning !== void 0) {
          raw.providerModels[providerModelKey].reasoning = requireBoolean(input.reasoning, "reasoning");
        }
        if (providerType === "custom" && input.supportsImageInput !== void 0) {
          raw.providerModels[providerModelKey].supportsImageInput = requireBoolean(input.supportsImageInput, "supportsImageInput");
        }
        if (providerType === "custom" && input.supportsDeveloperRole !== void 0) {
          raw.providerModels[providerModelKey].supportsDeveloperRole = requireBoolean(input.supportsDeveloperRole, "supportsDeveloperRole");
        }
        if (providerType !== "custom") {
          delete raw.providerModels[providerModelKey].contextWindow;
          delete raw.providerModels[providerModelKey].maxTokens;
          delete raw.providerModels[providerModelKey].reasoning;
          delete raw.providerModels[providerModelKey].supportsDeveloperRole;
          delete raw.providerModels[providerModelKey].supportsImageInput;
        }
      }
      if (input.addToAvailable === true || input.availableModelId || input.modelId) {
        const providerId = input.providerId ? requireIdentifier(input.providerId, "providerId") : void 0;
        const providerModelKey = requireIdentifier(input.providerModelKey ?? (providerId ? `${providerId}_${input.availableModelId ?? input.modelId ?? "main"}` : void 0), "providerModelKey");
        const availableModelId = requireIdentifier(input.availableModelId ?? input.modelId, "availableModelId");
        raw.availableModels[availableModelId] = {
          model: providerModelKey,
          ...input.displayName ? { displayName: input.displayName } : {}
        };
      }
      if (input.removeAvailableModelId) {
        const availableModelId = requireIdentifier(input.removeAvailableModelId, "removeAvailableModelId");
        delete raw.availableModels[availableModelId];
        if (raw.modelProfile?.roles) {
          const fallbackModelId = Object.keys(raw.availableModels).sort()[0];
          if (!fallbackModelId) {
            delete raw.modelProfile;
          } else {
            for (const role of ["primary", "standard", "auxiliary"]) {
              if (raw.modelProfile.roles[role] === availableModelId) {
                raw.modelProfile.roles[role] = fallbackModelId;
              }
            }
          }
        }
      }
      if (input.roles) {
        raw.modelProfile ??= {};
        raw.modelProfile.roles = {
          primary: requireIdentifier(input.roles.primary, "roles.primary"),
          standard: requireIdentifier(input.roles.standard, "roles.standard"),
          auxiliary: requireIdentifier(input.roles.auxiliary, "roles.auxiliary")
        };
      } else if (!raw.modelProfile?.roles && Object.keys(raw.availableModels).length > 0) {
        const firstAvailableModel = Object.keys(raw.availableModels).sort()[0];
        raw.modelProfile = {
          roles: {
            primary: firstAvailableModel,
            standard: firstAvailableModel,
            auxiliary: firstAvailableModel
          }
        };
      }
      return renderRawConfig(raw);
    };
    removeProvider = (raw, providerId) => {
      delete raw.providers[providerId];
      const removedProviderModels = /* @__PURE__ */ new Set();
      for (const [providerModelId, providerModel] of Object.entries(raw.providerModels)) {
        if (providerModel.provider === providerId) {
          delete raw.providerModels[providerModelId];
          removedProviderModels.add(providerModelId);
        }
      }
      const removedAvailableModels = /* @__PURE__ */ new Set();
      for (const [availableModelId, availableModel] of Object.entries(raw.availableModels)) {
        if (availableModel.model && removedProviderModels.has(availableModel.model)) {
          delete raw.availableModels[availableModelId];
          removedAvailableModels.add(availableModelId);
        }
      }
      if (!raw.modelProfile?.roles) return;
      const fallbackModelId = Object.keys(raw.availableModels).sort()[0];
      if (!fallbackModelId) {
        delete raw.modelProfile;
        return;
      }
      for (const role of ["primary", "standard", "auxiliary"]) {
        if (!raw.modelProfile.roles[role] || removedAvailableModels.has(raw.modelProfile.roles[role])) {
          raw.modelProfile.roles[role] = fallbackModelId;
        }
      }
    };
    renderMemoryConfig = (input) => {
      const raw = parseEditableConfig(input.existingConfigText);
      raw.memory = {
        ...loadMemory(raw),
        ...input.enabled !== void 0 ? { enabled: requireBoolean(input.enabled, "memory.enabled") } : {},
        ...input.daily !== void 0 ? { daily: requireBoolean(input.daily, "memory.daily") } : {},
        ...input.sessionMemory !== void 0 ? { sessionMemory: requireBoolean(input.sessionMemory, "memory.sessionMemory") } : {},
        ...input.autoDream !== void 0 ? { autoDream: requireBoolean(input.autoDream, "memory.autoDream") } : {},
        ...input.promoteRoot !== void 0 ? { promoteRoot: requireBoolean(input.promoteRoot, "memory.promoteRoot") } : {},
        ...input.dreamIdleMinutes !== void 0 ? { dreamIdleMinutes: requireNonNegativeNumber(input.dreamIdleMinutes, "memory.dreamIdleMinutes") } : {},
        ...input.autoCompactThreshold !== void 0 ? { autoCompactThreshold: requireCompactThreshold(input.autoCompactThreshold) } : {}
      };
      return renderRawConfig(raw);
    };
    renderRuntimeConfig = (input) => {
      const raw = parseEditableConfig(input.existingConfigText);
      raw.runtime = {
        ...loadRuntime(raw),
        ...input.tokenSavingRtk !== void 0 ? { tokenSavingRtk: requireBoolean(input.tokenSavingRtk, "runtime.tokenSavingRtk") } : {}
      };
      return renderRawConfig(raw);
    };
    renderExtensionConfig = (input) => {
      const raw = parseEditableConfig(input.existingConfigText);
      const extensionId = requireIdentifier(input.extensionId, "extensionId");
      const existing = raw.extensions[extensionId] ?? {};
      const config = { ...existing.config ?? {} };
      for (const [key, value] of Object.entries(input.config ?? {})) {
        if (!/^[A-Za-z0-9_-]+$/.test(key)) {
          throw new Error(`Unsupported config key: ${key}`);
        }
        if (value === void 0 || value === "") {
          delete config[key];
        } else {
          config[key] = value;
        }
      }
      raw.extensions[extensionId] = {
        enabled: input.enabled ?? existing.enabled ?? false,
        kind: input.kind ?? (existing.kind === "im" ? "im" : "im"),
        ...Object.keys(config).length > 0 ? { config } : {}
      };
      return renderRawConfig(raw);
    };
    DEFAULT_MEMORY_CONFIG = {
      enabled: true,
      daily: true,
      sessionMemory: true,
      autoDream: true,
      promoteRoot: true,
      dreamIdleMinutes: 60,
      autoCompactThreshold: 0.8
    };
    DEFAULT_RUNTIME_CONFIG = {
      tokenSavingRtk: false
    };
    loadMemory = (raw) => ({
      enabled: raw.memory?.enabled ?? DEFAULT_MEMORY_CONFIG.enabled,
      daily: raw.memory?.daily ?? DEFAULT_MEMORY_CONFIG.daily,
      sessionMemory: raw.memory?.sessionMemory ?? DEFAULT_MEMORY_CONFIG.sessionMemory,
      autoDream: raw.memory?.autoDream ?? DEFAULT_MEMORY_CONFIG.autoDream,
      promoteRoot: raw.memory?.promoteRoot ?? DEFAULT_MEMORY_CONFIG.promoteRoot,
      dreamIdleMinutes: requireNonNegativeNumber(raw.memory?.dreamIdleMinutes ?? DEFAULT_MEMORY_CONFIG.dreamIdleMinutes, "memory.dreamIdleMinutes"),
      autoCompactThreshold: requireCompactThreshold(raw.memory?.autoCompactThreshold ?? DEFAULT_MEMORY_CONFIG.autoCompactThreshold)
    });
    loadRuntime = (raw) => ({
      tokenSavingRtk: raw.runtime?.tokenSavingRtk ?? DEFAULT_RUNTIME_CONFIG.tokenSavingRtk
    });
    loadExtensions = (raw) => {
      const extensions = {};
      for (const [extensionId, extension] of Object.entries(raw.extensions)) {
        if (extension.kind !== "im") {
          throw new Error(`extensions.${extensionId}.kind must be im`);
        }
        extensions[extensionId] = {
          enabled: extension.enabled === true,
          kind: "im",
          config: extension.config ?? {}
        };
      }
      return extensions;
    };
    loadProviders = (raw, env) => {
      const providers = {};
      for (const [providerId, provider] of Object.entries(raw.providers)) {
        const apiKey = resolveProviderApiKey(provider, env, `providers.${providerId}`);
        if (provider.type === "builtin") {
          providers[providerId] = {
            type: "builtin",
            provider: normalizeProviderName(requireString(provider.provider, `providers.${providerId}.provider`)),
            ...provider.baseUrl ? { baseUrl: stripTrailingSlashes(provider.baseUrl) } : {},
            apiKey
          };
          continue;
        }
        if (provider.type === "custom") {
          providers[providerId] = {
            type: "custom",
            api: requireCustomApi(provider.api, `providers.${providerId}.api`),
            provider: normalizeProviderName(requireString(provider.provider, `providers.${providerId}.provider`)),
            baseUrl: stripTrailingSlashes(requireString(provider.baseUrl, `providers.${providerId}.baseUrl`)),
            apiKey
          };
          continue;
        }
        throw new Error(`providers.${providerId}.type must be builtin or custom`);
      }
      if (Object.keys(providers).length === 0) {
        throw new Error("at least one provider config is required");
      }
      return providers;
    };
    loadProviderProfiles = (raw, env, options = {}) => {
      const providers = {};
      for (const [providerId, provider] of Object.entries(raw.providers)) {
        const credential = providerCredentialSummary(provider, env);
        const base = {
          providerId,
          provider: normalizeProviderName(requireString(provider.provider, `providers.${providerId}.provider`)),
          ...credential,
          ...options.includeSecrets && provider.apiKey ? { apiKey: provider.apiKey } : {}
        };
        if (provider.type === "builtin") {
          providers[providerId] = {
            ...base,
            type: "builtin",
            ...provider.baseUrl ? { baseUrl: stripTrailingSlashes(provider.baseUrl) } : {}
          };
          continue;
        }
        if (provider.type === "custom") {
          providers[providerId] = {
            ...base,
            type: "custom",
            api: requireCustomApi(provider.api, `providers.${providerId}.api`),
            baseUrl: stripTrailingSlashes(requireString(provider.baseUrl, `providers.${providerId}.baseUrl`))
          };
          continue;
        }
        throw new Error(`providers.${providerId}.type must be builtin or custom`);
      }
      return providers;
    };
    loadProviderModels = (raw, providers, options = { requireAny: true }) => {
      const models = {};
      for (const [modelId, model] of Object.entries(raw.providerModels)) {
        const providerId = requireString(model.provider, `provider_models.${modelId}.provider`);
        const provider = providers[providerId];
        if (!provider) {
          throw new Error(`provider_models.${modelId}.provider must reference a configured provider`);
        }
        const loaded = {
          provider: providerId,
          id: requireString(model.id, `provider_models.${modelId}.id`),
          displayName: requireString(model.displayName, `provider_models.${modelId}.displayName`)
        };
        if (provider.type === "custom") {
          if (model.contextWindow !== void 0) {
            loaded.contextWindow = requireNumber(model.contextWindow, `provider_models.${modelId}.contextWindow`);
          }
          if (model.maxTokens !== void 0) {
            loaded.maxTokens = requireNumber(model.maxTokens, `provider_models.${modelId}.maxTokens`);
          }
          if (model.reasoning !== void 0) {
            loaded.reasoning = requireBoolean(model.reasoning, `provider_models.${modelId}.reasoning`);
          }
          if (model.supportsImageInput !== void 0) {
            loaded.supportsImageInput = requireBoolean(model.supportsImageInput, `provider_models.${modelId}.supportsImageInput`);
          }
          if (model.supportsDeveloperRole !== void 0) {
            loaded.compat = {
              supportsDeveloperRole: requireBoolean(model.supportsDeveloperRole, `provider_models.${modelId}.supportsDeveloperRole`)
            };
          }
        }
        models[modelId] = loaded;
      }
      if (options.requireAny !== false && Object.keys(models).length === 0) {
        throw new Error("at least one provider model config is required");
      }
      return models;
    };
    loadAvailableModels = (raw, providerModels, options = { requireAny: true, includeAllProviderModels: true }) => {
      const models = {};
      if (options.includeAllProviderModels !== false && Object.keys(raw.availableModels).length === 0) {
        for (const [modelId, providerModel] of Object.entries(providerModels)) {
          models[modelId] = {
            model: modelId,
            displayName: providerModel.displayName
          };
        }
        return models;
      }
      for (const [modelId, model] of Object.entries(raw.availableModels)) {
        const providerModelId = requireString(model.model, `available_models.${modelId}.model`);
        if (!providerModels[providerModelId]) {
          throw new Error(`available_models.${modelId}.model must reference a configured provider model`);
        }
        models[modelId] = {
          model: providerModelId,
          ...model.displayName ? { displayName: model.displayName } : {}
        };
      }
      if (options.requireAny !== false && Object.keys(models).length === 0) {
        throw new Error("at least one available model config is required");
      }
      return models;
    };
    loadRoles = (raw, models, options = { requireComplete: true }) => {
      const roles = raw.modelProfile?.roles;
      if (!roles) {
        if (options.requireComplete === false) {
          return { primary: "", standard: "", auxiliary: "" };
        }
        throw new Error("model_profile.roles is required");
      }
      if (options.requireComplete === false) {
        return {
          primary: roles.primary ? requireModelRole(roles.primary, "primary", models) : "",
          standard: roles.standard ? requireModelRole(roles.standard, "standard", models) : "",
          auxiliary: roles.auxiliary ? requireModelRole(roles.auxiliary, "auxiliary", models) : ""
        };
      }
      return {
        primary: requireModelRole(roles.primary, "primary", models),
        standard: requireModelRole(roles.standard, "standard", models),
        auxiliary: requireModelRole(roles.auxiliary, "auxiliary", models)
      };
    };
    readConfigText = async (options) => {
      const projectPath = scorelProjectConfigPath(options.cwd);
      try {
        return await readFile3(projectPath, "utf8");
      } catch {
        const home = options.homeDir ?? process.env.HOME;
        if (!home) {
          throw new Error(`Scorel config not found: ${projectPath}`);
        }
        const userPath = scorelUserConfigPath(home);
        try {
          return await readFile3(userPath, "utf8");
        } catch {
          throw new Error(`Scorel config not found: ${projectPath} or ${userPath}`);
        }
      }
    };
    parseToml = (text) => {
      const result = emptyRawConfig();
      let section2 = { kind: "root" };
      for (const rawLine of text.split(/\r?\n/)) {
        const line = stripComment(rawLine).trim();
        if (line.length === 0) {
          continue;
        }
        const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
        if (sectionMatch) {
          section2 = requireSection(sectionMatch[1] ?? "");
          ensureSection(result, section2);
          continue;
        }
        const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/.exec(line);
        if (!match) {
          throw new Error(`Unsupported config line: ${rawLine.trim()}`);
        }
        const [, key, rawValue] = match;
        if (!key || rawValue === void 0) {
          throw new Error(`Unsupported config line: ${rawLine.trim()}`);
        }
        setConfigValue(result, section2, key, parseTomlValue(rawValue));
      }
      return result;
    };
    parseEditableConfig = (text) => {
      if (!text?.trim()) {
        return emptyRawConfig();
      }
      return parseToml(text);
    };
    renderRawConfig = (raw) => {
      const lines = [];
      for (const [providerId, provider] of Object.entries(raw.providers).sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`[providers.${providerId}]`);
        lines.push(`type = ${tomlString(requireProviderType(provider.type, `providers.${providerId}.type`))}`);
        lines.push(`provider = ${tomlString(normalizeProviderName(requireString(provider.provider, `providers.${providerId}.provider`)))}`);
        if (provider.type === "custom") {
          lines.push(`api = ${tomlString(requireCustomApi(provider.api, `providers.${providerId}.api`))}`);
          lines.push(`baseUrl = ${tomlString(stripTrailingSlashes(requireString(provider.baseUrl, `providers.${providerId}.baseUrl`)))}`);
        } else if (provider.baseUrl) {
          lines.push(`baseUrl = ${tomlString(stripTrailingSlashes(provider.baseUrl))}`);
        }
        if (provider.apiKey) {
          lines.push(`apiKey = ${tomlString(requireString(provider.apiKey, `providers.${providerId}.apiKey`))}`);
        } else {
          lines.push(`apiKeyEnv = ${tomlString(requireString(provider.apiKeyEnv, `providers.${providerId}.apiKeyEnv`))}`);
        }
        lines.push("");
      }
      for (const [modelId, model] of Object.entries(raw.providerModels).sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`[provider_models.${modelId}]`);
        lines.push(`provider = ${tomlString(requireString(model.provider, `provider_models.${modelId}.provider`))}`);
        lines.push(`id = ${tomlString(requireString(model.id, `provider_models.${modelId}.id`))}`);
        lines.push(`displayName = ${tomlString(requireString(model.displayName, `provider_models.${modelId}.displayName`))}`);
        const provider = raw.providers[model.provider ?? ""];
        if (provider?.type === "custom" && model.contextWindow !== void 0) {
          lines.push(`contextWindow = ${requireNumber(model.contextWindow, `provider_models.${modelId}.contextWindow`)}`);
        }
        if (provider?.type === "custom" && model.maxTokens !== void 0) {
          lines.push(`maxTokens = ${requireNumber(model.maxTokens, `provider_models.${modelId}.maxTokens`)}`);
        }
        if (provider?.type === "custom" && model.reasoning !== void 0) {
          lines.push(`reasoning = ${requireBoolean(model.reasoning, `provider_models.${modelId}.reasoning`)}`);
        }
        if (provider?.type === "custom" && model.supportsImageInput !== void 0) {
          lines.push(`supportsImageInput = ${requireBoolean(model.supportsImageInput, `provider_models.${modelId}.supportsImageInput`)}`);
        }
        if (provider?.type === "custom" && model.supportsDeveloperRole !== void 0) {
          lines.push(`supportsDeveloperRole = ${requireBoolean(model.supportsDeveloperRole, `provider_models.${modelId}.supportsDeveloperRole`)}`);
        }
        lines.push("");
      }
      for (const [modelId, model] of Object.entries(raw.availableModels).sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`[available_models.${modelId}]`);
        lines.push(`model = ${tomlString(requireString(model.model, `available_models.${modelId}.model`))}`);
        if (model.displayName) {
          lines.push(`displayName = ${tomlString(model.displayName)}`);
        }
        lines.push("");
      }
      if (raw.modelProfile?.roles) {
        lines.push("[model_profile.roles]");
        lines.push(`primary = ${tomlString(requireIdentifier(raw.modelProfile.roles.primary, "model_profile.roles.primary"))}`);
        lines.push(`standard = ${tomlString(requireIdentifier(raw.modelProfile.roles.standard, "model_profile.roles.standard"))}`);
        lines.push(`auxiliary = ${tomlString(requireIdentifier(raw.modelProfile.roles.auxiliary, "model_profile.roles.auxiliary"))}`);
        lines.push("");
      }
      if (raw.memory) {
        const memory = loadMemory(raw);
        lines.push("[memory]");
        lines.push(`enabled = ${memory.enabled}`);
        lines.push(`daily = ${memory.daily}`);
        lines.push(`sessionMemory = ${memory.sessionMemory}`);
        lines.push(`autoDream = ${memory.autoDream}`);
        lines.push(`promoteRoot = ${memory.promoteRoot}`);
        lines.push(`dreamIdleMinutes = ${memory.dreamIdleMinutes}`);
        lines.push(`autoCompactThreshold = ${memory.autoCompactThreshold}`);
        lines.push("");
      }
      if (raw.runtime) {
        const runtime = loadRuntime(raw);
        lines.push("[runtime]");
        lines.push(`tokenSavingRtk = ${runtime.tokenSavingRtk}`);
        lines.push("");
      }
      for (const [extensionId, extension] of Object.entries(raw.extensions).sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`[extensions.${extensionId}]`);
        lines.push(`enabled = ${extension.enabled === true}`);
        lines.push(`kind = ${tomlString(extension.kind === "im" ? "im" : requireString(extension.kind, `extensions.${extensionId}.kind`))}`);
        lines.push("");
        if (extension.config && Object.keys(extension.config).length > 0) {
          lines.push(`[extensions.${extensionId}.config]`);
          for (const [key, value] of Object.entries(extension.config).sort(([left], [right]) => left.localeCompare(right))) {
            lines.push(`${key} = ${renderTomlValue(value)}`);
          }
          lines.push("");
        }
      }
      return lines.join("\n");
    };
    emptyRawConfig = () => ({
      providers: {},
      providerModels: {},
      availableModels: {},
      extensions: {}
    });
    stripComment = (line) => {
      const index = line.indexOf("#");
      return index === -1 ? line : line.slice(0, index);
    };
    requireString = (value, name) => {
      if (!value) {
        throw new Error(`${name} is required`);
      }
      return value;
    };
    normalizeProviderName = (value) => {
      const provider = value.split("/")[0]?.trim();
      return provider || value.trim();
    };
    requireProviderCredential = (provider, name) => {
      if (!provider.apiKeyEnv && !provider.apiKey) {
        throw new Error(`${name}.apiKeyEnv or ${name}.apiKey is required`);
      }
    };
    resolveProviderApiKey = (provider, env, name) => {
      if (provider.apiKey) {
        return provider.apiKey;
      }
      const apiKeyEnv = requireString(provider.apiKeyEnv, `${name}.apiKeyEnv`);
      const apiKey = env[apiKeyEnv];
      if (!apiKey) {
        throw new Error(`${apiKeyEnv} is not set`);
      }
      return apiKey;
    };
    providerCredentialSummary = (provider, env) => {
      if (provider.apiKey) {
        return {
          credentialSource: "direct",
          credentialStatus: "available"
        };
      }
      const apiKeyEnv = provider.apiKeyEnv;
      if (!apiKeyEnv) {
        return {
          credentialSource: "env",
          credentialStatus: "missing"
        };
      }
      return {
        apiKeyEnv,
        credentialSource: "env",
        credentialStatus: env[apiKeyEnv] ? "available" : "missing"
      };
    };
    requireNumber = (value, name) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${name} is required`);
      }
      return value;
    };
    requireNonNegativeNumber = (value, name) => {
      const number = requireNumber(value, name);
      if (number < 0) {
        throw new Error(`${name} must be non-negative`);
      }
      return number;
    };
    requireCompactThreshold = (value) => {
      const number = requireNumber(value, "memory.autoCompactThreshold");
      if (number <= 0 || number >= 1) {
        throw new Error("memory.autoCompactThreshold must be greater than 0 and less than 1");
      }
      return number;
    };
    requireBoolean = (value, name) => {
      if (typeof value !== "boolean") {
        throw new Error(`${name} is required`);
      }
      return value;
    };
    requireCustomApi = (value, name) => {
      if (value === "openai-completions" || value === "openai-responses" || value === "google-generative-ai" || value === "anthropic-messages") {
        return value;
      }
      throw new Error(`${name} must be openai-completions, openai-responses, google-generative-ai, or anthropic-messages`);
    };
    requireProviderType = (value, name) => {
      if (value === "builtin" || value === "custom") {
        return value;
      }
      throw new Error(`${name} must be builtin or custom`);
    };
    requireSection = (section2) => {
      if (section2 === "root") {
        return { kind: "root" };
      }
      const providerMatch = /^providers\.([A-Za-z0-9_-]+)$/.exec(section2);
      if (providerMatch?.[1]) {
        return { kind: "provider", id: providerMatch[1] };
      }
      const providerModelMatch = /^provider_models\.([A-Za-z0-9_-]+)$/.exec(section2);
      if (providerModelMatch?.[1]) {
        return { kind: "providerModel", id: providerModelMatch[1] };
      }
      const availableModelMatch = /^available_models\.([A-Za-z0-9_-]+)$/.exec(section2);
      if (availableModelMatch?.[1]) {
        return { kind: "availableModel", id: availableModelMatch[1] };
      }
      if (section2 === "model_profile.roles") {
        return { kind: "modelProfileRoles" };
      }
      if (section2 === "memory") {
        return { kind: "memory" };
      }
      if (section2 === "runtime") {
        return { kind: "runtime" };
      }
      const extensionConfigMatch = /^extensions\.([A-Za-z0-9_-]+)\.config$/.exec(section2);
      if (extensionConfigMatch?.[1]) {
        return { kind: "extensionConfig", id: extensionConfigMatch[1] };
      }
      const extensionMatch = /^extensions\.([A-Za-z0-9_-]+)$/.exec(section2);
      if (extensionMatch?.[1]) {
        return { kind: "extension", id: extensionMatch[1] };
      }
      throw new Error(`Unsupported config section: ${section2}`);
    };
    ensureSection = (config, section2) => {
      if (section2.kind === "provider") {
        config.providers[section2.id] ??= {};
      } else if (section2.kind === "providerModel") {
        config.providerModels[section2.id] ??= {};
      } else if (section2.kind === "availableModel") {
        config.availableModels[section2.id] ??= {};
      } else if (section2.kind === "modelProfileRoles") {
        config.modelProfile ??= {};
        config.modelProfile.roles ??= {};
      } else if (section2.kind === "memory") {
        config.memory ??= {};
      } else if (section2.kind === "runtime") {
        config.runtime ??= {};
      } else if (section2.kind === "extension") {
        config.extensions[section2.id] ??= {};
      } else if (section2.kind === "extensionConfig") {
        config.extensions[section2.id] ??= {};
        config.extensions[section2.id].config ??= {};
      }
    };
    setConfigValue = (config, section2, key, value) => {
      assertKnownKey(section2, key);
      if (section2.kind === "provider") {
        config.providers[section2.id] ??= {};
        setValue(config.providers[section2.id], key, value);
      } else if (section2.kind === "providerModel") {
        config.providerModels[section2.id] ??= {};
        setValue(config.providerModels[section2.id], key, value);
      } else if (section2.kind === "availableModel") {
        config.availableModels[section2.id] ??= {};
        setValue(config.availableModels[section2.id], key, value);
      } else if (section2.kind === "modelProfileRoles") {
        config.modelProfile ??= {};
        config.modelProfile.roles ??= {};
        setValue(config.modelProfile.roles, key, value);
      } else if (section2.kind === "memory") {
        config.memory ??= {};
        setValue(config.memory, key, value);
      } else if (section2.kind === "runtime") {
        config.runtime ??= {};
        setValue(config.runtime, key, value);
      } else if (section2.kind === "extension") {
        config.extensions[section2.id] ??= {};
        setValue(config.extensions[section2.id], key, value);
      } else if (section2.kind === "extensionConfig") {
        config.extensions[section2.id] ??= {};
        const extensionConfig = config.extensions[section2.id].config ?? {};
        config.extensions[section2.id].config = extensionConfig;
        setValue(extensionConfig, key, value);
      }
    };
    assertKnownKey = (section2, key) => {
      const schemaSection = section2.kind;
      if (schemaSection === "extensionConfig") {
        if (!/^[A-Za-z0-9_-]+$/.test(key)) {
          throw new Error(`Unsupported config key: ${key}`);
        }
        return;
      }
      const allowed = SCOREL_CONFIG_SCHEMA.sections[schemaSection].keys;
      if (!allowed.includes(key)) {
        throw new Error(`Unsupported config key: ${key}`);
      }
    };
    setValue = (target, key, value) => {
      target[key] = value;
    };
    parseTomlValue = (value) => {
      const stringMatch = /^"([^"]*)"$/.exec(value);
      if (stringMatch) {
        return stringMatch[1] ?? "";
      }
      if (value === "true") {
        return true;
      }
      if (value === "false") {
        return false;
      }
      const number = Number(value);
      if (Number.isFinite(number)) {
        return number;
      }
      throw new Error(`Unsupported config value: ${value}`);
    };
    stripTrailingSlashes = (value) => value.replace(/\/+$/, "");
    requireIdentifier = (value, name) => {
      const text = requireString(value, name);
      if (!/^[A-Za-z0-9_-]+$/.test(text)) {
        throw new Error(`${name} must contain only letters, numbers, underscores, or hyphens`);
      }
      return text;
    };
    tomlString = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    renderTomlValue = (value) => typeof value === "string" ? tomlString(value) : String(value);
    requireModelRole = (value, role, models) => {
      const modelId = requireString(value, `model_profile.roles.${role}`);
      if (!models[modelId]) {
        throw new Error(`model_profile.roles.${role} must reference a configured model`);
      }
      return modelId;
    };
    modelRoles = (config, modelId) => ["primary", "standard", "auxiliary"].filter((role) => config.modelProfile.roles[role] === modelId);
  }
});

// packages/core/src/tools/coding-tools.ts
import { createHash, randomUUID as randomUUID2 } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir as mkdir2, readFile as readFile4, rename as rename2, rm, stat as stat3, writeFile as writeFile2 } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename as basename2, dirname as dirname3, extname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
var execFileAsync, DEFAULT_SEARCH_LIMIT, DEFAULT_GREP_LIMIT, DEFAULT_READ_LIMIT, DEFAULT_CONTEXT_WINDOW, READ_TOKEN_BUDGET_RATIO, FULL_READ_TOKEN_BUDGET_RATIO, createCodingTools, parseReadArgs, parseWriteArgs, parseEditArgs, parseBashArgs, parseGlobArgs, parseGrepArgs, parseTodoWriteArgs, parseTodoItem, expectRecord, expectPath, expectString, optionalString, optionalNumber, optionalBoolean, snapshotFile, sameSnapshot, exists, isWithin, linesOf, IMAGE_EXTENSIONS, DOCUMENT_EXTENSIONS, BINARY_EXTENSIONS, assertReadableFileKind, assertTextBuffer, selectCompleteLinesWithinBudget, estimateTokens, renderReadLines, readTokenBudget, completeRanges, hasCompleteCoverage, mergeRanges, countOccurrences, atomicWriteFile, bashResult, resolveDefaultShell, resolveRtkCommand, rtkRewriteResult, executableRewriteCommand, readRtkGain, rtkSavedTokenDelta, withRtkSavings, nonNegativeInteger, isRecord3, shellQuote, shellCommandArgs, userShell, truncate, textResult, byteLength, isTimeoutError, isExecError, runRipgrep, splitOutput, vcsExcludes, grepArgs, splitGlobPatterns, paginate, toWorkspaceRelative, relativizeGrepLine, relativizeCountLine, sortPathsByMtime, formatPaginatedText, formatLimitSuffix, parseCountLines;
var init_coding_tools = __esm({
  "packages/core/src/tools/coding-tools.ts"() {
    "use strict";
    init_tools();
    execFileAsync = promisify(execFile);
    DEFAULT_SEARCH_LIMIT = 100;
    DEFAULT_GREP_LIMIT = 250;
    DEFAULT_READ_LIMIT = 2e3;
    DEFAULT_CONTEXT_WINDOW = 2e5;
    READ_TOKEN_BUDGET_RATIO = 0.01;
    FULL_READ_TOKEN_BUDGET_RATIO = 0.1;
    createCodingTools = (options) => {
      const root = resolve(options.cwd);
      const state = { reads: /* @__PURE__ */ new Map(), todos: [] };
      const defaultTimeoutMs = options.defaultTimeoutMs ?? 3e4;
      const maxTimeoutMs = options.maxTimeoutMs ?? 12e4;
      const maxOutputBytes = options.maxOutputBytes ?? 16e3;
      const normalReadTokens = options.maxReadTokens ?? readTokenBudget(options.contextWindow, READ_TOKEN_BUDGET_RATIO);
      const fullReadTokens = options.maxReadTokens ?? readTokenBudget(options.contextWindow, FULL_READ_TOKEN_BUDGET_RATIO);
      const defaultShell = resolveDefaultShell(options.defaultShell);
      const resolveWorkspacePath = (input) => {
        if (input.length === 0) {
          throw new Error("path must not be empty");
        }
        const candidate = isAbsolute(input) ? resolve(input) : resolve(root, input);
        if (!isWithin(root, candidate)) {
          throw new Error(`path escapes workspace: ${input}`);
        }
        return candidate;
      };
      const workspaceTarget = (input) => {
        const target = input ? resolveWorkspacePath(input) : root;
        return relative(root, target) || ".";
      };
      const assertFreshReadableCoverage = async (path, toolName) => {
        const snapshot = state.reads.get(path);
        if (!snapshot) {
          throw new Error(`Read must be used before ${toolName} on existing file: ${path}`);
        }
        if (!hasCompleteCoverage(snapshot.ranges, snapshot.totalLines)) {
          throw new Error(`The complete file must be read before ${toolName} on existing file: ${path}`);
        }
        const current = await snapshotFile(path);
        if (!sameSnapshot(snapshot, current)) {
          throw new Error(`File changed since last Read: ${path}`);
        }
        return snapshot;
      };
      return [
        defineTool({
          name: "Read",
          description: "Read a text file from the workspace. Long reads are truncated by complete lines; accumulated coverage unlocks Write/Edit.",
          execute: async (_toolCallId, args) => {
            const input = parseReadArgs(args);
            if (input.full && (input.offset !== void 0 || input.limit !== void 0)) {
              throw new Error("full cannot be combined with offset or limit");
            }
            const path = resolveWorkspacePath(input.path);
            assertReadableFileKind(path);
            const fileStat = await stat3(path);
            if (fileStat.isDirectory()) {
              throw new Error(`Read cannot read a directory: ${input.path}. Use Glob to find files.`);
            }
            const buffer = await readFile4(path);
            assertTextBuffer(buffer, input.path);
            const content = buffer.toString("utf8");
            const lines = linesOf(content);
            const offset = input.offset ?? 1;
            const limit = input.full ? Math.max(lines.length, 1) : input.limit ?? DEFAULT_READ_LIMIT;
            if (!Number.isInteger(offset) || offset < 1) {
              throw new Error("offset must be a positive integer");
            }
            if (!Number.isInteger(limit) || limit < 1) {
              throw new Error("limit must be a positive integer");
            }
            const startIndex = offset - 1;
            const candidate = lines.slice(startIndex, startIndex + limit);
            const tokenBudget = input.full ? fullReadTokens : normalReadTokens;
            const selected = selectCompleteLinesWithinBudget(candidate, offset, tokenBudget);
            const endLine = selected.length === 0 ? offset - 1 : offset + selected.length - 1;
            const truncated = startIndex + selected.length < lines.length;
            const nextOffset = truncated ? endLine + 1 : null;
            const current = await snapshotFile(path, content);
            const previous = state.reads.get(path);
            const previousRanges = previous && sameSnapshot(previous, current) ? previous.ranges : [];
            const currentRange = selected.length > 0 ? [{ startLine: offset, endLine }] : [];
            const ranges = mergeRanges([...previousRanges, ...currentRange]);
            const canWrite = hasCompleteCoverage(ranges, lines.length);
            state.reads.set(path, { ...current, ranges });
            const rendered = renderReadLines(selected, offset);
            const truncationNotice = truncated ? `

[Showing lines ${offset}-${endLine}/${lines.length}. Next offset: ${nextOffset}.]` : "";
            const text = `${rendered}${truncationNotice}`;
            return textResult(text, {
              path,
              startLine: offset,
              endLine,
              totalLines: lines.length,
              truncated,
              nextOffset,
              size: fileStat.size,
              estimatedTokens: estimateTokens(rendered),
              tokenBudget,
              canWrite
            });
          }
        }),
        defineTool({
          name: "Write",
          description: "Create a new file or fully overwrite an existing file. Existing files require complete read coverage of the current file.",
          execute: async (_toolCallId, args) => {
            const input = parseWriteArgs(args);
            const path = resolveWorkspacePath(input.path);
            const previous = await exists(path) ? await assertFreshReadableCoverage(path, "Write") : void 0;
            await mkdir2(dirname3(path), { recursive: true });
            await atomicWriteFile(path, input.content);
            state.reads.set(path, await snapshotFile(path, input.content, completeRanges(linesOf(input.content).length)));
            const type = previous ? "update" : "create";
            return textResult(
              type === "create" ? `File created successfully at: ${path}` : `The file ${path} has been updated successfully.`,
              {
                type,
                filePath: path,
                bytes: byteLength(input.content)
              }
            );
          }
        }),
        defineTool({
          name: "Edit",
          description: "Perform an exact string replacement in an existing file. Requires complete read coverage and a unique old_string unless replace_all is true.",
          execute: async (_toolCallId, args) => {
            const input = parseEditArgs(args);
            const path = resolveWorkspacePath(input.path);
            await assertFreshReadableCoverage(path, "Edit");
            if (input.old_string === input.new_string) {
              throw new Error("old_string and new_string must differ");
            }
            const content = await readFile4(path, "utf8");
            const count = countOccurrences(content, input.old_string);
            if (count === 0) {
              throw new Error(`String to replace not found in file.
String: ${input.old_string}`);
            }
            if (count > 1 && !input.replace_all) {
              throw new Error(
                `Found ${count} matches of the string to replace, but replace_all is false. Provide more context or set replace_all to true.
String: ${input.old_string}`
              );
            }
            const next = input.replace_all ? content.split(input.old_string).join(input.new_string) : content.replace(input.old_string, input.new_string);
            await atomicWriteFile(path, next);
            state.reads.set(path, await snapshotFile(path, next, completeRanges(linesOf(next).length)));
            return textResult(
              input.replace_all ? `The file ${path} has been updated. All occurrences were successfully replaced.` : `The file ${path} has been updated successfully.`,
              {
                filePath: path,
                replacements: input.replace_all ? count : 1,
                replaceAll: input.replace_all ?? false
              }
            );
          }
        }),
        defineTool({
          name: "Bash",
          description: "Execute a shell command in the workspace with timeout and output truncation.",
          execute: async (_toolCallId, args, signal) => {
            const input = parseBashArgs(args);
            const commandCwd = input.cwd ? resolveWorkspacePath(input.cwd) : root;
            const timeoutMs = Math.min(input.timeoutMs ?? defaultTimeoutMs, maxTimeoutMs);
            const outputLimit = input.maxOutputBytes ?? maxOutputBytes;
            const rtk = options.tokenSaving?.rtk;
            const rtkCommand = await resolveRtkCommand(rtk, input.command);
            const command = rtkCommand.rewrittenCommand ?? input.command;
            const executionCommand = rtkCommand.executionCommand ?? input.command;
            const executable = defaultShell;
            const argv = shellCommandArgs(defaultShell, executionCommand);
            const rtkGainBefore = rtkCommand.applied && rtk?.executable ? await readRtkGain(rtk.executable, commandCwd) : void 0;
            const rtkResult = {
              enabled: rtk?.enabled === true,
              applied: rtkCommand.applied,
              ...rtk?.executable ? { executable: rtk.executable } : {},
              ...rtkCommand.rewrittenCommand ? { rewrittenCommand: rtkCommand.rewrittenCommand } : {}
            };
            try {
              const result = await execFileAsync(executable, argv, {
                cwd: commandCwd,
                timeout: timeoutMs,
                signal,
                maxBuffer: Math.max(outputLimit * 4, 1024 * 1024)
              });
              const rtkSavedTokens = rtk?.executable ? await rtkSavedTokenDelta(rtk.executable, commandCwd, rtkGainBefore) : void 0;
              return bashResult({
                exitCode: 0,
                stdout: result.stdout,
                stderr: result.stderr,
                cwd: commandCwd,
                outputLimit,
                shell: defaultShell,
                command,
                rtk: withRtkSavings(rtkResult, rtkSavedTokens)
              });
            } catch (cause) {
              if (isTimeoutError(cause)) {
                throw new Error(`Bash command timed out after ${timeoutMs}ms`);
              }
              if (isExecError(cause)) {
                const rtkSavedTokens = rtk?.executable ? await rtkSavedTokenDelta(rtk.executable, commandCwd, rtkGainBefore) : void 0;
                return bashResult({
                  exitCode: typeof cause.code === "number" ? cause.code : 1,
                  stdout: String(cause.stdout ?? ""),
                  stderr: String(cause.stderr ?? cause.message),
                  cwd: commandCwd,
                  outputLimit,
                  shell: defaultShell,
                  command,
                  rtk: withRtkSavings(rtkResult, rtkSavedTokens)
                });
              }
              throw cause;
            }
          }
        }),
        defineTool({
          name: "Glob",
          description: "Find files by glob pattern using ripgrep file discovery.",
          execute: async (_toolCallId, args, signal) => {
            const input = parseGlobArgs(args);
            const limit = input.head_limit ?? DEFAULT_SEARCH_LIMIT;
            const offset = input.offset ?? 0;
            const all = (await runRipgrep(["--files", "--hidden", "--glob", input.pattern, ...vcsExcludes()], workspaceTarget(input.path), root, signal)).sort((left, right) => toWorkspaceRelative(root)(left).localeCompare(toWorkspaceRelative(root)(right)));
            const selected = paginate(all, limit, offset);
            const text = selected.items.map(toWorkspaceRelative(root)).join("\n");
            return textResult(text || "No files found", {
              filenames: selected.items.map(toWorkspaceRelative(root)),
              numFiles: selected.items.length,
              totalFiles: all.length,
              truncated: selected.truncated,
              ...selected.appliedLimit !== void 0 ? { appliedLimit: selected.appliedLimit } : {},
              ...offset > 0 ? { appliedOffset: offset } : {}
            });
          }
        }),
        defineTool({
          name: "Grep",
          description: 'Search file contents with ripgrep. Default output_mode is "files" for matching paths; use "content" for matching lines or "count" for match counts.',
          execute: async (_toolCallId, args, signal) => {
            const input = parseGrepArgs(args);
            const mode = input.output_mode ?? "files";
            const limit = input.head_limit ?? DEFAULT_GREP_LIMIT;
            const offset = input.offset ?? 0;
            const rgArgs = grepArgs(input, mode);
            const raw = await runRipgrep(rgArgs, workspaceTarget(input.path), root, signal);
            if (mode === "content") {
              const selected2 = paginate(raw, limit, offset);
              const lines = selected2.items.map(relativizeGrepLine(root));
              return textResult(formatPaginatedText(lines, selected2, offset), {
                mode,
                content: lines.join("\n"),
                numLines: lines.length,
                filenames: [],
                numFiles: 0,
                ...selected2.appliedLimit !== void 0 ? { appliedLimit: selected2.appliedLimit } : {},
                ...offset > 0 ? { appliedOffset: offset } : {}
              });
            }
            if (mode === "count") {
              const selected2 = paginate(raw, limit, offset);
              const lines = selected2.items.map(relativizeCountLine(root));
              const counts = parseCountLines(lines);
              return textResult(formatPaginatedText(lines, selected2, offset), {
                mode,
                content: lines.join("\n"),
                filenames: [],
                numFiles: counts.files,
                numMatches: counts.matches,
                ...selected2.appliedLimit !== void 0 ? { appliedLimit: selected2.appliedLimit } : {},
                ...offset > 0 ? { appliedOffset: offset } : {}
              });
            }
            const sorted = await sortPathsByMtime(root, raw);
            const selected = paginate(sorted, limit, offset);
            const filenames = selected.items.map(toWorkspaceRelative(root));
            return textResult(
              filenames.length === 0 ? "No files found" : `Found ${filenames.length} ${filenames.length === 1 ? "file" : "files"}${formatLimitSuffix(selected, offset)}
${filenames.join("\n")}`,
              {
                mode,
                filenames,
                numFiles: filenames.length,
                ...selected.appliedLimit !== void 0 ? { appliedLimit: selected.appliedLimit } : {},
                ...offset > 0 ? { appliedOffset: offset } : {}
              }
            );
          }
        }),
        defineTool({
          name: "TodoWrite",
          description: "Replace the current session todo list with a complete updated list.",
          execute: async (_toolCallId, args) => {
            const input = parseTodoWriteArgs(args);
            const oldTodos = state.todos;
            const allDone = input.todos.length > 0 && input.todos.every((todo) => todo.status === "completed");
            state.todos = allDone ? [] : input.todos;
            const message = allDone ? "Todos have been modified successfully. All items are completed, so the current todo list has been cleared." : "Todos have been modified successfully. Continue using the todo list to track progress.";
            return textResult(message, { oldTodos, currentTodos: state.todos });
          }
        })
      ];
    };
    parseReadArgs = (args) => {
      const input = expectRecord(args);
      return {
        path: expectPath(input),
        offset: optionalNumber(input.offset, "offset"),
        limit: optionalNumber(input.limit, "limit"),
        full: optionalBoolean(input.full, "full")
      };
    };
    parseWriteArgs = (args) => {
      const input = expectRecord(args);
      return {
        path: expectPath(input),
        content: expectString(input.content, "content")
      };
    };
    parseEditArgs = (args) => {
      const input = expectRecord(args);
      return {
        path: expectPath(input),
        old_string: expectString(input.old_string, "old_string"),
        new_string: expectString(input.new_string, "new_string"),
        replace_all: optionalBoolean(input.replace_all, "replace_all")
      };
    };
    parseBashArgs = (args) => {
      const input = expectRecord(args);
      return {
        command: expectString(input.command, "command"),
        cwd: optionalString(input.cwd, "cwd"),
        timeoutMs: optionalNumber(input.timeoutMs ?? input.timeout, "timeout"),
        maxOutputBytes: optionalNumber(input.maxOutputBytes, "maxOutputBytes"),
        description: optionalString(input.description, "description")
      };
    };
    parseGlobArgs = (args) => {
      const input = expectRecord(args);
      return {
        pattern: expectString(input.pattern, "pattern"),
        path: optionalString(input.path ?? input.cwd, "path"),
        head_limit: optionalNumber(input.head_limit ?? input.maxResults, "head_limit"),
        offset: optionalNumber(input.offset, "offset")
      };
    };
    parseGrepArgs = (args) => {
      const input = expectRecord(args);
      const outputMode = optionalString(input.output_mode ?? input.outputMode, "output_mode");
      if (outputMode !== void 0 && outputMode !== "files" && outputMode !== "content" && outputMode !== "count") {
        throw new Error("output_mode must be files, content, or count");
      }
      return {
        pattern: expectString(input.pattern, "pattern"),
        path: optionalString(input.path ?? input.cwd, "path"),
        glob: optionalString(input.glob, "glob"),
        output_mode: outputMode,
        before_context: optionalNumber(input["-B"], "-B"),
        after_context: optionalNumber(input["-A"], "-A"),
        context: optionalNumber(input.context ?? input["-C"], "context"),
        line_numbers: optionalBoolean(input["-n"], "-n"),
        case_insensitive: optionalBoolean(input["-i"] ?? input.case_insensitive, "-i"),
        type: optionalString(input.type, "type"),
        head_limit: optionalNumber(input.head_limit ?? input.maxResults, "head_limit"),
        offset: optionalNumber(input.offset, "offset"),
        multiline: optionalBoolean(input.multiline, "multiline")
      };
    };
    parseTodoWriteArgs = (args) => {
      const input = expectRecord(args);
      if (!Array.isArray(input.todos)) {
        throw new Error("todos must be an array");
      }
      const todos = input.todos.map(parseTodoItem);
      const inProgressCount = todos.filter((todo) => todo.status === "in_progress").length;
      if (inProgressCount > 1) {
        throw new Error("TodoWrite allows at most one in_progress item");
      }
      return { todos };
    };
    parseTodoItem = (value) => {
      const input = expectRecord(value);
      const status = expectString(input.status, "status");
      if (status !== "pending" && status !== "in_progress" && status !== "completed") {
        throw new Error("status must be pending, in_progress, or completed");
      }
      return {
        content: expectString(input.content, "content"),
        status,
        activeForm: optionalString(input.activeForm, "activeForm")
      };
    };
    expectRecord = (value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("tool args must be an object");
      }
      return value;
    };
    expectPath = (input) => expectString(input.file_path ?? input.path, "file_path");
    expectString = (value, name) => {
      if (typeof value !== "string") {
        throw new Error(`${name} must be a string`);
      }
      return value;
    };
    optionalString = (value, name) => {
      if (value === void 0) {
        return void 0;
      }
      return expectString(value, name);
    };
    optionalNumber = (value, name) => {
      if (value === void 0) {
        return void 0;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${name} must be a finite number`);
      }
      return value;
    };
    optionalBoolean = (value, name) => {
      if (value === void 0) {
        return void 0;
      }
      if (typeof value !== "boolean") {
        throw new Error(`${name} must be a boolean`);
      }
      return value;
    };
    snapshotFile = async (path, content, ranges) => {
      const [fileStat, fileContent] = await Promise.all([stat3(path), content ?? readFile4(path, "utf8")]);
      const totalLines = linesOf(fileContent).length;
      return {
        content: fileContent,
        hash: createHash("sha256").update(fileContent).digest("hex"),
        mtimeMs: fileStat.mtimeMs,
        ranges: ranges ?? [],
        size: fileStat.size,
        totalLines
      };
    };
    sameSnapshot = (left, right) => left.hash === right.hash && left.size === right.size && left.mtimeMs === right.mtimeMs;
    exists = async (path) => {
      try {
        await stat3(path);
        return true;
      } catch {
        return false;
      }
    };
    isWithin = (root, path) => {
      const rel = relative(root, path);
      return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
    };
    linesOf = (content) => {
      const lines = content.split(/\r?\n/);
      if (lines.at(-1) === "") {
        lines.pop();
      }
      return lines;
    };
    IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".ico"]);
    DOCUMENT_EXTENSIONS = /* @__PURE__ */ new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);
    BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
      ".zip",
      ".tar",
      ".gz",
      ".bz2",
      ".xz",
      ".7z",
      ".rar",
      ".dmg",
      ".pkg",
      ".exe",
      ".dll",
      ".so",
      ".dylib",
      ".class",
      ".jar",
      ".wasm",
      ".pyc",
      ".sqlite",
      ".db"
    ]);
    assertReadableFileKind = (path) => {
      const ext = extname(path).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        throw new Error(`Read does not yet support image files (${ext}). A dedicated image Read path is planned; do not read this file as text.`);
      }
      if (DOCUMENT_EXTENSIONS.has(ext)) {
        throw new Error(`Read does not yet support document files (${ext}). PDF/page and document-aware Read support is planned; do not read this file as text.`);
      }
      if (BINARY_EXTENSIONS.has(ext)) {
        throw new Error(`Read cannot read binary files (${ext}). Use an appropriate binary/document tool instead.`);
      }
    };
    assertTextBuffer = (buffer, path) => {
      if (buffer.includes(0)) {
        throw new Error(`Read cannot read binary file as text: ${path}`);
      }
      const decoded = buffer.toString("utf8");
      const replacementChars = decoded.match(/\uFFFD/g)?.length ?? 0;
      if (replacementChars > 0 && replacementChars / Math.max(decoded.length, 1) > 0.01) {
        throw new Error(`Read cannot safely decode file as UTF-8 text: ${path}`);
      }
    };
    selectCompleteLinesWithinBudget = (lines, offset, maxTokens) => {
      let selected = lines;
      while (selected.length > 0 && estimateTokens(renderReadLines(selected, offset)) > maxTokens) {
        selected = selected.slice(0, -1);
      }
      if (selected.length === 0 && lines.length > 0) {
        throw new Error(
          `Line ${offset} exceeds Read output token budget (${maxTokens} estimated tokens). Use Grep or a more specific tool; Read will not return partial lines.`
        );
      }
      return selected;
    };
    estimateTokens = (value) => Math.ceil(value.length / 3);
    renderReadLines = (lines, offset) => lines.map((line, index) => `${String(offset + index).padStart(6, " ")}	${line}`).join("\n");
    readTokenBudget = (contextWindow, ratio) => {
      const window = contextWindow ?? DEFAULT_CONTEXT_WINDOW;
      if (!Number.isFinite(window) || window <= 0) {
        return Math.max(1, Math.floor(DEFAULT_CONTEXT_WINDOW * ratio));
      }
      return Math.max(1, Math.floor(window * ratio));
    };
    completeRanges = (totalLines) => totalLines === 0 ? [] : [{ startLine: 1, endLine: totalLines }];
    hasCompleteCoverage = (ranges, totalLines) => {
      if (totalLines === 0) {
        return true;
      }
      const merged = mergeRanges(ranges);
      return merged.length === 1 && merged[0]?.startLine === 1 && merged[0].endLine >= totalLines;
    };
    mergeRanges = (ranges) => {
      const sorted = ranges.filter((range) => range.startLine <= range.endLine).sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
      const merged = [];
      for (const range of sorted) {
        const last = merged.at(-1);
        if (!last || range.startLine > last.endLine + 1) {
          merged.push({ ...range });
          continue;
        }
        last.endLine = Math.max(last.endLine, range.endLine);
      }
      return merged;
    };
    countOccurrences = (content, needle) => {
      if (needle.length === 0) {
        throw new Error("old_string must not be empty");
      }
      let count = 0;
      let index = 0;
      while (true) {
        const found = content.indexOf(needle, index);
        if (found === -1) {
          return count;
        }
        count += 1;
        index = found + needle.length;
      }
    };
    atomicWriteFile = async (path, content) => {
      const temp = resolve(dirname3(path), `.${randomUUID2()}.tmp`);
      try {
        await writeFile2(temp, content, "utf8");
        await rename2(temp, path);
      } catch (cause) {
        await rm(temp, { force: true }).catch(() => void 0);
        throw cause;
      }
    };
    bashResult = (input) => {
      const stdout = truncate(input.stdout, input.outputLimit, "stdout");
      const stderr = truncate(input.stderr, input.outputLimit, "stderr");
      return textResult(`exitCode: ${input.exitCode}
cwd: ${input.cwd}
stdout:
${stdout}
stderr:
${stderr}`, {
        exitCode: input.exitCode,
        cwd: input.cwd,
        ...input.shell ? { shell: input.shell } : {},
        ...input.command ? { command: input.command } : {},
        ...input.rtk ? {
          rtk: {
            ...input.rtk,
            estimatedOutputTokens: estimateTokens(`${stdout}
${stderr}`)
          }
        } : {}
      });
    };
    resolveDefaultShell = (input) => {
      const shell = input || process.env.SHELL || userShell() || "/bin/sh";
      return shell.trim() || "/bin/sh";
    };
    resolveRtkCommand = async (rtk, command) => {
      if (rtk?.enabled !== true || typeof rtk.executable !== "string" || rtk.executable.length === 0) {
        return { applied: false };
      }
      try {
        const result = await execFileAsync(rtk.executable, ["rewrite", command], {
          timeout: 5e3,
          maxBuffer: 1024 * 1024
        });
        return rtkRewriteResult(result.stdout, rtk.executable);
      } catch (cause) {
        if (isExecError(cause) && typeof cause.stdout === "string") {
          return rtkRewriteResult(cause.stdout, rtk.executable);
        }
        return { applied: false };
      }
    };
    rtkRewriteResult = (stdout, executable) => {
      const rewrittenCommand = stdout.trim();
      return rewrittenCommand ? { applied: true, rewrittenCommand, executionCommand: executableRewriteCommand(rewrittenCommand, executable) } : { applied: false };
    };
    executableRewriteCommand = (command, executable) => command.replace(/^rtk(?=\s|$)/, shellQuote(executable));
    readRtkGain = async (rtkExecutable, cwd) => {
      try {
        const { stdout } = await execFileAsync(rtkExecutable, ["gain", "--project", "--format", "json"], {
          cwd,
          timeout: 5e3,
          maxBuffer: 5e6
        });
        const parsed = JSON.parse(stdout);
        if (!isRecord3(parsed) || !isRecord3(parsed.summary)) {
          return void 0;
        }
        return { savedTokens: nonNegativeInteger(parsed.summary.total_saved) };
      } catch {
        return void 0;
      }
    };
    rtkSavedTokenDelta = async (rtkExecutable, cwd, before) => {
      if (!before) {
        return void 0;
      }
      const after = await readRtkGain(rtkExecutable, cwd);
      if (!after) {
        return void 0;
      }
      return Math.max(0, after.savedTokens - before.savedTokens);
    };
    withRtkSavings = (rtk, savedTokens) => ({
      ...rtk,
      ...rtk.applied && savedTokens !== void 0 ? { estimatedSavedTokens: savedTokens } : {}
    });
    nonNegativeInteger = (value) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return 0;
      }
      return Math.floor(value);
    };
    isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    shellQuote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
    shellCommandArgs = (shell, command) => {
      const name = basename2(shell).toLowerCase();
      if (name === "csh" || name === "tcsh" || name === "fish") {
        return ["-c", command];
      }
      return ["-lc", command];
    };
    userShell = () => {
      try {
        return userInfo().shell ?? void 0;
      } catch {
        return void 0;
      }
    };
    truncate = (value, maxBytes, label) => {
      const bytes = Buffer.byteLength(value);
      if (bytes <= maxBytes) {
        return value;
      }
      const truncated = Buffer.from(value).subarray(0, maxBytes).toString("utf8");
      return `${truncated}
[${label} truncated: ${bytes} bytes > ${maxBytes} bytes]`;
    };
    textResult = (text, details) => ({
      content: [{ type: "text", text }],
      details
    });
    byteLength = (value) => Buffer.byteLength(value);
    isTimeoutError = (cause) => typeof cause === "object" && cause !== null && ("killed" in cause || "signal" in cause) && (cause.killed === true || cause.signal === "SIGTERM");
    isExecError = (cause) => cause instanceof Error && ("stdout" in cause || "stderr" in cause || "code" in cause);
    runRipgrep = async (args, target, cwd, signal) => {
      try {
        const result = await execFileAsync("rg", [...args, target], {
          cwd,
          signal,
          maxBuffer: 2e7
        });
        return splitOutput(result.stdout);
      } catch (cause) {
        if (isExecError(cause) && cause.code === 1) {
          return [];
        }
        if (isExecError(cause) && typeof cause.stdout === "string" && cause.stdout.trim().length > 0) {
          return splitOutput(cause.stdout);
        }
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`ripgrep failed: ${message}`);
      }
    };
    splitOutput = (output) => output.trim().split("\n").map((line) => line.replace(/\r$/, "")).filter(Boolean);
    vcsExcludes = () => [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"].flatMap((dir) => ["--glob", `!${dir}`]);
    grepArgs = (input, mode) => {
      const args = ["--hidden", "--max-columns", "500", ...vcsExcludes()];
      if (input.multiline) {
        args.push("-U", "--multiline-dotall");
      }
      if (input.case_insensitive) {
        args.push("-i");
      }
      if (mode === "files") {
        args.push("-l");
      } else if (mode === "count") {
        args.push("-c");
      } else {
        if (input.line_numbers ?? true) {
          args.push("-n");
        }
        if (input.context !== void 0) {
          args.push("-C", String(input.context));
        } else {
          if (input.before_context !== void 0) {
            args.push("-B", String(input.before_context));
          }
          if (input.after_context !== void 0) {
            args.push("-A", String(input.after_context));
          }
        }
      }
      if (input.type) {
        args.push("--type", input.type);
      }
      if (input.glob) {
        for (const pattern of splitGlobPatterns(input.glob)) {
          args.push("--glob", pattern);
        }
      }
      if (input.pattern.startsWith("-")) {
        args.push("-e", input.pattern);
      } else {
        args.push(input.pattern);
      }
      return args;
    };
    splitGlobPatterns = (value) => value.split(/\s+/).flatMap((part) => part.includes("{") && part.includes("}") ? [part] : part.split(",")).filter(Boolean);
    paginate = (items, limit, offset) => {
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error("head_limit must be a non-negative integer");
      }
      if (!Number.isInteger(offset) || offset < 0) {
        throw new Error("offset must be a non-negative integer");
      }
      if (limit === 0) {
        return { items: items.slice(offset), truncated: false };
      }
      const selected = items.slice(offset, offset + limit);
      const truncated = items.length - offset > limit;
      return {
        items: selected,
        truncated,
        ...truncated ? { appliedLimit: limit } : {}
      };
    };
    toWorkspaceRelative = (root) => (path) => {
      const absolute = isAbsolute(path) ? path : resolve(root, path);
      return relative(root, absolute) || ".";
    };
    relativizeGrepLine = (root) => (line) => {
      const colon = line.indexOf(":");
      if (colon <= 0) {
        return line;
      }
      const file = line.slice(0, colon);
      const rest = line.slice(colon);
      return `${toWorkspaceRelative(root)(file)}${rest}`;
    };
    relativizeCountLine = (root) => (line) => {
      const colon = line.lastIndexOf(":");
      if (colon <= 0) {
        return line;
      }
      const file = line.slice(0, colon);
      const rest = line.slice(colon);
      return `${toWorkspaceRelative(root)(file)}${rest}`;
    };
    sortPathsByMtime = async (root, paths) => {
      const entries = await Promise.all(
        paths.map(async (path) => {
          try {
            const info = await stat3(isAbsolute(path) ? path : resolve(root, path));
            return { path, mtimeMs: info.mtimeMs };
          } catch {
            return { path, mtimeMs: 0 };
          }
        })
      );
      return entries.sort((left, right) => {
        const time = right.mtimeMs - left.mtimeMs;
        return time === 0 ? left.path.localeCompare(right.path) : time;
      }).map((entry) => entry.path);
    };
    formatPaginatedText = (lines, page, offset) => {
      const body = lines.length > 0 ? lines.join("\n") : "No matches found";
      const suffix = formatLimitSuffix(page, offset);
      return suffix ? `${body}

[Showing results with pagination =${suffix}]` : body;
    };
    formatLimitSuffix = (page, offset) => {
      const parts = [];
      if (page.appliedLimit !== void 0) {
        parts.push(`limit: ${page.appliedLimit}`);
      }
      if (offset > 0) {
        parts.push(`offset: ${offset}`);
      }
      return parts.length > 0 ? ` ${parts.join(", ")}` : "";
    };
    parseCountLines = (lines) => {
      let files = 0;
      let matches = 0;
      for (const line of lines) {
        const colon = line.lastIndexOf(":");
        if (colon <= 0) {
          continue;
        }
        const count = Number.parseInt(line.slice(colon + 1), 10);
        if (Number.isFinite(count)) {
          files += 1;
          matches += count;
        }
      }
      return { files, matches };
    };
  }
});

// packages/core/src/tools/index.ts
var defineTool;
var init_tools = __esm({
  "packages/core/src/tools/index.ts"() {
    "use strict";
    init_coding_tools();
    defineTool = (tool) => tool;
  }
});

// packages/core/src/channel/index.ts
var createSendChannelMessageTool, parseSendChannelMessageInput, parseAttachments, optionalString2, isRecord4;
var init_channel = __esm({
  "packages/core/src/channel/index.ts"() {
    "use strict";
    init_tools();
    createSendChannelMessageTool = (options) => defineTool({
      name: "SendChannelMessage",
      description: "Send a text reply to the current IM channel conversation. Do not provide raw platform user ids or group ids.",
      execute: async (_toolCallId, args) => {
        const input = parseSendChannelMessageInput(args);
        const result = await options.sendCurrent(input);
        return {
          content: [{ type: "text", text: `Channel message sent to ${result.channel}:${result.target}` }],
          details: { ...result, attachments: result.attachments ?? input.attachments?.length ?? 0 }
        };
      }
    });
    parseSendChannelMessageInput = (value) => {
      if (!isRecord4(value)) {
        throw new Error("SendChannelMessage args must be an object");
      }
      const text = typeof value.text === "string" && value.text.trim().length > 0 ? value.text : void 0;
      const attachments = parseAttachments(value.attachments);
      if (!text && attachments.length === 0) {
        throw new Error("SendChannelMessage requires text or attachments");
      }
      if (value.channel !== void 0 && (typeof value.channel !== "string" || value.channel.trim().length === 0)) {
        throw new Error("SendChannelMessage.channel must be a non-empty string when provided");
      }
      if (value.target !== void 0 && value.target !== "current") {
        throw new Error("SendChannelMessage.target must be current when provided");
      }
      return {
        ...text ? { text } : {},
        ...attachments.length > 0 ? { attachments } : {},
        ...typeof value.channel === "string" ? { channel: value.channel } : {},
        ...value.target === "current" ? { target: "current" } : {}
      };
    };
    parseAttachments = (value) => {
      if (value === void 0) {
        return [];
      }
      if (!Array.isArray(value)) {
        throw new Error("SendChannelMessage.attachments must be an array");
      }
      return value.map((item, index) => {
        if (!isRecord4(item)) {
          throw new Error(`SendChannelMessage.attachments.${index} must be an object`);
        }
        if (item.type !== "image" && item.type !== "file") {
          throw new Error(`SendChannelMessage.attachments.${index}.type must be image or file`);
        }
        const path = optionalString2(item.path, `SendChannelMessage.attachments.${index}.path`);
        const url = optionalString2(item.url, `SendChannelMessage.attachments.${index}.url`);
        if (!path && !url) {
          throw new Error(`SendChannelMessage.attachments.${index} requires path or url`);
        }
        return {
          type: item.type,
          ...path ? { path } : {},
          ...url ? { url } : {},
          ...optionalString2(item.mimeType, `SendChannelMessage.attachments.${index}.mimeType`) ? { mimeType: optionalString2(item.mimeType, `SendChannelMessage.attachments.${index}.mimeType`) } : {},
          ...optionalString2(item.caption, `SendChannelMessage.attachments.${index}.caption`) ? { caption: optionalString2(item.caption, `SendChannelMessage.attachments.${index}.caption`) } : {}
        };
      });
    };
    optionalString2 = (value, name) => {
      if (value === void 0 || value === "") {
        return void 0;
      }
      if (typeof value !== "string") {
        throw new Error(`${name} must be a string`);
      }
      return value;
    };
    isRecord4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  }
});

// packages/core/src/extensions/index.ts
import { readFile as readFile5 } from "node:fs/promises";
import { dirname as dirname4, resolve as resolve2 } from "node:path";
var loadExtensionManifest, parseExtensionManifest, requireString2, requireIdentifier2, requireKind, requireRelativePath, optionalRelativePaths, isRecord5;
var init_extensions = __esm({
  "packages/core/src/extensions/index.ts"() {
    "use strict";
    loadExtensionManifest = async (manifestPath) => parseExtensionManifest(await readFile5(manifestPath, "utf8"), manifestPath);
    parseExtensionManifest = (text, manifestPath = "scorel.extension.json") => {
      let value;
      try {
        value = JSON.parse(text);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Invalid extension manifest JSON at ${manifestPath}: ${message}`);
      }
      if (!isRecord5(value)) {
        throw new Error(`Extension manifest at ${manifestPath} must be an object`);
      }
      const rootDir = dirname4(resolve2(manifestPath));
      const id = requireIdentifier2(value.id, "id", manifestPath);
      const kind = requireKind(value.kind, manifestPath);
      const displayName = requireString2(value.displayName, "displayName", manifestPath);
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
        manifestPath: resolve2(manifestPath),
        rootDir
      };
    };
    requireString2 = (value, name, manifestPath) => {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Extension manifest ${manifestPath} field ${name} must be a non-empty string`);
      }
      return value;
    };
    requireIdentifier2 = (value, name, manifestPath) => {
      const text = requireString2(value, name, manifestPath);
      if (!/^[A-Za-z0-9_-]+$/.test(text)) {
        throw new Error(`Extension manifest ${manifestPath} field ${name} must contain only letters, numbers, underscores, or hyphens`);
      }
      return text;
    };
    requireKind = (value, manifestPath) => {
      if (value === "im") {
        return value;
      }
      throw new Error(`Extension manifest ${manifestPath} field kind must be im`);
    };
    requireRelativePath = (value, name, manifestPath) => {
      const text = requireString2(value, name, manifestPath);
      if (text.startsWith("/") || text.includes("..")) {
        throw new Error(`Extension manifest ${manifestPath} field ${name} must be a relative path inside the extension`);
      }
      return text;
    };
    optionalRelativePaths = (value, name, manifestPath) => {
      if (value === void 0) {
        return [];
      }
      if (!Array.isArray(value)) {
        throw new Error(`Extension manifest ${manifestPath} field ${name} must be an array`);
      }
      return value.map((item, index) => requireRelativePath(item, `${name}.${index}`, manifestPath));
    };
    isRecord5 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  }
});

// packages/core/src/instructions/index.ts
import { existsSync } from "node:fs";
import { readdir as readdir4, readFile as readFile6 } from "node:fs/promises";
import { homedir as homedir2, platform, release } from "node:os";
import { dirname as dirname5, join as join5, resolve as resolve3 } from "node:path";
var BASELINE_PROMPT, buildInstructionSnapshot, renderSystemPrompt, section, discoverAgentsSources, projectAgentsPaths, findGitRoot, renderAgentsBlock, renderWorkspaceBlock, renderEnvironmentBlock, renderTimeBlock, isNodeErrorCode;
var init_instructions = __esm({
  "packages/core/src/instructions/index.ts"() {
    "use strict";
    BASELINE_PROMPT = [
      "You are Scorel, a coding agent running inside a recoverable local workspace.",
      "Follow the user's request, respect the project instructions, use tools deliberately, and keep changes scoped to the active task.",
      "Tool results and user messages may include <system-reminder> tags. These tags contain information automatically added by Scorel's harness. They are not part of the specific tool result or user message in which they appear.",
      "If the AppendDaily tool is available, use it once near the end of meaningful completed work to record durable progress, decisions, and follow-ups. Do not use it for empty turns or transient noise."
    ].join("\n");
    buildInstructionSnapshot = async (options) => {
      const cwd = resolve3(options.cwd);
      const now = options.now ?? Date.now;
      const frozenAt = now();
      const homeDir = resolve3(options.homeDir ?? homedir2());
      const agentsSources = await discoverAgentsSources({ cwd, homeDir });
      const repoRoot = findGitRoot(cwd);
      return {
        version: 1,
        cwd,
        sections: [
          section("baseline", frozenAt, BASELINE_PROMPT, [{ sourceType: "builtin" }]),
          section("agents", frozenAt, renderAgentsBlock(agentsSources), agentsSources),
          section("memory", frozenAt, "No memory sources are configured for this session.", []),
          section("workspace", frozenAt, await renderWorkspaceBlock(cwd, repoRoot), void 0, {
            cwd,
            repoRoot
          }),
          section("environment", frozenAt, renderEnvironmentBlock(options.env ?? process.env), void 0, {
            platform: platform(),
            release: release(),
            shell: (options.env ?? process.env).SHELL
          }),
          section("time", frozenAt, renderTimeBlock(frozenAt), void 0, {
            timestamp: frozenAt,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
          })
        ]
      };
    };
    renderSystemPrompt = (snapshot) => snapshot.sections.map((section2) => section2.renderedBlock.trim()).filter(Boolean).join("\n\n");
    section = (kind, frozenAt, renderedBlock, sources, data) => ({
      kind,
      frozenAt,
      ...sources ? { sources } : {},
      renderedBlock,
      ...data ? { data } : {}
    });
    discoverAgentsSources = async (options) => {
      const projectFiles = projectAgentsPaths(options.cwd, options.homeDir);
      const globalPath = join5(options.homeDir, ".scorel", "AGENTS.md");
      const candidates = [...projectFiles.map((path) => ({ path, scope: "project" })), { path: globalPath, scope: "global_user" }];
      const sources = [];
      for (const candidate of candidates) {
        try {
          const content = await readFile6(candidate.path, "utf8");
          sources.push({
            sourceType: "agents_md",
            path: candidate.path,
            scope: candidate.scope,
            priority: candidate.scope === "global_user" ? 0 : sources.length + 1,
            content
          });
        } catch (cause) {
          if (!isNodeErrorCode(cause, "ENOENT") && !isNodeErrorCode(cause, "ENOTDIR")) {
            throw cause;
          }
        }
      }
      return sources;
    };
    projectAgentsPaths = (cwd, homeDir) => {
      const gitRoot = findGitRoot(cwd);
      const stopAt = gitRoot ?? homeDir;
      const paths = [];
      let current = cwd;
      while (true) {
        if (current !== homeDir) {
          paths.push(join5(current, "AGENTS.md"));
        }
        if (current === stopAt || current === dirname5(current)) {
          break;
        }
        const next = dirname5(current);
        if (!gitRoot && next === homeDir) {
          break;
        }
        current = next;
      }
      return paths.reverse();
    };
    findGitRoot = (cwd) => {
      let current = cwd;
      while (true) {
        if (existsSync(join5(current, ".git"))) {
          return current;
        }
        const next = dirname5(current);
        if (next === current) {
          return void 0;
        }
        current = next;
      }
    };
    renderAgentsBlock = (sources) => {
      if (sources.length === 0) {
        return "No AGENTS.md instructions were found for this session.";
      }
      return [
        "AGENTS.md instructions loaded for this session:",
        ...sources.map(
          (source) => [`Source: ${source.path}`, `Scope: ${source.scope}`, "Content:", source.content.trimEnd()].join("\n")
        )
      ].join("\n\n");
    };
    renderWorkspaceBlock = async (cwd, repoRoot) => {
      const root = repoRoot ?? cwd;
      let entries = [];
      try {
        entries = (await readdir4(root, { withFileTypes: true })).filter((entry) => !entry.name.startsWith(".")).slice(0, 20).map((entry) => `${entry.isDirectory() ? "dir" : "file"}:${entry.name}`);
      } catch {
        entries = [];
      }
      return [`Workspace cwd: ${cwd}`, `Repository root: ${repoRoot ?? "not detected"}`, `Top-level entries: ${entries.join(", ") || "none"}`].join("\n");
    };
    renderEnvironmentBlock = (env) => [`Platform: ${platform()} ${release()}`, `Shell: ${env.SHELL ?? "unknown"}`].join("\n");
    renderTimeBlock = (timestamp) => [`Session started at: ${new Date(timestamp).toISOString()}`, `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`].join("\n");
    isNodeErrorCode = (cause, code) => cause instanceof Error && "code" in cause && cause.code === code;
  }
});

// packages/core/src/memory/index.ts
import { appendFile, mkdir as mkdir3, readFile as readFile7, writeFile as writeFile3 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { join as join6 } from "node:path";
var memoryDate, scorelMemoryPaths, scorelSessionMemoryPaths, buildMemoryContext, renderMemoryHarness, appendDailyEntry, createAppendDailyTool, renderDailyEntry, readMemoryDreamState, writeMemoryDreamState, readSessionMemory, writeSessionMemory, renderSessionMemory, ensureMemoryFiles, ensureFile, readOptional, trimForContext, compactLine, renderList, renderBullets, normalizeMarkdownFile, parseAppendDailyInput, validateAppendDailyInput, isLowSignalSummary, containsNormalizedDailyEntry, normalizeDailyText, requireString3, optionalStringArray, optionalNumber2, optionalString3, parseLastFailure, isRecord6, safeProjectId, isNodeErrorCode2;
var init_memory = __esm({
  "packages/core/src/memory/index.ts"() {
    "use strict";
    init_tools();
    memoryDate = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
    scorelMemoryPaths = (options) => {
      const home = options.homeDir ?? homedir3();
      const now = options.now ?? Date.now;
      const today = memoryDate(now());
      const yesterday = memoryDate(now() - 24 * 60 * 60 * 1e3);
      const rootDir = join6(home, ".scorel", "memory");
      const projectDir = join6(rootDir, "projects", safeProjectId(options.projectId));
      const dailyDir = join6(projectDir, "daily");
      return {
        rootDir,
        rootMemoryPath: join6(rootDir, "MEMORY.md"),
        projectDir,
        projectMemoryPath: join6(projectDir, "MEMORY.md"),
        dailyDir,
        todayDailyPath: join6(dailyDir, `${today}.md`),
        yesterdayDailyPath: join6(dailyDir, `${yesterday}.md`),
        dreamStatePath: join6(projectDir, "dream-state.json"),
        today,
        yesterday
      };
    };
    scorelSessionMemoryPaths = (options) => {
      const home = options.homeDir ?? homedir3();
      const sessionsDir = join6(home, ".scorel", "context", "session-memory", safeProjectId(options.projectId));
      return {
        sessionsDir,
        sessionMemoryPath: join6(sessionsDir, `${safeProjectId(options.sessionId)}.md`)
      };
    };
    buildMemoryContext = async (options) => {
      const paths = scorelMemoryPaths(options);
      await ensureMemoryFiles(paths);
      return {
        paths,
        rootMemory: trimForContext(await readOptional(paths.rootMemoryPath), 8e3),
        projectMemory: trimForContext(await readOptional(paths.projectMemoryPath), 12e3),
        todayDaily: trimForContext(await readOptional(paths.todayDailyPath), 8e3, "tail"),
        yesterdayDaily: trimForContext(await readOptional(paths.yesterdayDailyPath), 8e3, "tail")
      };
    };
    renderMemoryHarness = (context) => [
      "Memory context for this session.",
      "",
      "Root MEMORY.md:",
      context.rootMemory.trim() || "(empty)",
      "",
      "Project MEMORY.md:",
      context.projectMemory.trim() || "(empty)",
      "",
      `Recent daily (${context.paths.yesterday}, ${context.paths.today}):`,
      context.yesterdayDaily.trim() || "(yesterday empty)",
      "",
      context.todayDaily.trim() || "(today empty)",
      "",
      "Memory rules:",
      "- Treat memory as point-in-time context; verify current code facts from the repo before acting.",
      "- Project MEMORY overrides root MEMORY for project-specific decisions.",
      "- Daily notes are recent progress context, not long-term truth."
    ].join("\n");
    appendDailyEntry = async (options) => {
      const paths = scorelMemoryPaths(options);
      await ensureMemoryFiles(paths);
      const text = options.text.trim();
      if (!text) {
        return { path: paths.todayDailyPath, entry: "", date: paths.today, skippedReason: "empty" };
      }
      const existing = await readOptional(paths.todayDailyPath);
      if (containsNormalizedDailyEntry(existing, text)) {
        return { path: paths.todayDailyPath, entry: "", date: paths.today, skippedReason: "duplicate" };
      }
      const time = new Date((options.now ?? Date.now)()).toISOString().slice(11, 16);
      const entry = `- ${time} ${text.replace(/\s+/g, " ")}
`;
      await appendFile(paths.todayDailyPath, entry, "utf8");
      return { path: paths.todayDailyPath, entry: entry.trimEnd(), date: paths.today };
    };
    createAppendDailyTool = (options) => defineTool({
      name: "AppendDaily",
      description: [
        "Append a compact hidden project daily journal entry after meaningful work.",
        "Use this once near the end of a completed user turn when there is progress, a decision, or a follow-up worth preserving.",
        "Do not include secrets, raw logs, speculation, or facts that should be re-read from the repository."
      ].join(" "),
      execute: async (_toolCallId, args) => {
        const input = parseAppendDailyInput(args);
        validateAppendDailyInput(input);
        const result = await appendDailyEntry({
          projectId: options.projectId,
          homeDir: options.homeDir,
          now: options.now,
          text: renderDailyEntry(input)
        });
        await options.onAppend?.(result);
        return {
          content: [{
            type: "text",
            text: result.entry ? `Daily appended: ${result.date}` : `Daily append skipped: ${result.skippedReason ?? "empty"}`
          }],
          details: {
            path: result.path,
            date: result.date,
            skippedReason: result.skippedReason
          }
        };
      }
    });
    renderDailyEntry = (input) => {
      const sections = [
        `Summary: ${compactLine(input.summary, 500)}`,
        renderList("Completed", input.completed),
        renderList("Decisions", input.decisions),
        renderList("Follow-ups", input.followUps),
        renderList("Memory candidates", input.memoryCandidates),
        renderList("Evidence", input.evidence)
      ].filter(Boolean);
      return sections.join(" ");
    };
    readMemoryDreamState = async (options) => {
      const paths = scorelMemoryPaths(options);
      const text = await readOptional(paths.dreamStatePath);
      if (!text.trim()) return void 0;
      try {
        const parsed = JSON.parse(text);
        if (parsed.projectId !== options.projectId) return void 0;
        return {
          projectId: options.projectId,
          dirty: Boolean(parsed.dirty),
          running: Boolean(parsed.running),
          sessionId: optionalString3(parsed.sessionId),
          clientId: optionalString3(parsed.clientId),
          lastDailyAppendAt: optionalNumber2(parsed.lastDailyAppendAt),
          lastDailyPath: optionalString3(parsed.lastDailyPath),
          scheduledFor: optionalNumber2(parsed.scheduledFor),
          lastAttemptAt: optionalNumber2(parsed.lastAttemptAt),
          lastSuccessAt: optionalNumber2(parsed.lastSuccessAt),
          lastFailure: parseLastFailure(parsed.lastFailure),
          lastProjectMemoryUpdateAt: optionalNumber2(parsed.lastProjectMemoryUpdateAt),
          lastRootMemoryUpdateAt: optionalNumber2(parsed.lastRootMemoryUpdateAt)
        };
      } catch {
        return void 0;
      }
    };
    writeMemoryDreamState = async (options) => {
      const paths = scorelMemoryPaths(options);
      await mkdir3(paths.projectDir, { recursive: true, mode: 448 });
      const state = { ...options.state, projectId: options.projectId };
      await writeFile3(paths.dreamStatePath, `${JSON.stringify(state, null, 2)}
`, { encoding: "utf8", mode: 384 });
      return state;
    };
    readSessionMemory = async (options) => {
      const paths = scorelSessionMemoryPaths(options);
      return trimForContext(await readOptional(paths.sessionMemoryPath), 12e3, "tail");
    };
    writeSessionMemory = async (input) => {
      const paths = scorelSessionMemoryPaths(input);
      await mkdir3(paths.sessionsDir, { recursive: true, mode: 448 });
      const content = renderSessionMemory(input);
      await writeFile3(paths.sessionMemoryPath, content, { encoding: "utf8", mode: 384 });
      return { path: paths.sessionMemoryPath, content };
    };
    renderSessionMemory = (input) => {
      const timestamp = new Date((input.now ?? Date.now)()).toISOString();
      return normalizeMarkdownFile([
        `# Session Memory: ${input.sessionId}`,
        "",
        `Updated: ${timestamp}`,
        "",
        "## Current State",
        compactLine(input.summary, 1200) || "- No durable session state captured yet.",
        "",
        "## Recent Work",
        renderBullets(input.recentMessages, 360) || "- No recent work captured.",
        "",
        "## Decisions",
        renderBullets(input.decisions, 360) || "- No session decisions captured.",
        "",
        "## Follow-ups",
        renderBullets(input.followUps, 360) || "- No follow-ups captured."
      ].join("\n"));
    };
    ensureMemoryFiles = async (paths) => {
      await mkdir3(paths.rootDir, { recursive: true, mode: 448 });
      await mkdir3(paths.projectDir, { recursive: true, mode: 448 });
      await mkdir3(paths.dailyDir, { recursive: true, mode: 448 });
      await ensureFile(paths.rootMemoryPath, "# Memory\n");
      await ensureFile(paths.projectMemoryPath, "# Project Memory\n");
      await ensureFile(paths.todayDailyPath, `# ${paths.today}

`);
    };
    ensureFile = async (path, content) => {
      try {
        await writeFile3(path, content, { encoding: "utf8", flag: "wx", mode: 384 });
      } catch (cause) {
        if (!isNodeErrorCode2(cause, "EEXIST")) {
          throw cause;
        }
      }
    };
    readOptional = async (path) => {
      try {
        return await readFile7(path, "utf8");
      } catch (cause) {
        if (isNodeErrorCode2(cause, "ENOENT")) {
          return "";
        }
        throw cause;
      }
    };
    trimForContext = (text, maxChars, mode = "head") => {
      if (text.length <= maxChars) {
        return text;
      }
      return mode === "tail" ? text.slice(-maxChars) : text.slice(0, maxChars);
    };
    compactLine = (value, maxChars) => value.replace(/\s+/g, " ").trim().slice(0, maxChars);
    renderList = (label, values) => {
      const items = (values ?? []).map((value) => compactLine(value, 240)).filter(Boolean);
      return items.length > 0 ? `${label}: ${items.join("; ")}` : "";
    };
    renderBullets = (values, maxChars) => (values ?? []).map((value) => compactLine(value, maxChars)).filter(Boolean).map((value) => `- ${value}`).join("\n");
    normalizeMarkdownFile = (value) => `${value.trimEnd()}
`;
    parseAppendDailyInput = (value) => {
      if (!isRecord6(value)) {
        throw new Error("AppendDaily args must be an object");
      }
      const summary = requireString3(value.summary, "summary");
      return {
        summary,
        completed: optionalStringArray(value.completed, "completed"),
        decisions: optionalStringArray(value.decisions, "decisions"),
        followUps: optionalStringArray(value.followUps, "followUps"),
        memoryCandidates: optionalStringArray(value.memoryCandidates, "memoryCandidates"),
        evidence: optionalStringArray(value.evidence, "evidence")
      };
    };
    validateAppendDailyInput = (input) => {
      const summary = compactLine(input.summary, 500);
      if (isLowSignalSummary(summary)) {
        throw new Error("AppendDaily.summary is too generic; include concrete durable progress or a decision");
      }
      const details = [
        ...input.completed ?? [],
        ...input.decisions ?? [],
        ...input.followUps ?? [],
        ...input.memoryCandidates ?? [],
        ...input.evidence ?? []
      ].map((value) => compactLine(value, 240)).filter(Boolean);
      if (details.length === 0) {
        throw new Error("AppendDaily requires at least one completed item, decision, follow-up, memory candidate, or evidence item");
      }
    };
    isLowSignalSummary = (value) => {
      const normalized = value.toLowerCase().replace(/\s+/g, "");
      return [
        "done",
        "completed",
        "finished",
        "updated",
        "\u7EE7\u7EED\u63A8\u8FDB",
        "\u5B8C\u6210\u4EFB\u52A1",
        "\u5DF2\u5904\u7406",
        "\u5904\u7406\u5B8C\u6210",
        "\u505A\u4E86\u4E00\u4E9B\u4FEE\u6539"
      ].includes(normalized);
    };
    containsNormalizedDailyEntry = (daily, text) => {
      const needle = normalizeDailyText(text);
      return daily.split("\n").map((line) => line.replace(/^-\s+\d\d:\d\d\s+/, "")).some((line) => normalizeDailyText(line) === needle);
    };
    normalizeDailyText = (value) => value.replace(/\s+/g, " ").trim().toLowerCase();
    requireString3 = (value, name) => {
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`AppendDaily.${name} must be a non-empty string`);
      }
      return value.trim();
    };
    optionalStringArray = (value, name) => {
      if (value === void 0) {
        return void 0;
      }
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error(`AppendDaily.${name} must be an array of strings`);
      }
      return value.map((item) => item.trim()).filter(Boolean);
    };
    optionalNumber2 = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
    optionalString3 = (value) => typeof value === "string" && value.trim() ? value : void 0;
    parseLastFailure = (value) => {
      if (!isRecord6(value)) return void 0;
      const at = optionalNumber2(value.at);
      const message = optionalString3(value.message);
      return at !== void 0 && message ? { at, message } : void 0;
    };
    isRecord6 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    safeProjectId = (projectId) => {
      if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
        throw new Error("projectId must contain only letters, numbers, underscores, or hyphens");
      }
      return projectId;
    };
    isNodeErrorCode2 = (cause, code) => cause instanceof Error && "code" in cause && cause.code === code;
  }
});

// packages/core/src/provider/pi-ai.ts
import {
  Type,
  getModels,
  streamSimple
} from "@mariozechner/pi-ai";
var DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW, DEFAULT_CUSTOM_MODEL_MAX_TOKENS, createPiAiProvider, resolvePiAiModel, toPiContext, toPiMessage, toPiAssistantBlock, fromPiAssistant, fromPiContentBlock, toPiTool, toolParameters, textContent, toolResultText, stringMeta, toPiStopReason, fromPiStopReason, fromPiUsage;
var init_pi_ai = __esm({
  "packages/core/src/provider/pi-ai.ts"() {
    "use strict";
    DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 2e5;
    DEFAULT_CUSTOM_MODEL_MAX_TOKENS = 64e3;
    createPiAiProvider = (options) => ({
      streamTurn: async function* ({ context, systemPrompt, tools, signal }) {
        const stream = streamSimple(options.model, toPiContext(context, systemPrompt, tools), {
          apiKey: options.apiKey,
          signal,
          ...options.reasoning ? { reasoning: options.reasoning } : {},
          ...options.onPayload ? { onPayload: options.onPayload } : {}
        });
        for await (const event of stream) {
          if (event.type === "text_delta") {
            yield { type: "text_delta", delta: event.delta };
          } else if (event.type === "thinking_delta") {
            yield { type: "thinking_delta", delta: event.delta };
          }
        }
        return fromPiAssistant(await stream.result());
      }
    });
    resolvePiAiModel = (config) => {
      if (config.type === "custom") {
        return {
          id: config.id,
          name: config.id,
          api: config.api,
          provider: config.provider,
          baseUrl: config.baseUrl,
          input: config.supportsImageInput ? ["text", "image"] : ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          reasoning: config.reasoning ?? false,
          contextWindow: config.contextWindow ?? DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
          maxTokens: config.maxTokens ?? DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
          ...config.api === "openai-completions" ? { compat: { supportsDeveloperRole: config.compat?.supportsDeveloperRole ?? false } } : {}
        };
      }
      const model = getModels(config.provider).find((candidate) => candidate.id === config.id);
      if (!model) {
        throw new Error(`Unknown pi-ai model: ${config.provider}/${config.id}`);
      }
      return {
        ...model,
        ...config.baseUrl ? { baseUrl: config.baseUrl } : {}
      };
    };
    toPiContext = (context, systemPrompt, tools) => ({
      ...systemPrompt ? { systemPrompt } : {},
      messages: context.flatMap(toPiMessage),
      tools: tools.map(toPiTool)
    });
    toPiMessage = (message) => {
      if (message.role === "system") {
        return [{ role: "user", content: textContent(message), timestamp: Date.now() }];
      }
      if (message.role === "user") {
        return [{ role: "user", content: textContent(message), timestamp: Date.now() }];
      }
      if (message.role === "assistant") {
        return [
          {
            role: "assistant",
            content: message.content.flatMap(toPiAssistantBlock),
            api: stringMeta(message, "api") ?? "openai-completions",
            provider: stringMeta(message, "provider") ?? "scorel",
            model: stringMeta(message, "model") ?? "unknown",
            usage: {
              input: message.usage?.inputTokens ?? 0,
              output: message.usage?.outputTokens ?? 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: message.usage?.totalTokens ?? 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
            },
            stopReason: toPiStopReason(message.stopReason),
            timestamp: Date.now()
          }
        ];
      }
      return message.content.flatMap((block) => {
        if (block.type !== "tool_result") {
          return [];
        }
        return [
          {
            role: "toolResult",
            toolCallId: block.toolCallId,
            toolName: block.toolName,
            content: [{ type: "text", text: toolResultText(block.result) }],
            isError: block.isError ?? false,
            timestamp: Date.now()
          }
        ];
      });
    };
    toPiAssistantBlock = (block) => {
      if (block.type === "text") {
        return [{ type: "text", text: block.text }];
      }
      if (block.type === "thinking") {
        return [{ type: "thinking", thinking: block.text }];
      }
      if (block.type === "tool_call") {
        return [{ type: "toolCall", id: block.toolCallId, name: block.toolName, arguments: block.args }];
      }
      return [];
    };
    fromPiAssistant = (message) => ({
      role: "assistant",
      content: message.content.map(fromPiContentBlock),
      stopReason: fromPiStopReason(message.stopReason),
      usage: fromPiUsage(message.usage),
      meta: {
        api: message.api,
        provider: message.provider,
        model: message.model
      }
    });
    fromPiContentBlock = (block) => {
      if (block.type === "text") {
        return { type: "text", text: block.text };
      }
      if (block.type === "thinking") {
        return { type: "thinking", text: block.thinking };
      }
      return {
        type: "tool_call",
        toolCallId: block.id,
        toolName: block.name,
        args: block.arguments
      };
    };
    toPiTool = (tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: toolParameters(tool.name)
    });
    toolParameters = (name) => {
      switch (name) {
        case "Read":
          return Type.Object({
            file_path: Type.String(),
            offset: Type.Optional(Type.Number()),
            limit: Type.Optional(Type.Number()),
            full: Type.Optional(Type.Boolean())
          });
        case "Write":
          return Type.Object({
            file_path: Type.String(),
            content: Type.String()
          });
        case "Edit":
          return Type.Object({
            file_path: Type.String(),
            old_string: Type.String(),
            new_string: Type.String(),
            replace_all: Type.Optional(Type.Boolean())
          });
        case "Bash":
          return Type.Object({
            command: Type.String(),
            cwd: Type.Optional(Type.String()),
            timeout: Type.Optional(Type.Number()),
            description: Type.Optional(Type.String()),
            maxOutputBytes: Type.Optional(Type.Number())
          });
        case "Glob":
          return Type.Object({
            pattern: Type.String(),
            path: Type.Optional(Type.String()),
            head_limit: Type.Optional(Type.Number()),
            offset: Type.Optional(Type.Number())
          });
        case "Grep":
          return Type.Object({
            pattern: Type.String(),
            path: Type.Optional(Type.String()),
            glob: Type.Optional(Type.String()),
            output_mode: Type.Optional(Type.Union([Type.Literal("files"), Type.Literal("content"), Type.Literal("count")])),
            "-B": Type.Optional(Type.Number()),
            "-A": Type.Optional(Type.Number()),
            "-C": Type.Optional(Type.Number()),
            context: Type.Optional(Type.Number()),
            "-n": Type.Optional(Type.Boolean()),
            "-i": Type.Optional(Type.Boolean()),
            type: Type.Optional(Type.String()),
            head_limit: Type.Optional(Type.Number()),
            offset: Type.Optional(Type.Number()),
            multiline: Type.Optional(Type.Boolean())
          });
        case "TodoWrite":
          return Type.Object({
            todos: Type.Array(
              Type.Object({
                content: Type.String(),
                status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
                activeForm: Type.Optional(Type.String())
              })
            )
          });
        case "AppendDaily":
          return Type.Object({
            summary: Type.String(),
            completed: Type.Optional(Type.Array(Type.String())),
            decisions: Type.Optional(Type.Array(Type.String())),
            followUps: Type.Optional(Type.Array(Type.String())),
            memoryCandidates: Type.Optional(Type.Array(Type.String())),
            evidence: Type.Optional(Type.Array(Type.String()))
          });
        case "Skill":
          return Type.Object({
            name: Type.String(),
            args: Type.Optional(Type.String())
          });
        default:
          return Type.Object({});
      }
    };
    textContent = (message) => message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    toolResultText = (result) => {
      if (typeof result === "object" && result !== null && "content" in result) {
        const content = result.content;
        if (Array.isArray(content)) {
          return content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
        }
      }
      return JSON.stringify(result);
    };
    stringMeta = (message, key) => {
      const value = message.meta?.[key];
      return typeof value === "string" ? value : void 0;
    };
    toPiStopReason = (reason) => {
      if (reason === "tool_call") {
        return "toolUse";
      }
      if (reason === "max_tokens") {
        return "length";
      }
      if (reason === "cancelled") {
        return "aborted";
      }
      if (reason === "error") {
        return "error";
      }
      return "stop";
    };
    fromPiStopReason = (reason) => {
      if (reason === "toolUse") {
        return "tool_call";
      }
      if (reason === "length") {
        return "max_tokens";
      }
      if (reason === "aborted") {
        return "cancelled";
      }
      if (reason === "error") {
        return "error";
      }
      return "end_turn";
    };
    fromPiUsage = (usage) => {
      if (!usage) {
        return void 0;
      }
      return {
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalTokens: usage.totalTokens
      };
    };
  }
});

// packages/core/src/runtime/index.ts
var ScorelRuntime, toolResultForContext, normalizeAssistantMessage, isAssistantMessage, partialAssistantMessage;
var init_runtime = __esm({
  "packages/core/src/runtime/index.ts"() {
    "use strict";
    ScorelRuntime = class {
      #provider;
      #tools = /* @__PURE__ */ new Map();
      #controller;
      constructor({ provider }) {
        this.#provider = provider;
      }
      get running() {
        return this.#controller !== void 0;
      }
      registerTool(tool) {
        this.#tools.set(tool.name, tool);
      }
      unregisterTool(name) {
        this.#tools.delete(name);
      }
      cancel() {
        this.#controller?.abort();
      }
      async *executeTurn(context, systemPrompt, options) {
        if (this.#controller) {
          throw new Error("Runtime is already running");
        }
        const controller = new AbortController();
        this.#controller = controller;
        yield { type: "turn_start" };
        try {
          let nextContext = [...context];
          while (!controller.signal.aborted) {
            const result = yield* this.#runProviderTurn(nextContext, systemPrompt, options, controller.signal);
            if (result.finished) {
              return;
            }
            const assistant = result.message;
            if (!assistant) {
              yield { type: "turn_end", stopReason: result.stopReason ?? "end_turn" };
              return;
            }
            const toolCalls = assistant.content.filter(
              (block) => block.type === "tool_call"
            );
            if (controller.signal.aborted || toolCalls.length === 0 || assistant.stopReason !== "tool_call") {
              yield { type: "turn_end", stopReason: controller.signal.aborted ? "cancelled" : assistant.stopReason };
              return;
            }
            const toolMessages = [];
            for (const toolCall of toolCalls) {
              if (controller.signal.aborted) {
                break;
              }
              toolMessages.push(yield* this.#executeTool(toolCall, controller.signal));
            }
            if (controller.signal.aborted) {
              yield { type: "turn_end", stopReason: "cancelled" };
              return;
            }
            const contextAfterTools = [...nextContext, assistant, ...toolMessages];
            nextContext = options.refreshContext ? await options.refreshContext(contextAfterTools) : contextAfterTools;
          }
          yield { type: "turn_end", stopReason: "cancelled" };
        } finally {
          this.#controller = void 0;
        }
      }
      async *#runProviderTurn(context, systemPrompt, options, signal) {
        let text = "";
        let thinking = "";
        yield { type: "message_start", role: "assistant" };
        try {
          const stream = this.#provider.streamTurn({
            context,
            systemPrompt,
            tools: [...this.#tools.values()],
            signal,
            options
          });
          while (true) {
            if (signal.aborted) {
              break;
            }
            const next = await stream.next();
            if (next.done) {
              const message = normalizeAssistantMessage(next.value, { thinking, text }, signal.aborted ? "cancelled" : "end_turn");
              if (message) {
                yield { type: "message_end", message };
              }
              return { message, stopReason: message?.stopReason ?? "end_turn" };
            }
            if (next.value.type === "text_delta") {
              text += next.value.delta;
              yield next.value;
            } else if (next.value.type === "thinking_delta") {
              thinking += next.value.delta;
              yield next.value;
            }
          }
          const cancelledMessage = partialAssistantMessage({ thinking, text }, "cancelled");
          if (cancelledMessage) {
            yield { type: "message_end", message: cancelledMessage };
          }
          return { stopReason: "cancelled" };
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          const partial = partialAssistantMessage({ thinking, text }, "error");
          if (partial) {
            yield { type: "message_end", message: partial };
          }
          yield { type: "error", error };
          yield { type: "turn_end", stopReason: "error" };
          return { finished: true };
        }
      }
      async *#executeTool(toolCall, signal) {
        const start = Date.now();
        const tool = this.#tools.get(toolCall.toolName);
        yield {
          type: "tool_execution_start",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: toolCall.args
        };
        let result;
        let isError = false;
        try {
          if (!tool) {
            throw new Error(`Unknown tool: ${toolCall.toolName}`);
          }
          result = await tool.execute(toolCall.toolCallId, toolCall.args, signal, () => void 0);
        } catch (cause) {
          isError = true;
          const message = cause instanceof Error ? cause.message : String(cause);
          result = { content: [{ type: "text", text: message }] };
        }
        yield {
          type: "tool_execution_end",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          durationMs: Date.now() - start,
          isError,
          result
        };
        const block = {
          type: "tool_result",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          result: toolResultForContext(result),
          isError
        };
        return {
          role: "tool_result",
          content: [block]
        };
      }
    };
    toolResultForContext = (result) => ({
      content: result.content
    });
    normalizeAssistantMessage = (value, streamed, fallbackStopReason) => {
      if (value) {
        if (!isAssistantMessage(value)) {
          throw new Error(`Provider returned ${value.role} message instead of assistant`);
        }
        return value;
      }
      return partialAssistantMessage(streamed, fallbackStopReason);
    };
    isAssistantMessage = (message) => message.role === "assistant";
    partialAssistantMessage = (streamed, stopReason) => {
      if (streamed.thinking.length === 0 && streamed.text.length === 0) {
        return void 0;
      }
      return {
        role: "assistant",
        content: [
          ...streamed.thinking ? [{ type: "thinking", text: streamed.thinking }] : [],
          ...streamed.text ? [{ type: "text", text: streamed.text }] : []
        ],
        stopReason,
        meta: stopReason === "end_turn" ? void 0 : { partial: true }
      };
    };
  }
});

// packages/core/src/session/index.ts
import { appendFile as appendFile2, mkdir as mkdir4, readFile as readFile8, writeFile as writeFile4 } from "node:fs/promises";
import { dirname as dirname6, join as join7 } from "node:path";
function assertTreeEvent(value) {
  if (!isRecord7(value)) {
    throw new SessionStoreError("invalid_event", "Event must be an object");
  }
  if (value.type === "session_header") {
    throw new SessionStoreError("invalid_event", "Session header must be stored as the JSONL header line");
  }
  if (value.type !== "user_message" && value.type !== "assistant_message" && value.type !== "tool_result" && value.type !== "session_title_updated" && value.type !== "instruction_snapshot" && value.type !== "harness_item" && value.type !== "compact" && value.type !== "queue_update" && value.type !== "skill_index_snapshot" && value.type !== "skill_index_delta") {
    throw new SessionStoreError("invalid_event", "Unsupported session event type");
  }
  if (typeof value.id !== "string" || value.parentId !== null && typeof value.parentId !== "string" || typeof value.seq !== "number" || typeof value.clientId !== "string" || typeof value.ts !== "number") {
    throw new SessionStoreError("invalid_event", "Event is missing required base fields");
  }
  if ((value.type === "user_message" || value.type === "assistant_message" || value.type === "tool_result") && !isRecord7(value.message)) {
    throw new SessionStoreError("invalid_event", "Message event is missing message payload");
  }
  if (value.type === "session_title_updated" && !isSessionTitleUpdated(value)) {
    throw new SessionStoreError("invalid_event", "session_title_updated is missing title payload");
  }
  if (value.type === "instruction_snapshot" && !isInstructionSnapshot(value.snapshot)) {
    throw new SessionStoreError("invalid_event", "instruction_snapshot is missing snapshot payload");
  }
  if (value.type === "harness_item" && !isHarnessItem(value.item)) {
    throw new SessionStoreError("invalid_event", "harness_item is missing item payload");
  }
  if (value.type === "compact" && !isCompactEvent(value)) {
    throw new SessionStoreError("invalid_event", "compact is missing summary payload");
  }
  if (value.type === "queue_update" && !isQueueUpdate(value)) {
    throw new SessionStoreError("invalid_event", "queue_update is missing queue payload");
  }
  if (value.type === "skill_index_snapshot" && !isSkillIndexSnapshot(value)) {
    throw new SessionStoreError("invalid_event", "skill_index_snapshot is missing entries");
  }
  if (value.type === "skill_index_delta" && !isSkillIndexDelta(value)) {
    throw new SessionStoreError("invalid_event", "skill_index_delta is missing delta payload");
  }
}
var SessionStoreError, SessionTree, JsonlSession, sessionFilePath, sessionLogFilePath, createSession, loadSession, buildContext, retainedMessagesBeforeCompact, isRetainedContextStart, parseJsonLine, parseHeader, parseSessionEvent, validateSessionMatch, isConversationEvent, isInstructionSnapshot, isHarnessItem, isCompactEvent, isQueueUpdate, isSessionTitleUpdated, isSkillIndexSnapshot, isSkillIndexDelta, isSkillIndexEntry, appendHarnessItemToContext, appendReminderToToolResult, isToolResultWithContent, renderSystemReminder, compactSummaryMessage, cloneMessage, isRecord7;
var init_session = __esm({
  "packages/core/src/session/index.ts"() {
    "use strict";
    init_src();
    SessionStoreError = class extends Error {
      code;
      line;
      constructor(code, message, options) {
        super(message);
        this.name = "SessionStoreError";
        this.code = code;
        this.line = options?.line;
      }
    };
    SessionTree = class {
      #nodes = /* @__PURE__ */ new Map();
      #events = /* @__PURE__ */ new Map();
      #order = [];
      #conversationOrder = [];
      #rootId = null;
      #currentSeq = asSeq(0);
      controlState = {
        queues: {
          follow_up: [],
          steer: []
        },
        skillIndexInitialized: false,
        skillIndex: {}
      };
      get rootId() {
        return this.#rootId;
      }
      get size() {
        return this.#events.size;
      }
      get currentSeq() {
        return this.#currentSeq;
      }
      get(id) {
        const node = this.#nodes.get(id);
        if (!node) {
          return void 0;
        }
        return {
          event: node.event,
          children: [...node.children]
        };
      }
      has(id) {
        return this.#events.has(id);
      }
      append(event) {
        this.assertCanAppend(event);
        this.#events.set(event.id, event);
        this.#order.push(event.id);
        this.#currentSeq = event.seq;
        this.#applyControlEvent(event);
        if (!isConversationEvent(event)) {
          return;
        }
        if (event.parentId !== null) {
          this.#nodes.get(event.parentId)?.children.push(event.id);
        } else {
          this.#rootId = event.id;
        }
        this.#nodes.set(event.id, { event, children: [] });
        this.#conversationOrder.push(event.id);
      }
      assertCanAppend(event) {
        assertTreeEvent(event);
        if (this.#events.has(event.id)) {
          throw new SessionStoreError("duplicate_event_id", `Duplicate event id: ${event.id}`);
        }
        if (Number(event.seq) <= Number(this.#currentSeq)) {
          throw new SessionStoreError(
            "non_monotonic_seq",
            `Event seq ${String(event.seq)} must be greater than ${String(this.#currentSeq)}`
          );
        }
        if (!isConversationEvent(event)) {
          return;
        }
        if (event.parentId === null) {
          if (this.#rootId !== null) {
            throw new SessionStoreError("invalid_parent", "Only the first event can have a null parentId");
          }
        } else {
          const parent = this.#nodes.get(event.parentId);
          if (!parent) {
            throw new SessionStoreError("invalid_parent", `Missing parent event: ${event.parentId}`);
          }
        }
      }
      getLeaves() {
        return this.#conversationOrder.filter((id) => this.#nodes.get(id)?.children.length === 0);
      }
      getChildren(id) {
        return [...this.#nodes.get(id)?.children ?? []];
      }
      getPath(id) {
        if (!this.#nodes.has(id)) {
          throw new SessionStoreError("invalid_parent", `Unknown event id: ${id}`);
        }
        const path = [];
        let current = id;
        while (current !== null) {
          const node = this.#nodes.get(current);
          if (!node) {
            throw new SessionStoreError("invalid_parent", `Broken path at event id: ${current}`);
          }
          path.push(current);
          current = node.event.parentId;
        }
        return path.reverse();
      }
      getBranchPoints() {
        return this.#conversationOrder.filter((id) => (this.#nodes.get(id)?.children.length ?? 0) > 1);
      }
      *[Symbol.iterator]() {
        for (const id of this.#order) {
          const event = this.#events.get(id);
          if (event) {
            yield event;
          }
        }
      }
      #applyControlEvent(event) {
        if (event.type === "instruction_snapshot") {
          this.controlState.instructionSnapshot = event.snapshot;
        } else if (event.type === "queue_update") {
          this.controlState.queues[event.queue] = [...event.items];
        } else if (event.type === "skill_index_snapshot") {
          this.controlState.skillIndexInitialized = true;
          this.controlState.skillIndex = Object.fromEntries(event.entries.map((entry) => [entry.name, entry]));
        } else if (event.type === "skill_index_delta") {
          this.controlState.skillIndexInitialized = true;
          const next = { ...this.controlState.skillIndex };
          for (const entry of event.added) {
            next[entry.name] = entry;
          }
          for (const entry of event.changed) {
            next[entry.name] = entry;
          }
          for (const removed of event.removed) {
            delete next[removed.name];
          }
          this.controlState.skillIndex = next;
        }
      }
    };
    JsonlSession = class {
      filePath;
      header;
      tree;
      constructor(filePath, header, tree = new SessionTree()) {
        this.filePath = filePath;
        this.header = header;
        this.tree = tree;
      }
      get activeLeafId() {
        const leaves = this.tree.getLeaves();
        return leaves.at(-1) ?? null;
      }
      get currentSeq() {
        return this.tree.currentSeq;
      }
      async append(event) {
        validateSessionMatch(this.header, event);
        this.tree.assertCanAppend(event);
        await appendFile2(this.filePath, `${JSON.stringify(event)}
`, "utf8");
        this.tree.append(event);
        return event;
      }
      async close() {
        return Promise.resolve();
      }
    };
    sessionFilePath = (sessionsDir, sessionId) => join7(sessionsDir, `${sessionId}.jsonl`);
    sessionLogFilePath = (sessionsDir, sessionId) => join7(sessionsDir, `${sessionId}.log`);
    createSession = async ({ sessionsDir, header }) => {
      const validHeader = parseHeader(header);
      await mkdir4(sessionsDir, { recursive: true });
      const filePath = sessionFilePath(sessionsDir, validHeader.sessionId);
      await writeFile4(filePath, `${JSON.stringify(validHeader)}
`, { encoding: "utf8", flag: "wx" });
      return new JsonlSession(filePath, validHeader);
    };
    loadSession = async (options) => {
      const filePath = options.filePath !== void 0 ? options.filePath : sessionFilePath(options.sessionsDir, options.sessionId);
      const content = await readFile8(filePath, "utf8");
      const lines = content.split(/\r?\n/);
      const headerLine = lines[0];
      if (!headerLine) {
        throw new SessionStoreError("missing_header", "Session file is missing a header");
      }
      const parsedLines = lines.map((line, index) => ({ line, lineNumber: index + 1 })).filter(({ line }) => line.length > 0).map(({ line, lineNumber }) => parseJsonLine(line, lineNumber));
      const header = parseHeader(parsedLines[0]);
      const tree = new SessionTree();
      for (const event of parsedLines.slice(1)) {
        tree.append(parseSessionEvent(header, event));
      }
      await mkdir4(dirname6(filePath), { recursive: true });
      return new JsonlSession(filePath, header, tree);
    };
    buildContext = (tree, leafId) => {
      const path = tree.getPath(leafId);
      return path.reduce((messages, id, index) => {
        const event = tree.get(id)?.event;
        if (!event) {
          return messages;
        }
        if ("message" in event) {
          messages.push(cloneMessage(event.message));
          return messages;
        }
        if (event.type === "harness_item") {
          appendHarnessItemToContext(messages, event);
        }
        if (event.type === "compact") {
          const retained = retainedMessagesBeforeCompact(tree, path.slice(0, index), event.retainedEventCount);
          messages.length = 0;
          messages.push(compactSummaryMessage(event));
          messages.push(...retained);
        }
        return messages;
      }, []);
    };
    retainedMessagesBeforeCompact = (tree, pathBeforeCompact, retainedEventCount) => {
      if (retainedEventCount <= 0) {
        return [];
      }
      const candidateStart = Math.max(0, pathBeforeCompact.length - retainedEventCount);
      let start = pathBeforeCompact.length;
      for (let index = candidateStart; index < pathBeforeCompact.length; index += 1) {
        const event = tree.get(pathBeforeCompact[index])?.event;
        if (isRetainedContextStart(event)) {
          start = index;
          break;
        }
      }
      const retained = [];
      for (const id of pathBeforeCompact.slice(start)) {
        const event = tree.get(id)?.event;
        if (!event) {
          continue;
        }
        if ("message" in event) {
          retained.push(cloneMessage(event.message));
        } else if (event.type === "harness_item") {
          appendHarnessItemToContext(retained, event);
        } else if (event.type === "compact") {
          retained.length = 0;
          retained.push(compactSummaryMessage(event));
        }
      }
      return retained;
    };
    isRetainedContextStart = (event) => event?.type === "user_message" || event?.type === "compact" || event?.type === "assistant_message" && event.message.content.some((block) => block.type === "tool_call");
    parseJsonLine = (line, lineNumber) => {
      try {
        return JSON.parse(line);
      } catch (cause) {
        throw new SessionStoreError("invalid_json", `Invalid JSON at line ${lineNumber}`, { line: lineNumber });
      }
    };
    parseHeader = (value) => {
      if (!isRecord7(value)) {
        throw new SessionStoreError("invalid_header", "Session header must be an object");
      }
      if (value.version !== 1 || typeof value.sessionId !== "string" || typeof value.deviceId !== "string") {
        throw new SessionStoreError("invalid_header", "Session header is missing required identity fields");
      }
      if (typeof value.createdAt !== "number" || !isRecord7(value.meta)) {
        throw new SessionStoreError("invalid_header", "Session header is missing createdAt or meta");
      }
      if (typeof value.meta.projectId !== "string" || value.meta.projectId.length === 0) {
        throw new SessionStoreError("invalid_header", "Session header is missing meta.projectId");
      }
      return value;
    };
    parseSessionEvent = (header, value) => {
      validateSessionMatch(header, value);
      assertTreeEvent(value);
      return value;
    };
    validateSessionMatch = (header, value) => {
      if (!isRecord7(value) || typeof value.sessionId !== "string") {
        throw new SessionStoreError("invalid_header", "Event must be an object with a sessionId");
      }
      if (value.sessionId !== header.sessionId) {
        throw new SessionStoreError("session_mismatch", `Event belongs to ${value.sessionId}, expected ${header.sessionId}`);
      }
    };
    isConversationEvent = (event) => event.type === "user_message" || event.type === "assistant_message" || event.type === "tool_result" || event.type === "harness_item" || event.type === "compact";
    isInstructionSnapshot = (value) => {
      if (!isRecord7(value) || value.version !== 1 || typeof value.cwd !== "string" || !Array.isArray(value.sections)) {
        return false;
      }
      return value.sections.every(
        (section2) => isRecord7(section2) && typeof section2.kind === "string" && typeof section2.frozenAt === "number" && typeof section2.renderedBlock === "string"
      );
    };
    isHarnessItem = (value) => isRecord7(value) && typeof value.kind === "string" && typeof value.origin === "string" && typeof value.content === "string" && (value.visibility === "display" || value.visibility === "hidden" || value.visibility === "compact");
    isCompactEvent = (value) => typeof value.summary === "string" && typeof value.compactedThrough === "string" && typeof value.tokensBefore === "number" && typeof value.tokensAfter === "number" && typeof value.retainedEventCount === "number";
    isQueueUpdate = (value) => (value.queue === "follow_up" || value.queue === "steer") && value.operation === "rewrite" && Array.isArray(value.items) && (value.anchorEventId === null || typeof value.anchorEventId === "string") && value.items.every(
      (item) => isRecord7(item) && typeof item.id === "string" && Array.isArray(item.content) && typeof item.createdAt === "number" && typeof item.updatedAt === "number" && typeof item.clientId === "string"
    );
    isSessionTitleUpdated = (value) => typeof value.title === "string" && value.title.length > 0 && (value.source === "model" || value.source === "user") && (value.derivedFrom === void 0 || isRecord7(value.derivedFrom) && typeof value.derivedFrom.eventId === "string" && typeof value.derivedFrom.seq === "number");
    isSkillIndexSnapshot = (value) => (value.anchorEventId === null || typeof value.anchorEventId === "string") && Array.isArray(value.entries) && value.entries.every(isSkillIndexEntry);
    isSkillIndexDelta = (value) => (value.anchorEventId === null || typeof value.anchorEventId === "string") && Array.isArray(value.added) && Array.isArray(value.changed) && Array.isArray(value.removed) && value.added.every(isSkillIndexEntry) && value.changed.every(isSkillIndexEntry) && value.removed.every(
      (item) => isRecord7(item) && typeof item.name === "string" && typeof item.previousPath === "string"
    );
    isSkillIndexEntry = (value) => isRecord7(value) && typeof value.name === "string" && typeof value.path === "string" && (value.scope === "user" || value.scope === "project" || value.scope === "extension") && typeof value.description === "string" && typeof value.mtimeMs === "number" && typeof value.size === "number" && typeof value.contentHash === "string" && typeof value.priority === "number";
    appendHarnessItemToContext = (messages, event) => {
      const reminder = renderSystemReminder(event.item.content);
      const last = messages.at(-1);
      if (last?.role === "tool_result" && appendReminderToToolResult(last, reminder)) {
        return;
      }
      messages.push({
        role: "user",
        content: [{ type: "text", text: reminder }],
        meta: {
          source: "harness_item",
          harnessKind: event.item.kind,
          harnessOrigin: event.item.origin
        }
      });
    };
    appendReminderToToolResult = (message, reminder) => {
      for (let i = message.content.length - 1; i >= 0; i -= 1) {
        const block = message.content[i];
        if (block?.type !== "tool_result" || !isToolResultWithContent(block.result)) {
          continue;
        }
        const mergedResult = {
          ...block.result,
          content: [...block.result.content, { type: "text", text: `

${reminder}` }]
        };
        message.content[i] = {
          ...block,
          result: mergedResult
        };
        return true;
      }
      return false;
    };
    isToolResultWithContent = (value) => isRecord7(value) && Array.isArray(value.content);
    renderSystemReminder = (content) => `<system-reminder>
${content}
</system-reminder>`;
    compactSummaryMessage = (event) => ({
      role: "user",
      content: [{
        type: "text",
        text: renderSystemReminder([
          "Earlier session context has been compacted.",
          "",
          event.summary.trim(),
          "",
          "Use this summary as continuity context. Verify current repository facts before acting."
        ].join("\n"))
      }],
      meta: {
        source: "compact",
        compactedThrough: event.compactedThrough
      }
    });
    cloneMessage = (message) => ({
      ...message,
      content: message.content.map((block) => {
        if (block.type !== "tool_result" || !isRecord7(block.result)) {
          return { ...block };
        }
        const content = Array.isArray(block.result.content) ? { content: block.result.content.map((item) => isRecord7(item) ? { ...item } : item) } : {};
        return {
          ...block,
          result: {
            content: content.content ?? []
          }
        };
      }),
      ...message.meta ? { meta: { ...message.meta } } : {}
    });
    isRecord7 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  }
});

// packages/core/src/skills/index.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync2 } from "node:fs";
import { readdir as readdir5, readFile as readFile9, stat as stat4 } from "node:fs/promises";
import { homedir as homedir4 } from "node:os";
import { dirname as dirname7, join as join8, resolve as resolve4 } from "node:path";
var scanSkillIndex, diffSkillIndex, hasSkillIndexDelta, renderSkillListing, renderSkillDelta, createSkillTool, projectSkillRoots, readSkillEntry, parseSkillMetadata, firstParagraph, parseSkillArgs, findGitRoot2, isNodeErrorCode3;
var init_skills = __esm({
  "packages/core/src/skills/index.ts"() {
    "use strict";
    init_tools();
    scanSkillIndex = async (options) => {
      const cwd = resolve4(options.cwd);
      const homeDir = resolve4(options.homeDir ?? homedir4());
      const roots = [
        ...projectSkillRoots(cwd, homeDir),
        { path: join8(homeDir, ".scorel", "skills"), scope: "user", priority: 0 },
        ...(options.extensionSkillRoots ?? []).map((root, index) => ({
          path: root.path,
          scope: "extension",
          priority: -100 - index
        }))
      ];
      const byName = /* @__PURE__ */ new Map();
      for (const root of roots) {
        let children;
        try {
          children = await readdir5(root.path);
        } catch (cause) {
          if (isNodeErrorCode3(cause, "ENOENT") || isNodeErrorCode3(cause, "ENOTDIR")) {
            continue;
          }
          throw cause;
        }
        for (const child of children.sort()) {
          const entry = await readSkillEntry({
            name: child,
            skillPath: join8(root.path, child, "SKILL.md"),
            scope: root.scope,
            priority: root.priority
          });
          if (!entry || byName.has(entry.name)) {
            continue;
          }
          byName.set(entry.name, entry);
        }
      }
      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    };
    diffSkillIndex = (previous, nextEntries) => {
      const next = Object.fromEntries(nextEntries.map((entry) => [entry.name, entry]));
      const added = [];
      const changed = [];
      const removed = [];
      for (const entry of nextEntries) {
        const old = previous[entry.name];
        if (!old) {
          added.push(entry);
        } else if (old.path !== entry.path || old.contentHash !== entry.contentHash || old.mtimeMs !== entry.mtimeMs || old.size !== entry.size) {
          changed.push(entry);
        }
      }
      for (const old of Object.values(previous)) {
        if (!next[old.name]) {
          removed.push({ name: old.name, previousPath: old.path });
        }
      }
      return { added, changed, removed };
    };
    hasSkillIndexDelta = (delta) => delta.added.length > 0 || delta.changed.length > 0 || delta.removed.length > 0;
    renderSkillListing = (entries) => {
      if (entries.length === 0) {
        return "No skills are currently available for the Skill tool.";
      }
      return [
        "The following skills are available for use with the Skill tool:",
        "",
        ...entries.map((entry) => `- ${entry.name}: ${entry.description}`)
      ].join("\n");
    };
    renderSkillDelta = (delta) => {
      const lines = ["Skill updates detected:"];
      if (delta.added.length > 0) {
        lines.push("", "Added:", ...delta.added.map((entry) => `- ${entry.name}: ${entry.description}`));
      }
      if (delta.changed.length > 0) {
        lines.push("", "Changed:", ...delta.changed.map((entry) => `- ${entry.name}: ${entry.description}`));
      }
      if (delta.removed.length > 0) {
        lines.push("", "Removed:", ...delta.removed.map((entry) => `- ${entry.name}`));
      }
      return lines.join("\n");
    };
    createSkillTool = (options) => defineTool({
      name: "Skill",
      description: "Load the full SKILL.md instructions for an available session-indexed skill by name.",
      execute: async (_toolCallId, args) => {
        const input = parseSkillArgs(args);
        const entry = options.getEntry(input.name);
        if (!entry) {
          throw new Error(`Unknown skill: ${input.name}. Available skills: ${options.listNames().join(", ") || "none"}`);
        }
        const content = await readFile9(entry.path, "utf8");
        return {
          content: [{ type: "text", text: content }],
          details: {
            skill: {
              name: entry.name,
              path: entry.path,
              scope: entry.scope,
              args: input.args
            }
          }
        };
      }
    });
    projectSkillRoots = (cwd, homeDir) => {
      const roots = [];
      const gitRoot = findGitRoot2(cwd);
      const stopAt = gitRoot ?? homeDir;
      let current = cwd;
      while (true) {
        if (current !== homeDir) {
          roots.push(join8(current, ".scorel", "skills"));
        }
        if (current === stopAt || current === dirname7(current)) {
          break;
        }
        const next = dirname7(current);
        if (!gitRoot && next === homeDir) {
          break;
        }
        current = next;
      }
      return roots.map((path, index) => ({ path, scope: "project", priority: 100 + index }));
    };
    readSkillEntry = async (options) => {
      let fileStat;
      let content;
      try {
        [fileStat, content] = await Promise.all([stat4(options.skillPath), readFile9(options.skillPath, "utf8")]);
      } catch (cause) {
        if (isNodeErrorCode3(cause, "ENOENT") || isNodeErrorCode3(cause, "ENOTDIR")) {
          return void 0;
        }
        throw cause;
      }
      const parsed = parseSkillMetadata(content);
      const description = parsed.description ?? firstParagraph(content);
      if (!description) {
        return void 0;
      }
      return {
        name: options.name,
        path: options.skillPath,
        scope: options.scope,
        description,
        ...parsed.displayName ? { displayName: parsed.displayName } : {},
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        contentHash: createHash2("sha256").update(content).digest("hex"),
        priority: options.priority
      };
    };
    parseSkillMetadata = (content) => {
      if (!content.startsWith("---\n")) {
        return {};
      }
      const end = content.indexOf("\n---", 4);
      if (end < 0) {
        return {};
      }
      const frontmatter = content.slice(4, end).split(/\r?\n/);
      const metadata = {};
      for (const line of frontmatter) {
        const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
        if (!match) {
          continue;
        }
        const value = match[2]?.replace(/^["']|["']$/g, "").trim();
        if (!value) {
          continue;
        }
        if (match[1] === "name") {
          metadata.displayName = value;
        } else if (match[1] === "description") {
          metadata.description = value;
        }
      }
      return metadata;
    };
    firstParagraph = (content) => {
      const frontmatterEnd = content.startsWith("---\n") ? content.indexOf("\n---", 4) : -1;
      const body = frontmatterEnd >= 0 ? content.slice(frontmatterEnd + 4) : content;
      return body.split(/\n\s*\n/).map((part) => part.trim().replace(/^#\s+.+\n?/, "").trim()).find((part) => part.length > 0);
    };
    parseSkillArgs = (args) => {
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        throw new Error("Skill args must be an object");
      }
      const input = args;
      if (typeof input.name !== "string" || input.name.length === 0) {
        throw new Error("Skill name must be a non-empty string");
      }
      return {
        name: input.name,
        ...typeof input.args === "string" ? { args: input.args } : {}
      };
    };
    findGitRoot2 = (cwd) => {
      let current = cwd;
      while (true) {
        if (existsSync2(join8(current, ".git"))) {
          return current;
        }
        const next = dirname7(current);
        if (next === current) {
          return void 0;
        }
        current = next;
      }
    };
    isNodeErrorCode3 = (cause, code) => cause instanceof Error && "code" in cause && cause.code === code;
  }
});

// packages/core/src/index.ts
var init_src3 = __esm({
  "packages/core/src/index.ts"() {
    "use strict";
    init_src();
    init_config();
    init_channel();
    init_extensions();
    init_instructions();
    init_memory();
    init_pi_ai();
    init_runtime();
    init_session();
    init_skills();
    init_tools();
  }
});

// packages/daemon/src/relay/auth.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { mkdir as mkdir5, readFile as readFile10, writeFile as writeFile5 } from "node:fs/promises";
import { join as join9 } from "node:path";
var hostDeviceIdentityPath, hostRelayAuthPath, loadOrCreateHostDeviceIdentity, readHostDeviceIdentity, readHostRelayAuth, authorizeRelayClient, isRelayClientAuthorized, emptyAuthFile;
var init_auth = __esm({
  "packages/daemon/src/relay/auth.ts"() {
    "use strict";
    init_src();
    hostDeviceIdentityPath = (stateDir) => join9(stateDir, "device.json");
    hostRelayAuthPath = (stateDir) => join9(stateDir, "relay-auth.json");
    loadOrCreateHostDeviceIdentity = async (options) => {
      const existing = await readHostDeviceIdentity(options.stateDir);
      if (existing) {
        return existing;
      }
      const identity = {
        version: 1,
        deviceId: asDeviceId(`device_${randomUUID3()}`),
        displayName: options.displayName ?? "Local daemon"
      };
      await mkdir5(options.stateDir, { recursive: true });
      await writeFile5(hostDeviceIdentityPath(options.stateDir), `${JSON.stringify(identity, null, 2)}
`);
      return identity;
    };
    readHostDeviceIdentity = async (stateDir) => {
      try {
        const raw = JSON.parse(await readFile10(hostDeviceIdentityPath(stateDir), "utf8"));
        if (raw.version !== 1 || typeof raw.deviceId !== "string" || typeof raw.displayName !== "string") {
          return null;
        }
        return {
          version: 1,
          deviceId: asDeviceId(raw.deviceId),
          displayName: raw.displayName
        };
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return null;
        }
        throw cause;
      }
    };
    readHostRelayAuth = async (stateDir) => {
      try {
        const raw = JSON.parse(await readFile10(hostRelayAuthPath(stateDir), "utf8"));
        if (raw.version !== 1 || !Array.isArray(raw.clients)) {
          return emptyAuthFile();
        }
        return {
          version: 1,
          clients: raw.clients.filter((client) => typeof client.clientId === "string" && typeof client.createdAt === "number")
        };
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return emptyAuthFile();
        }
        throw cause;
      }
    };
    authorizeRelayClient = async (options) => {
      const auth = await readHostRelayAuth(options.stateDir);
      const existing = auth.clients.find((client) => client.clientId === options.clientId);
      if (existing) {
        return auth;
      }
      auth.clients.push({
        clientId: options.clientId,
        createdAt: (options.now ?? Date.now)(),
        label: options.label
      });
      await mkdir5(options.stateDir, { recursive: true });
      await writeFile5(hostRelayAuthPath(options.stateDir), `${JSON.stringify(auth, null, 2)}
`);
      return auth;
    };
    isRelayClientAuthorized = async (options) => {
      const auth = await readHostRelayAuth(options.stateDir);
      return auth.clients.some((client) => client.clientId === options.clientId);
    };
    emptyAuthFile = () => ({
      version: 1,
      clients: []
    });
  }
});

// packages/daemon/src/relay/pair.ts
import WebSocket2 from "ws";
var redeemRelayPair, waitForOpen, waitForRelayResponse;
var init_pair = __esm({
  "packages/daemon/src/relay/pair.ts"() {
    "use strict";
    init_src();
    init_auth();
    redeemRelayPair = async (options) => {
      const socket = options.createWebSocket?.(options.relayUrl) ?? new WebSocket2(options.relayUrl);
      try {
        await waitForOpen(socket);
        socket.send(JSON.stringify({
          type: "host_hello",
          deviceId: options.deviceId,
          label: options.label
        }));
        socket.send(JSON.stringify({
          type: "redeem_pair",
          requestId: asRequestId("relay_pair"),
          pairCode: options.pairCode,
          deviceId: options.deviceId
        }));
        const response = await waitForRelayResponse(socket);
        if (!response.ok) {
          throw new Error(`${response.code}: ${response.message}`);
        }
        if (!("clientId" in response.data)) {
          throw new Error("relay pair response missing clientId");
        }
        await authorizeRelayClient({
          stateDir: options.stateDir,
          clientId: response.data.clientId
        });
        return { clientId: response.data.clientId };
      } finally {
        socket.close();
      }
    };
    waitForOpen = (socket) => new Promise((resolve7, reject) => {
      socket.once("open", () => resolve7());
      socket.once("error", reject);
    });
    waitForRelayResponse = (socket) => new Promise((resolve7, reject) => {
      socket.once("error", reject);
      socket.on("message", function handle(data) {
        const frame = JSON.parse(data.toString());
        if (frame.type !== "relay_response" && frame.type !== "relay_error") {
          return;
        }
        socket.off("message", handle);
        resolve7(frame);
      });
    });
  }
});

// packages/daemon/src/relay/host-client.ts
import WebSocket3 from "ws";
var startHostRelayClient, ReconnectingHostRelayClient, handleRelayFrame, connectionFor, relayAuthError, sendHostFrame, waitForOpen2;
var init_host_client = __esm({
  "packages/daemon/src/relay/host-client.ts"() {
    "use strict";
    init_src();
    init_auth();
    startHostRelayClient = async (options) => {
      const client = new ReconnectingHostRelayClient(options);
      await client.start();
      return client;
    };
    ReconnectingHostRelayClient = class {
      #options;
      #socket;
      #connections = /* @__PURE__ */ new Map();
      #closed = false;
      #reconnectTimer;
      constructor(options) {
        this.#options = options;
      }
      async start() {
        await this.#connect();
      }
      close() {
        this.#closed = true;
        if (this.#reconnectTimer) {
          clearTimeout(this.#reconnectTimer);
          this.#reconnectTimer = void 0;
        }
        this.#disconnectHostConnections();
        this.#socket?.close();
      }
      async #connect() {
        if (this.#closed) {
          return;
        }
        const socket = this.#options.createWebSocket?.(this.#options.relayUrl) ?? new WebSocket3(this.#options.relayUrl);
        this.#socket = socket;
        await waitForOpen2(socket);
        if (this.#closed) {
          socket.close();
          return;
        }
        sendHostFrame(socket, {
          type: "host_hello",
          deviceId: this.#options.deviceId,
          label: this.#options.deviceDisplayName
        });
        this.#options.onDiagnostic?.("relay_host_connected", { relayUrl: this.#options.relayUrl, deviceId: this.#options.deviceId });
        socket.on("message", (data) => {
          void handleRelayFrame({
            frame: JSON.parse(data.toString()),
            socket,
            connections: this.#connections,
            options: this.#options
          }).catch((cause) => {
            this.#options.onDiagnostic?.("relay_host_error", {
              error: cause instanceof Error ? cause.message : String(cause)
            });
          });
        });
        socket.on("error", (cause) => {
          this.#options.onDiagnostic?.("relay_host_error", {
            error: cause instanceof Error ? cause.message : String(cause)
          });
        });
        socket.once("close", () => {
          if (this.#socket === socket) {
            this.#socket = void 0;
          }
          this.#disconnectHostConnections();
          this.#options.onDiagnostic?.("relay_host_disconnected", { relayUrl: this.#options.relayUrl, deviceId: this.#options.deviceId });
          this.#scheduleReconnect();
        });
      }
      #disconnectHostConnections() {
        for (const connection of this.#connections.values()) {
          this.#options.hostService.disconnect(connection);
        }
        this.#connections.clear();
      }
      #scheduleReconnect() {
        if (this.#closed || this.#reconnectTimer) {
          return;
        }
        const delayMs = this.#options.reconnectDelayMs ?? 1e3;
        this.#options.onDiagnostic?.("relay_host_reconnecting", {
          relayUrl: this.#options.relayUrl,
          deviceId: this.#options.deviceId,
          delayMs
        });
        this.#reconnectTimer = setTimeout(() => {
          this.#reconnectTimer = void 0;
          void this.#connect().catch((cause) => {
            this.#options.onDiagnostic?.("relay_host_error", {
              error: cause instanceof Error ? cause.message : String(cause)
            });
            this.#scheduleReconnect();
          });
        }, delayMs);
      }
    };
    handleRelayFrame = async (input) => {
      if (input.frame.type !== "relay_to_host") {
        return;
      }
      const authorized = input.options.isAuthorized ? await input.options.isAuthorized(input.frame.clientId) : await isRelayClientAuthorized({ stateDir: input.options.stateDir, clientId: input.frame.clientId });
      if (!authorized) {
        sendHostFrame(input.socket, {
          type: "host_to_entry",
          clientId: input.frame.clientId,
          payload: relayAuthError(input.frame.payload)
        });
        input.options.onDiagnostic?.("relay_frame_rejected", {
          clientId: input.frame.clientId,
          reason: "unauthorized",
          payloadType: input.frame.payload.type
        });
        return;
      }
      const connection = connectionFor(input.connections, input.frame.clientId, input.socket);
      if (input.frame.payload.type === "connect") {
        const result = input.options.hostService.connect(connection, input.frame.payload.sessionId);
        sendHostFrame(input.socket, {
          type: "host_to_entry",
          clientId: input.frame.clientId,
          payload: {
            type: "connected",
            clientId: input.frame.clientId,
            sessionId: result.sessionId,
            currentSeq: result.currentSeq ?? asSeq(0),
            deviceId: result.deviceId,
            deviceDisplayName: result.deviceDisplayName
          }
        });
        return;
      }
      await input.options.hostService.handleMessage(connection, input.frame.payload);
    };
    connectionFor = (connections, clientId, socket) => {
      const existing = connections.get(clientId);
      if (existing) {
        return existing;
      }
      const connection = {
        clientId,
        emit(message) {
          sendHostFrame(socket, {
            type: "host_to_entry",
            clientId,
            payload: message
          });
        }
      };
      connections.set(clientId, connection);
      return connection;
    };
    relayAuthError = (payload) => ({
      type: "error",
      requestId: "requestId" in payload ? payload.requestId : void 0,
      ok: false,
      code: "auth_failed",
      message: "relay client is not authorized by host"
    });
    sendHostFrame = (socket, frame) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(frame));
      }
    };
    waitForOpen2 = (socket) => new Promise((resolve7, reject) => {
      socket.once("open", () => resolve7());
      socket.once("error", reject);
    });
  }
});

// packages/daemon/src/index.ts
import { execFile as execFile2 } from "node:child_process";
import { existsSync as existsSync3 } from "node:fs";
import { appendFile as appendFile3, mkdir as mkdir6, readFile as readFile11, readdir as readdir6, rename as rename3, rm as rm2, writeFile as writeFile6 } from "node:fs/promises";
import { userInfo as userInfo2 } from "node:os";
import { basename as basename3, dirname as dirname8, join as join10, resolve as resolve5 } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify as promisify2 } from "node:util";
import { WebSocketServer } from "ws";
var daemonPackageName, SESSION_MEMORY_COMPACT_WAIT_MS, AUTO_COMPACT_RETAINED_EVENTS, execFileAsync2, localDaemonStateFile, createLocalDaemonState, readLocalDaemonState, removeLocalDaemonState, markDaemonStopped, daemonStateLiveness, defaultIsPidAlive, startRemoteDaemonWebSocketServer, startScorelHostWebSocketServer, closeWebSocketServer, createRealRuntime, ScorelHost, isMissingConfigError, createEmbeddedTransport, isNodeErrorCode4, wireErrorCode, hasContinuousCoverage, countContentBlocks, normalizeContent, inputText, assistantText, messageText, estimateScorelMessagesTokens, estimateTextTokens, compactLine2, parseSessionMemoryJson, stringArray, disabledMemorySettings, detectRtk, ensureRtkAvailable, emptyRuntimeStats, readRuntimeStats, writeRuntimeStats, parseRuntimeStats, parseRuntimeStatsBuckets, addRtkSavings, addRuntimeStatsBucket, rtkSavingsFromToolResult, nonNegativeInteger2, resolveDefaultShell2, shellCommandArgs2, userShell2, runtimeChannelContextFromWire, parseQueuedChannelContext, imBindingKey, defaultBuiltinExtensionsDir, runtimeModuleDir, findBuiltinExtensionsDir, isSteerMessage, stripImCommandPrefix, isRecord8, parseMemoryUpdate, normalizeMarkdownFile2, sanitizeSessionTitle, shortStack, formatDiagnosticLine, formatDiagnosticValue;
var init_src4 = __esm({
  "packages/daemon/src/index.ts"() {
    "use strict";
    init_directories();
    init_registry();
    init_sessions();
    init_src3();
    init_src();
    init_auth();
    init_pair();
    init_host_client();
    daemonPackageName = "@scorel/daemon";
    SESSION_MEMORY_COMPACT_WAIT_MS = 5e3;
    AUTO_COMPACT_RETAINED_EVENTS = 8;
    execFileAsync2 = promisify2(execFile2);
    localDaemonStateFile = (stateDir) => join10(stateDir, "daemon.json");
    createLocalDaemonState = async (options) => {
      const state = {
        host: options.host,
        port: options.port,
        wsUrl: options.wsUrl,
        token: options.token,
        pid: options.pid,
        startedAt: options.startedAt,
        stoppedAt: options.stoppedAt
      };
      await mkdir6(options.stateDir, { recursive: true });
      await writeFile6(localDaemonStateFile(options.stateDir), `${JSON.stringify(state, null, 2)}
`);
      return state;
    };
    readLocalDaemonState = async (options) => {
      try {
        const raw = JSON.parse(await readFile11(localDaemonStateFile(options.stateDir), "utf8"));
        if (typeof raw.host !== "string" || typeof raw.port !== "number" || typeof raw.wsUrl !== "string" || typeof raw.token !== "string" || typeof raw.pid !== "number" || typeof raw.startedAt !== "number" || !(raw.stoppedAt === null || typeof raw.stoppedAt === "number")) {
          return null;
        }
        return {
          host: raw.host,
          port: raw.port,
          wsUrl: raw.wsUrl,
          token: raw.token,
          pid: raw.pid,
          startedAt: raw.startedAt,
          stoppedAt: raw.stoppedAt
        };
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return null;
        }
        throw cause;
      }
    };
    removeLocalDaemonState = async (options) => {
      await rm2(localDaemonStateFile(options.stateDir), { force: true });
    };
    markDaemonStopped = async (options) => {
      const state = await readLocalDaemonState({ stateDir: options.stateDir });
      if (!state) {
        return;
      }
      await writeFile6(
        localDaemonStateFile(options.stateDir),
        `${JSON.stringify({ ...state, stoppedAt: options.stoppedAt }, null, 2)}
`
      );
    };
    daemonStateLiveness = (state, options = {}) => {
      const isAlive = options.isPidAlive ?? defaultIsPidAlive;
      const alive = isAlive(state.pid);
      if (alive && state.stoppedAt === null) {
        return "running";
      }
      if (!alive && state.stoppedAt === null) {
        return "orphan";
      }
      return "stopped";
    };
    defaultIsPidAlive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "EPERM") {
          return true;
        }
        return false;
      }
    };
    startRemoteDaemonWebSocketServer = async (options) => {
      const server = new WebSocketServer({ host: options.host, port: options.port });
      server.on("connection", (socket) => {
        const connection = {
          socket,
          send(message) {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify(message));
            }
          }
        };
        socket.on("message", (data) => {
          let message;
          try {
            message = JSON.parse(data.toString());
          } catch {
            connection.send({
              type: "error",
              ok: false,
              code: "invalid_request",
              message: "invalid JSON message"
            });
            return;
          }
          if (message.type === "connect") {
            if (message.token !== options.token) {
              connection.send({
                type: "error",
                ok: false,
                code: "auth_failed",
                message: "invalid remote token"
              });
              socket.close();
              return;
            }
            connection.clientId = message.clientId;
            const result = options.onClientConnect?.(connection, message) ?? {
              clientId: message.clientId,
              sessionId: message.sessionId,
              currentSeq: message.streamLastSeq ?? message.lastSeq ?? asSeq(0),
              deviceId: asDeviceId("device_unknown")
            };
            connection.send({
              type: "connected",
              clientId: result.clientId,
              sessionId: result.sessionId,
              currentSeq: result.currentSeq,
              deviceId: result.deviceId,
              deviceDisplayName: result.deviceDisplayName
            });
            return;
          }
          const response = options.onClientMessage(connection, message);
          if (response) {
            connection.send(response);
          }
        });
      });
      await new Promise((resolve7, reject) => {
        server.once("error", reject);
        server.once("listening", () => {
          server.off("error", reject);
          resolve7();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        await closeWebSocketServer(server);
        throw new Error("remote daemon WebSocket server did not expose a TCP address");
      }
      const host = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
      return {
        host: options.host,
        port: address.port,
        url: `ws://${host}:${address.port}`,
        close: () => closeWebSocketServer(server)
      };
    };
    startScorelHostWebSocketServer = async (options) => {
      const connections = /* @__PURE__ */ new WeakMap();
      const daemonConnectionFor = (webSocketConnection, params) => {
        const existing = connections.get(webSocketConnection);
        if (existing) {
          return existing;
        }
        const connection = {
          clientId: params?.clientId ?? asClientId("ws_unconnected"),
          emit: (daemonMessage) => webSocketConnection.send(daemonMessage)
        };
        connections.set(webSocketConnection, connection);
        webSocketConnection.socket.once("close", () => options.hostService.disconnect(connection));
        return connection;
      };
      return startRemoteDaemonWebSocketServer({
        host: options.host,
        port: options.port,
        token: options.token,
        onClientConnect: (webSocketConnection, params) => {
          const daemonConnection = daemonConnectionFor(webSocketConnection, params);
          daemonConnection.clientId = params.clientId;
          const result = options.hostService.connect(daemonConnection, params.sessionId);
          return {
            clientId: params.clientId,
            sessionId: result.sessionId,
            currentSeq: result.currentSeq,
            deviceId: result.deviceId,
            deviceDisplayName: result.deviceDisplayName
          };
        },
        onClientMessage: (webSocketConnection, message) => {
          const daemonConnection = daemonConnectionFor(webSocketConnection);
          if (!daemonConnection.clientId) {
            return {
              type: "error",
              ok: false,
              code: "invalid_request",
              message: "websocket is not connected"
            };
          }
          void options.hostService.handleMessage(daemonConnection, message).catch((cause) => {
            webSocketConnection.send({
              type: "error",
              ok: false,
              code: "internal_error",
              message: cause instanceof Error ? cause.message : String(cause)
            });
          });
          return void 0;
        }
      });
    };
    closeWebSocketServer = (server) => new Promise((resolve7, reject) => {
      for (const client of server.clients) {
        client.close();
      }
      server.close((error) => error ? reject(error) : resolve7());
    });
    createRealRuntime = async (options) => {
      const selection = resolveModelSelection(options.config, options.modelSelection);
      const model = resolvePiAiModel(selection.config);
      const rtkExecutable = options.rtkExecutable ?? (options.config.runtime.tokenSavingRtk ? (await detectRtk()).executable : void 0);
      const runtime = new ScorelRuntime({
        provider: createPiAiProvider({
          model,
          apiKey: selection.config.apiKey
        })
      });
      if (options.includeTools !== false) {
        for (const tool of createCodingTools({
          cwd: options.cwd,
          contextWindow: model.contextWindow,
          tokenSaving: {
            rtk: {
              enabled: options.config.runtime.tokenSavingRtk,
              executable: rtkExecutable
            }
          }
        })) {
          runtime.registerTool(tool);
        }
      }
      return runtime;
    };
    ScorelHost = class {
      #sessionsDir;
      #deviceId;
      #deviceDisplayName;
      #scorelHomeDir;
      #userHomeDir;
      #builtinExtensionsDir;
      #modelProfile;
      #loadConfig;
      #loadConfigProfile;
      #createRuntime;
      #memoryHomeDir;
      #onSessionListChanged;
      #idleShutdownMs;
      #onIdleShutdown;
      #now;
      #createId;
      #sessions = /* @__PURE__ */ new Map();
      #connections = /* @__PURE__ */ new Set();
      #events = /* @__PURE__ */ new Map();
      #seqs = /* @__PURE__ */ new Map();
      #memoryDreams = /* @__PURE__ */ new Map();
      #sessionMemoryUpdates = /* @__PURE__ */ new Map();
      #imExtensions = /* @__PURE__ */ new Map();
      #imBindings = /* @__PURE__ */ new Map();
      #registry;
      #runtimeStatsQueue = Promise.resolve();
      #idleShutdownTimer;
      #started = false;
      constructor(options) {
        this.#sessionsDir = options.sessionsDir;
        this.#deviceId = options.deviceId;
        this.#deviceDisplayName = options.deviceDisplayName;
        this.#scorelHomeDir = resolve5(options.scorelHomeDir ?? dirname8(options.projectsPath));
        this.#userHomeDir = dirname8(this.#scorelHomeDir);
        this.#builtinExtensionsDir = resolve5(options.builtinExtensionsDir ?? defaultBuiltinExtensionsDir());
        this.#modelProfile = options.modelProfile;
        this.#loadConfig = options.loadConfig;
        this.#loadConfigProfile = options.loadConfigProfile;
        this.#createRuntime = options.createRuntime;
        this.#memoryHomeDir = options.memoryHomeDir;
        this.#onSessionListChanged = options.onSessionListChanged;
        this.#idleShutdownMs = options.idleShutdownMs;
        this.#onIdleShutdown = options.onIdleShutdown;
        this.#now = options.now ?? Date.now;
        this.#createId = options.createId ?? (() => crypto.randomUUID());
        this.#registry = new ProjectRegistry({
          sessionsDir: this.#sessionsDir,
          projectsPath: options.projectsPath,
          createId: this.#createId,
          now: this.#now
        });
      }
      async start() {
        this.#started = true;
        await mkdir6(this.#scorelHomeDir, { recursive: true });
        await this.#loadImBindings();
        await this.#startEnabledImExtensions();
        this.#scheduleIdleShutdownCheck();
      }
      async shutdown() {
        this.#clearIdleShutdownTimer();
        for (const schedule of this.#memoryDreams.values()) {
          if (schedule.timer) {
            clearTimeout(schedule.timer);
          }
        }
        this.#memoryDreams.clear();
        await this.#stopImExtensions();
        this.#connections.clear();
        this.#started = false;
      }
      async refreshImExtensions() {
        this.#assertStarted();
        await this.#stopImExtensions();
        await this.#startEnabledImExtensions();
        this.#scheduleIdleShutdownCheck();
      }
      connect(connection, sessionId) {
        this.#assertStarted();
        this.#clearIdleShutdownTimer();
        connection.sessionId = sessionId;
        this.#connections.add(connection);
        if (sessionId) {
          void this.#appendDiagnostic(sessionId, "client_connected", {
            clientId: connection.clientId,
            deviceId: this.#deviceId,
            deviceDisplayName: this.#deviceDisplayName
          });
        }
        return {
          clientId: connection.clientId,
          sessionId,
          currentSeq: asSeq(sessionId ? this.#seqs.get(sessionId) ?? 0 : 0),
          deviceId: this.#deviceId,
          deviceDisplayName: this.#deviceDisplayName
        };
      }
      disconnect(connection) {
        if (connection.sessionId) {
          void this.#appendDiagnostic(connection.sessionId, "client_disconnected", {
            clientId: connection.clientId
          });
        }
        this.#connections.delete(connection);
        this.#scheduleIdleShutdownCheck();
      }
      releaseSessionEventBuffer(sessionId) {
        this.#events.delete(sessionId);
      }
      async handleMessage(connection, message) {
        this.#assertStarted();
        try {
          await this.#handleMessage(connection, message);
        } catch (cause) {
          if ("requestId" in message) {
            connection.emit({
              type: "error",
              requestId: message.requestId,
              ok: false,
              code: wireErrorCode(cause),
              message: cause instanceof Error ? cause.message : String(cause)
            });
            return;
          }
          throw cause;
        } finally {
          this.#scheduleIdleShutdownCheck();
        }
      }
      async listDirectories(path) {
        const listing = await listDirectories(path);
        await this.#appendHostDiagnostic("directory_listed", { path: listing.path });
        return listing;
      }
      async registerProject(workDir) {
        const project = await this.#registry.register(workDir);
        await this.#appendHostDiagnostic("project_registered", {
          projectId: project.projectId,
          workDir: project.workDir
        });
        return project;
      }
      async listProjects() {
        return this.#registry.list();
      }
      async removeProject(projectId) {
        const project = await this.#registry.require(projectId);
        const removed = await this.#registry.remove(projectId);
        await this.#appendHostDiagnostic("project_removed", {
          projectId,
          workDir: project.workDir
        });
        return removed;
      }
      async receiveImMessage(extensionId, message) {
        this.#assertStarted();
        const extension = this.#imExtensions.get(extensionId);
        if (!extension) {
          throw new Error(`IM extension is not enabled: ${extensionId}`);
        }
        return this.#handleImMessage(extension, message);
      }
      loopbackOutbox(extensionId = "loopback") {
        return this.#imExtensions.get(extensionId)?.adapter.getOutbox?.() ?? [];
      }
      async #handleMessage(connection, message) {
        switch (message.type) {
          case "create_session":
            await this.#handleCreateSession(connection, message);
            break;
          case "load_session":
            await this.#handleLoadSession(connection, message);
            break;
          case "send_message":
            await this.#handleSendMessage(connection, message);
            break;
          case "rewrite_queue":
            await this.#handleRewriteQueue(connection, message);
            break;
          case "resync_events":
            this.#respond(connection, message, await this.#resyncEvents(message.sessionId, {
              persistentLastSeq: message.persistentLastSeq ?? message.fromSeq,
              streamLastSeq: message.streamLastSeq ?? message.fromSeq
            }));
            break;
          case "subscribe_events":
            connection.sessionId = message.sessionId;
            this.#respond(connection, message, {
              currentSeq: asSeq(this.#seqs.get(message.sessionId) ?? 0)
            });
            break;
          case "get_status":
            this.#respond(connection, message, {
              running: false,
              activeClients: [...this.#connections].map((candidate) => candidate.clientId),
              sessionCount: this.#sessions.size,
              uptimeMs: 0
            });
            break;
          case "ping":
            connection.emit({ type: "pong", requestId: message.requestId });
            break;
          case "disconnect":
            this.disconnect(connection);
            break;
          case "list_sessions": {
            const sessions = await listSessionSummaries(
              this.#sessionsDir,
              { projectId: message.projectId, limit: message.limit },
              this.#sessionSummaryOverrides()
            );
            this.#respond(connection, message, { sessions });
            break;
          }
          case "list_projects": {
            this.#respond(connection, message, { projects: await this.listProjects() });
            break;
          }
          case "list_models": {
            this.#respond(connection, message, await this.#listModels(message.projectId));
            break;
          }
          case "upsert_model_profile": {
            this.#respond(connection, message, await this.#handleUpsertModelProfile(message));
            break;
          }
          case "remove_model_provider": {
            this.#respond(connection, message, await this.#handleRemoveModelProvider(message));
            break;
          }
          case "fetch_provider_models": {
            this.#respond(connection, message, { models: await this.#fetchProviderModels(message.projectId, message.providerId) });
            break;
          }
          case "get_memory_settings": {
            this.#respond(connection, message, { memory: await this.#memorySettingsForProject(message.projectId) });
            break;
          }
          case "get_memory_status": {
            this.#respond(connection, message, { status: await this.#memoryStatusForProject(message.projectId) });
            break;
          }
          case "upsert_memory_settings": {
            this.#respond(connection, message, { memory: await this.#handleUpsertMemorySettings(message) });
            break;
          }
          case "get_runtime_settings": {
            this.#respond(connection, message, { runtime: await this.#runtimeSettingsForProject(message.projectId) });
            break;
          }
          case "upsert_runtime_settings": {
            this.#respond(connection, message, { runtime: await this.#handleUpsertRuntimeSettings(message) });
            break;
          }
          case "get_extension_settings": {
            this.#respond(connection, message, { extension: await this.#extensionSettings(message.extensionId) });
            break;
          }
          case "upsert_extension_settings": {
            this.#respond(connection, message, { extension: await this.#handleUpsertExtensionSettings(message) });
            break;
          }
          case "list_directories": {
            this.#respond(connection, message, await this.listDirectories(message.path));
            break;
          }
          case "register_project": {
            this.#respond(connection, message, { project: await this.registerProject(message.workDir) });
            break;
          }
          case "remove_project": {
            this.#respond(connection, message, {
              projectId: message.projectId,
              removed: await this.removeProject(message.projectId)
            });
            break;
          }
          case "cancel":
            await this.#handleCancel(connection, message);
            break;
        }
      }
      #scheduleIdleShutdownCheck() {
        this.#clearIdleShutdownTimer();
        if (!this.#shouldIdleShutdown()) {
          return;
        }
        this.#idleShutdownTimer = setTimeout(() => {
          this.#idleShutdownTimer = void 0;
          if (this.#shouldIdleShutdown()) {
            this.#onIdleShutdown?.();
          }
        }, this.#idleShutdownMs);
      }
      #clearIdleShutdownTimer() {
        if (!this.#idleShutdownTimer) {
          return;
        }
        clearTimeout(this.#idleShutdownTimer);
        this.#idleShutdownTimer = void 0;
      }
      #shouldIdleShutdown() {
        return this.#started && this.#idleShutdownMs !== void 0 && this.#idleShutdownMs > 0 && this.#connections.size === 0 && this.#imExtensions.size === 0 && !this.#hasActiveWork();
      }
      #hasActiveWork() {
        for (const lane of this.#sessions.values()) {
          if (lane.runtime.running) {
            return true;
          }
          if (lane.session.tree.controlState.queues.follow_up.length > 0 || lane.session.tree.controlState.queues.steer.length > 0) {
            return true;
          }
        }
        return false;
      }
      async #handleCreateSession(connection, request) {
        const sessionId = request.sessionId ?? asSessionId(`ses_${this.#createId()}`);
        const project = await this.#resolveProject(sessionId, request.meta.projectId);
        if (request.sessionId && await this.#loadExistingLaneIfPresent(sessionId)) {
          if (this.#sessions.get(sessionId)?.project.projectId !== project.projectId) {
            throw new ProjectRegistryError("conflict", `Session ${sessionId} belongs to another project`);
          }
          await this.#appendDiagnostic(sessionId, "session_loaded", { clientId: connection.clientId });
          this.#respond(connection, request, { sessionId });
          return;
        }
        let lane;
        let created = true;
        try {
          lane = await this.#createLane(sessionId, request.meta, project);
        } catch (cause) {
          if (!request.sessionId || !isNodeErrorCode4(cause, "EEXIST")) {
            throw cause;
          }
          lane = await this.#getLane(sessionId);
          created = false;
        }
        this.#sessions.set(sessionId, lane);
        if (created) {
          this.#events.set(sessionId, []);
          this.#seqs.set(sessionId, 0);
        }
        await this.#appendDiagnostic(sessionId, created ? "session_created" : "session_loaded", {
          clientId: connection.clientId,
          projectId: lane.project.projectId,
          workDir: lane.project.workDir,
          model: request.meta.model
        });
        if (created) {
          this.#onSessionListChanged?.({ projectId: lane.project.projectId, sessionId });
        }
        this.#respond(connection, request, { sessionId });
      }
      async #handleLoadSession(connection, request) {
        try {
          const lane = await this.#getLane(request.sessionId);
          await this.#appendDiagnostic(request.sessionId, "session_loaded", { clientId: connection.clientId });
          connection.sessionId = request.sessionId;
          const persistentEvents = [...lane.session.tree];
          const sessionEvents = this.#events.get(request.sessionId) ?? [];
          if (sessionEvents.length === 0 && persistentEvents.length > 0) {
            this.#events.set(request.sessionId, persistentEvents);
          }
          this.#respond(connection, request, {
            sessionId: request.sessionId,
            activeLeafId: lane.session.activeLeafId,
            currentSeq: lane.session.currentSeq,
            events: persistentEvents,
            meta: lane.session.header.meta
          });
        } catch (cause) {
          connection.emit({
            type: "error",
            requestId: request.requestId,
            ok: false,
            code: "session_not_found",
            message: cause instanceof Error ? cause.message : String(cause)
          });
        }
      }
      async #handleSendMessage(connection, request) {
        const lane = await this.#getLane(request.sessionId);
        if (lane.runtime.running) {
          const runningBehavior = request.options?.runningBehavior ?? "follow_up";
          if (runningBehavior === "steer") {
            await this.#enqueueSteer(lane, connection, request);
            return;
          }
          await this.#enqueueFollowUp(lane, connection, request);
          return;
        }
        lane.queue = lane.queue.then(async () => {
          await this.#drainFollowUps(lane);
          await this.#runUserTurn(lane, connection.clientId, {
            content: normalizeContent(request.content),
            parentId: request.options?.parentId,
            source: "user",
            channelContext: request.options?.channelContext ? runtimeChannelContextFromWire(request.options.channelContext) : void 0,
            onComplete: (result) => this.#respond(connection, request, { ...result, status: "completed" })
          });
          await this.#drainFollowUps(lane);
        });
        await lane.queue;
      }
      async #handleRewriteQueue(connection, request) {
        const lane = await this.#getLane(request.sessionId);
        await this.#appendQueueRewrite(lane, request.queue, request.items, {
          clientId: connection.clientId,
          anchorEventId: lane.session.activeLeafId
        });
        await this.#appendDiagnostic(request.sessionId, "queue_rewritten", {
          clientId: connection.clientId,
          queue: request.queue,
          queueSize: request.items.length
        });
        this.#respond(connection, request, {
          sessionId: request.sessionId,
          queue: request.queue,
          items: request.items
        });
      }
      async #runUserTurn(lane, clientId, input) {
        const sessionId = lane.session.header.sessionId;
        await this.#appendDiagnostic(sessionId, "send_message_started", {
          clientId,
          activeLeafId: lane.session.activeLeafId,
          source: input.source
        });
        const instructionSnapshot = await this.#ensureInstructionSnapshot(lane, clientId);
        await this.#syncSkillIndex(lane, clientId);
        await this.#ensureMemoryHarness(lane, clientId);
        await this.#syncMemoryTools(lane, clientId);
        await this.#autoCompactIfNeeded(lane, clientId);
        this.#syncChannelTool(lane, input.channelContext);
        let parentId = input.parentId === void 0 ? lane.session.activeLeafId : input.parentId;
        if (input.channelContext) {
          const channelHarness = await this.#appendChannelHarness(lane, clientId, input.channelContext, parentId);
          parentId = channelHarness.id;
        }
        const userEventId = asEventId(this.#createId());
        const userEvent = await this.#appendPersistent(lane, {
          type: "user_message",
          id: userEventId,
          parentId,
          sessionId,
          clientId,
          ts: this.#now(),
          message: {
            role: "user",
            content: input.content,
            ...input.source === "follow_up" ? { meta: { source: "follow_up", queueItemId: input.queueItemId } } : {}
          }
        });
        const runAfterUserMessageHooks = this.#scheduleAfterUserMessageHooks(lane, clientId, userEvent);
        void runAfterUserMessageHooks().catch((cause) => {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          void this.#appendDiagnostic(sessionId, "after_user_message_hook_failed", {
            clientId,
            message: error.message,
            stack: shortStack(error)
          });
        });
        const firstAssistantEventId = asEventId(this.#createId());
        const state = {
          parentId: userEvent.id,
          assistantEventId: firstAssistantEventId,
          finalAssistantEventId: firstAssistantEventId
        };
        lane.channelContext = input.channelContext;
        try {
          for await (const rawEvent of lane.runtime.executeTurn(
            buildContext(lane.session.tree, userEvent.id),
            renderSystemPrompt(instructionSnapshot),
            {
              refreshContext: async () => {
                await this.#consumeSteer(lane, clientId, state);
                return buildContext(lane.session.tree, lane.session.activeLeafId ?? state.parentId);
              }
            }
          )) {
            await this.#handleRuntimeEvent(lane, clientId, state, rawEvent);
          }
        } finally {
          lane.channelContext = void 0;
          lane.runtime.unregisterTool("SendChannelMessage");
        }
        const result = { userEventId, assistantEventId: state.finalAssistantEventId };
        await this.#appendDiagnostic(sessionId, "send_message_finished", {
          clientId,
          userEventId,
          assistantEventId: state.finalAssistantEventId,
          source: input.source
        });
        this.#scheduleSessionMemoryUpdate(lane, clientId);
        input.onComplete?.(result);
        return { ...result, status: "completed" };
      }
      #scheduleAfterUserMessageHooks(lane, clientId, userEvent) {
        const hooks = [
          ({ lane: hookLane, clientId: hookClientId, userEvent: hookUserEvent }) => this.#runSessionTitleHook(hookLane, hookClientId, hookUserEvent)
        ];
        return async () => {
          for (const hook of hooks) {
            await hook({ lane, clientId, userEvent });
          }
        };
      }
      async #runSessionTitleHook(lane, clientId, userEvent) {
        const sessionId = lane.session.header.sessionId;
        const generatedTitle = await this.#maybeGenerateSessionTitle(lane, clientId, userEvent).catch((cause) => {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          void this.#appendDiagnostic(sessionId, "session_title_generation_failed", {
            clientId,
            message: error.message,
            stack: shortStack(error)
          });
          return void 0;
        });
        if (generatedTitle) {
          await this.#appendPersistent(lane, {
            type: "session_title_updated",
            id: asEventId(this.#createId()),
            parentId: null,
            sessionId,
            clientId,
            ts: this.#now(),
            title: generatedTitle.title,
            source: "model",
            model: generatedTitle.model,
            derivedFrom: {
              eventId: userEvent.id,
              seq: userEvent.seq
            }
          });
          await this.#appendDiagnostic(sessionId, "session_title_generated", {
            clientId,
            title: generatedTitle.title,
            modelId: generatedTitle.model.modelId
          });
        }
      }
      async #maybeGenerateSessionTitle(lane, clientId, userEvent) {
        if (lane.session.header.meta.title?.trim()) {
          return void 0;
        }
        const text = inputText(userEvent.message).trim();
        if (!text) {
          return void 0;
        }
        let userMessages = 0;
        for (const event of lane.session.tree) {
          if (event.type === "session_title_updated") {
            return void 0;
          }
          if (event.type === "user_message") {
            userMessages += 1;
          }
        }
        if (userMessages !== 1) {
          return void 0;
        }
        const selectedModel = await this.#selectedModelFromMeta(
          { projectId: lane.project.projectId, modelSelection: { role: "auxiliary" } },
          lane.project
        );
        if (!selectedModel) {
          return void 0;
        }
        const runtime = await this.#createRuntime({ sessionId: lane.session.header.sessionId, project: lane.project, selectedModel, purpose: "title" });
        let rawTitle = "";
        for await (const rawEvent of runtime.executeTurn(
          [
            {
              role: "user",
              content: [{
                type: "text",
                text: [
                  "Write a session title for the following first user request.",
                  "",
                  "Rules:",
                  "- Return only the title text.",
                  "- Do not answer the request.",
                  "- Do not mention yourself.",
                  "- Use the same language as the request when obvious.",
                  "- Prefer a short noun phrase or task label, 4 to 12 Chinese characters or 4 to 8 English words.",
                  "- No quotes, punctuation, or trailing period.",
                  "",
                  "<user_request>",
                  text.slice(0, 4e3),
                  "</user_request>"
                ].join("\n")
              }]
            }
          ],
          [
            "You generate concise chat session titles.",
            "You are not answering the user request.",
            "You only summarize the user's intent as a short title.",
            "If the request is in Chinese, output Chinese.",
            "Output plain text only."
          ].join("\n"),
          {}
        )) {
          if (rawEvent.type === "text_delta") {
            rawTitle += rawEvent.delta;
          } else if (rawEvent.type === "message_end") {
            rawTitle = assistantText(rawEvent.message) || rawTitle;
          } else if (rawEvent.type === "error") {
            throw rawEvent.error;
          }
        }
        const title = sanitizeSessionTitle(rawTitle);
        if (!title) {
          return void 0;
        }
        await this.#appendDiagnostic(lane.session.header.sessionId, "session_title_model_used", {
          clientId,
          modelId: selectedModel.modelId,
          role: selectedModel.role
        });
        return { title, model: selectedModel };
      }
      async #enqueueFollowUp(lane, connection, request) {
        const now = this.#now();
        const item = {
          id: this.#createId(),
          content: normalizeContent(request.content),
          createdAt: now,
          updatedAt: now,
          clientId: connection.clientId,
          ...request.options?.channelContext ? { data: { channelContext: request.options.channelContext } } : {}
        };
        lane.followUpWaiters.set(item.id, { connection, request });
        await this.#appendQueueRewrite(lane, "follow_up", [...lane.session.tree.controlState.queues.follow_up, item], {
          clientId: connection.clientId,
          anchorEventId: lane.session.activeLeafId
        });
        await this.#appendDiagnostic(lane.session.header.sessionId, "follow_up_queued", {
          clientId: connection.clientId,
          queueItemId: item.id,
          queueSize: lane.session.tree.controlState.queues.follow_up.length
        });
      }
      async #enqueueSteer(lane, connection, request) {
        const now = this.#now();
        const item = {
          id: this.#createId(),
          content: normalizeContent(request.content),
          createdAt: now,
          updatedAt: now,
          clientId: connection.clientId,
          ...request.options?.channelContext ? { data: { channelContext: request.options.channelContext } } : {}
        };
        await this.#appendQueueRewrite(lane, "steer", [...lane.session.tree.controlState.queues.steer, item], {
          clientId: connection.clientId,
          anchorEventId: lane.session.activeLeafId
        });
        await this.#appendDiagnostic(lane.session.header.sessionId, "steer_queued", {
          clientId: connection.clientId,
          queueItemId: item.id,
          queueSize: lane.session.tree.controlState.queues.steer.length
        });
        this.#respond(connection, request, {
          status: "queued",
          queue: "steer",
          queueItemId: item.id
        });
      }
      async #drainFollowUps(lane) {
        while (lane.session.tree.controlState.queues.follow_up.length > 0) {
          const item = lane.session.tree.controlState.queues.follow_up[0];
          const remaining = lane.session.tree.controlState.queues.follow_up.slice(1);
          await this.#appendQueueRewrite(lane, "follow_up", remaining, {
            clientId: item.clientId,
            anchorEventId: lane.session.activeLeafId
          });
          const waiter = lane.followUpWaiters.get(item.id);
          lane.followUpWaiters.delete(item.id);
          await this.#runUserTurn(lane, item.clientId, {
            content: item.content,
            parentId: lane.session.activeLeafId,
            source: "follow_up",
            queueItemId: item.id,
            channelContext: parseQueuedChannelContext(item.data?.channelContext),
            onComplete: waiter ? (result) => this.#respond(waiter.connection, waiter.request, { ...result, status: "completed" }) : void 0
          });
        }
      }
      async #consumeSteer(lane, clientId, state) {
        const item = lane.session.tree.controlState.queues.steer[0];
        if (!item) {
          return;
        }
        await this.#appendQueueRewrite(lane, "steer", lane.session.tree.controlState.queues.steer.slice(1), {
          clientId,
          anchorEventId: state.parentId
        });
        const content = item.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
        const harnessEvent = await this.#appendPersistent(lane, {
          type: "harness_item",
          id: asEventId(this.#createId()),
          parentId: state.parentId,
          sessionId: lane.session.header.sessionId,
          clientId: item.clientId,
          ts: this.#now(),
          item: {
            kind: "steer",
            origin: "user",
            content,
            visibility: "display",
            data: { queueItemId: item.id }
          }
        });
        state.parentId = harnessEvent.id;
      }
      async #appendQueueRewrite(lane, queue, items, options) {
        await this.#appendPersistent(lane, {
          type: "queue_update",
          id: asEventId(this.#createId()),
          parentId: null,
          sessionId: lane.session.header.sessionId,
          clientId: options.clientId,
          ts: this.#now(),
          queue,
          operation: "rewrite",
          items,
          anchorEventId: options.anchorEventId
        });
      }
      async #handleCancel(connection, request) {
        try {
          const lane = await this.#getLane(request.sessionId);
          const cancelled = lane.runtime.running;
          lane.runtime.cancel();
          await this.#appendDiagnostic(request.sessionId, "cancel_requested", {
            clientId: connection.clientId,
            cancelled
          });
          this.#respond(connection, request, {
            sessionId: request.sessionId,
            cancelled
          });
        } catch (cause) {
          connection.emit({
            type: "error",
            requestId: request.requestId,
            ok: false,
            code: "session_not_found",
            message: cause instanceof Error ? cause.message : String(cause)
          });
        }
      }
      #sessionSummaryOverrides() {
        const overrides = /* @__PURE__ */ new Map();
        for (const [sessionId, currentSeq] of this.#seqs.entries()) {
          overrides.set(String(sessionId), { currentSeq });
        }
        return overrides;
      }
      async #handleRuntimeEvent(lane, clientId, state, rawEvent) {
        switch (rawEvent.type) {
          case "turn_start":
            this.#broadcastTransient(lane.session.header.sessionId, {
              type: "turn_start",
              sessionId: lane.session.header.sessionId,
              clientId,
              ts: this.#now(),
              turnIndex: 0
            });
            break;
          case "message_start":
            this.#broadcastTransient(lane.session.header.sessionId, {
              type: "message_start",
              sessionId: lane.session.header.sessionId,
              clientId,
              ts: this.#now(),
              eventId: state.assistantEventId,
              parentId: state.parentId,
              role: rawEvent.role
            });
            break;
          case "text_delta":
            this.#broadcastTransient(lane.session.header.sessionId, {
              type: "text_delta",
              sessionId: lane.session.header.sessionId,
              clientId,
              ts: this.#now(),
              eventId: state.assistantEventId,
              delta: rawEvent.delta
            });
            break;
          case "thinking_delta":
            this.#broadcastTransient(lane.session.header.sessionId, {
              type: "thinking_delta",
              sessionId: lane.session.header.sessionId,
              clientId,
              ts: this.#now(),
              eventId: state.assistantEventId,
              delta: rawEvent.delta
            });
            break;
          case "message_end": {
            await this.#appendDiagnostic(lane.session.header.sessionId, "assistant_result", {
              clientId,
              stopReason: rawEvent.message.stopReason,
              thinkingBlocks: countContentBlocks(rawEvent.message, "thinking"),
              textBlocks: countContentBlocks(rawEvent.message, "text"),
              toolCalls: countContentBlocks(rawEvent.message, "tool_call"),
              inputTokens: rawEvent.message.usage?.inputTokens,
              outputTokens: rawEvent.message.usage?.outputTokens,
              totalTokens: rawEvent.message.usage?.totalTokens
            });
            const appended = (await this.#appendPersistent(lane, {
              type: "assistant_message",
              id: state.assistantEventId,
              parentId: state.parentId,
              sessionId: lane.session.header.sessionId,
              clientId,
              ts: this.#now(),
              message: rawEvent.message
            })).id;
            state.parentId = appended;
            state.finalAssistantEventId = appended;
            state.assistantEventId = asEventId(this.#createId());
            break;
          }
          case "tool_execution_start":
            break;
          case "tool_execution_end": {
            const toolResultId = asEventId(this.#createId());
            await this.#appendPersistent(lane, {
              type: "tool_result",
              id: toolResultId,
              parentId: state.parentId,
              sessionId: lane.session.header.sessionId,
              clientId,
              ts: this.#now(),
              message: {
                role: "tool_result",
                content: [
                  {
                    type: "tool_result",
                    toolCallId: rawEvent.toolCallId,
                    toolName: rawEvent.toolName,
                    result: rawEvent.result,
                    isError: rawEvent.isError
                  }
                ]
              }
            });
            const rtkSavings = rtkSavingsFromToolResult(rawEvent.result);
            if (rtkSavings) {
              await this.#recordRtkSavings({
                projectId: lane.project.projectId,
                sessionId: lane.session.header.sessionId,
                savings: rtkSavings
              }).catch(
                (cause) => this.#appendDiagnostic(lane.session.header.sessionId, "runtime_stats_update_failed", {
                  message: cause instanceof Error ? cause.message : String(cause)
                })
              );
            }
            state.parentId = toolResultId;
            break;
          }
          case "turn_end":
            void this.#appendDiagnostic(lane.session.header.sessionId, "runtime_turn_end", {
              clientId,
              stopReason: rawEvent.stopReason
            });
            this.#broadcastTransient(lane.session.header.sessionId, {
              type: "turn_end",
              sessionId: lane.session.header.sessionId,
              clientId,
              ts: this.#now(),
              turnIndex: 0,
              stopReason: rawEvent.stopReason
            });
            break;
          case "error":
            void this.#appendDiagnostic(lane.session.header.sessionId, "runtime_error", {
              clientId,
              message: rawEvent.error.message,
              stack: shortStack(rawEvent.error)
            });
            this.#broadcastTransient(lane.session.header.sessionId, {
              type: "error",
              sessionId: lane.session.header.sessionId,
              clientId,
              ts: this.#now(),
              code: "internal_error",
              message: rawEvent.error.message
            });
            break;
        }
      }
      async #appendPersistent(lane, event) {
        let appended;
        const appendTask = lane.appendQueue.then(async () => {
          const withSeq = { ...event, seq: this.#nextSeq(lane.session.header.sessionId) };
          await lane.session.append(withSeq);
          this.#recordAndBroadcast(lane.session.header.sessionId, withSeq);
          appended = withSeq;
        });
        lane.appendQueue = appendTask.catch(() => {
        });
        await appendTask;
        return appended;
      }
      async #ensureInstructionSnapshot(lane, clientId) {
        const existing = lane.session.tree.controlState.instructionSnapshot;
        if (existing) {
          return existing;
        }
        const snapshot = await buildInstructionSnapshot({
          cwd: lane.project.workDir,
          now: this.#now
        });
        await this.#appendPersistent(lane, {
          type: "instruction_snapshot",
          id: asEventId(this.#createId()),
          parentId: null,
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          snapshot
        });
        await this.#appendDiagnostic(lane.session.header.sessionId, "instruction_snapshot_created", {
          clientId,
          sections: snapshot.sections.length
        });
        return snapshot;
      }
      async #syncSkillIndex(lane, clientId) {
        const entries = await scanSkillIndex({ cwd: lane.project.workDir, extensionSkillRoots: this.#extensionSkillRoots() });
        if (!lane.session.tree.controlState.skillIndexInitialized) {
          await this.#appendPersistent(lane, {
            type: "skill_index_snapshot",
            id: asEventId(this.#createId()),
            parentId: null,
            sessionId: lane.session.header.sessionId,
            clientId,
            ts: this.#now(),
            anchorEventId: lane.session.activeLeafId,
            entries
          });
          await this.#appendSkillHarness(lane, clientId, "skill_listing", renderSkillListing(entries));
          return;
        }
        const delta = diffSkillIndex(lane.session.tree.controlState.skillIndex, entries);
        if (!hasSkillIndexDelta(delta)) {
          return;
        }
        await this.#appendPersistent(lane, {
          type: "skill_index_delta",
          id: asEventId(this.#createId()),
          parentId: null,
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          anchorEventId: lane.session.activeLeafId,
          added: delta.added,
          changed: delta.changed,
          removed: delta.removed
        });
        await this.#appendSkillHarness(lane, clientId, "skill_delta", renderSkillDelta(delta));
      }
      async #ensureMemoryHarness(lane, clientId) {
        const memory = await this.#safeMemorySettingsForRuntime(lane, clientId);
        if (!memory.enabled) {
          return;
        }
        for (const event of lane.session.tree) {
          if (event.type === "harness_item" && event.item.kind === "memory") {
            return;
          }
        }
        const context = await buildMemoryContext({
          projectId: lane.project.projectId,
          homeDir: this.#memoryHomeDir,
          now: this.#now
        });
        await this.#appendPersistent(lane, {
          type: "harness_item",
          id: asEventId(this.#createId()),
          parentId: lane.session.activeLeafId,
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          item: {
            kind: "memory",
            origin: "system",
            content: renderMemoryHarness(context),
            visibility: "hidden",
            data: {
              date: context.paths.today,
              projectId: lane.project.projectId
            }
          }
        });
      }
      async #syncMemoryTools(lane, clientId) {
        const memory = await this.#safeMemorySettingsForRuntime(lane, clientId);
        if (!memory.enabled || !memory.daily) {
          lane.runtime.unregisterTool("AppendDaily");
          return;
        }
        lane.runtime.registerTool(
          createAppendDailyTool({
            projectId: lane.project.projectId,
            homeDir: this.#memoryHomeDir,
            now: this.#now,
            onAppend: async (result) => {
              if (result.entry) {
                await this.#markMemoryDreamDirty(lane, clientId, result.path);
              }
              try {
                await this.#appendDiagnostic(lane.session.header.sessionId, "memory_daily_appended", {
                  clientId,
                  path: result.path,
                  date: result.date,
                  skippedReason: result.skippedReason
                });
              } catch {
              }
              if (result.entry) {
                await this.#scheduleMemoryDream(lane, clientId);
              }
            }
          })
        );
      }
      async #autoCompactIfNeeded(lane, clientId) {
        const memory = await this.#safeMemorySettingsForRuntime(lane, clientId);
        if (memory.autoCompactThreshold <= 0) {
          return;
        }
        const leafId = lane.session.activeLeafId;
        if (!leafId) {
          return;
        }
        const leaf = lane.session.tree.get(leafId)?.event;
        if (leaf?.type === "compact") {
          return;
        }
        const context = buildContext(lane.session.tree, leafId);
        const tokensBefore = estimateScorelMessagesTokens(context);
        const contextWindow = lane.session.header.meta.selectedModel?.contextWindow ?? 2e5;
        const threshold = Math.floor(contextWindow * memory.autoCompactThreshold);
        if (tokensBefore < threshold) {
          return;
        }
        await this.#waitForSessionMemoryUpdate(lane.session.header.sessionId, SESSION_MEMORY_COMPACT_WAIT_MS);
        const sessionMemory = memory.sessionMemory ? await this.#readSessionMemory(lane) : "";
        const compactSource = sessionMemory ? "session_memory" : "foreground_compact";
        const compactSummary = sessionMemory || await this.#generateForegroundCompactSummary(lane).catch((cause) => {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          void this.#appendDiagnostic(lane.session.header.sessionId, "foreground_compact_failed", {
            clientId,
            message: error.message,
            stack: shortStack(error)
          });
          return "";
        });
        const summary = [
          compactSummary || this.#fallbackSessionMemorySummary(lane).summary
        ].join("\n").trim();
        const compacted = await this.#appendPersistent(lane, {
          type: "compact",
          id: asEventId(this.#createId()),
          parentId: leafId,
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          summary,
          compactedThrough: leafId,
          tokensBefore,
          tokensAfter: estimateTextTokens(summary),
          retainedEventCount: AUTO_COMPACT_RETAINED_EVENTS
        });
        await this.#appendDiagnostic(lane.session.header.sessionId, "auto_compacted", {
          clientId,
          compactEventId: compacted.id,
          source: compactSource,
          tokensBefore,
          tokensAfter: "tokensAfter" in compacted ? compacted.tokensAfter : void 0,
          threshold
        });
      }
      #scheduleSessionMemoryUpdate(lane, clientId) {
        const sessionId = lane.session.header.sessionId;
        const previous = this.#sessionMemoryUpdates.get(sessionId) ?? Promise.resolve();
        const task = previous.catch(() => void 0).then(() => this.#maintainSessionMemory(lane, clientId));
        this.#sessionMemoryUpdates.set(sessionId, task);
        void task.catch((cause) => {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          void this.#appendDiagnostic(sessionId, "session_memory_update_failed", {
            clientId,
            message: error.message,
            stack: shortStack(error)
          });
        }).finally(() => {
          if (this.#sessionMemoryUpdates.get(sessionId) === task) {
            this.#sessionMemoryUpdates.delete(sessionId);
          }
        });
      }
      async #waitForSessionMemoryUpdate(sessionId, timeoutMs) {
        const update = this.#sessionMemoryUpdates.get(sessionId);
        if (!update) {
          return;
        }
        await Promise.race([
          update.catch(() => void 0),
          new Promise((resolve7) => setTimeout(resolve7, timeoutMs))
        ]);
      }
      async #readSessionMemory(lane) {
        return (await readSessionMemory({
          projectId: lane.project.projectId,
          sessionId: lane.session.header.sessionId,
          homeDir: this.#memoryHomeDir
        })).trim();
      }
      async #maintainSessionMemory(lane, clientId) {
        const memory = await this.#safeMemorySettingsForRuntime(lane, clientId);
        if (!memory.sessionMemory) {
          return;
        }
        const current = await this.#readSessionMemory(lane);
        const generated = await this.#generateSessionMemory(lane, current).catch(() => void 0);
        const fallback = this.#fallbackSessionMemorySummary(lane);
        const result = await writeSessionMemory({
          projectId: lane.project.projectId,
          sessionId: lane.session.header.sessionId,
          homeDir: this.#memoryHomeDir,
          now: this.#now,
          summary: generated?.summary ?? fallback.summary,
          recentMessages: generated?.recentMessages ?? fallback.recentMessages,
          decisions: generated?.decisions ?? fallback.decisions,
          followUps: generated?.followUps ?? fallback.followUps
        });
        await this.#appendDiagnostic(lane.session.header.sessionId, "session_memory_updated", {
          clientId,
          path: result.path,
          bytes: result.content.length
        });
      }
      async #generateForegroundCompactSummary(lane) {
        const selectedModel = await this.#selectedModelFromMeta(
          { projectId: lane.project.projectId, modelSelection: { role: "auxiliary" } },
          lane.project
        );
        if (!selectedModel) {
          return "";
        }
        const runtime = await this.#createRuntime({
          sessionId: lane.session.header.sessionId,
          project: lane.project,
          selectedModel,
          purpose: "memory"
        });
        const prompt = [
          "Compact the Scorel session context for continuation.",
          "Return a dense markdown summary only. Do not mention these instructions.",
          "Preserve current task, user requirements, decisions, important files/functions, errors, commands, and next steps.",
          "",
          "<recent_events>",
          this.#recentConversationLines(lane, 40).join("\n"),
          "</recent_events>"
        ].join("\n");
        let raw = "";
        for await (const rawEvent of runtime.executeTurn(
          [{ role: "user", content: [{ type: "text", text: prompt }] }],
          "You compact session context. Output markdown only.",
          {}
        )) {
          if (rawEvent.type === "text_delta") {
            raw += rawEvent.delta;
          } else if (rawEvent.type === "message_end") {
            raw = assistantText(rawEvent.message) || raw;
          } else if (rawEvent.type === "error") {
            throw rawEvent.error;
          }
        }
        return raw.trim();
      }
      async #generateSessionMemory(lane, current) {
        const selectedModel = await this.#selectedModelFromMeta(
          { projectId: lane.project.projectId, modelSelection: { role: "auxiliary" } },
          lane.project
        );
        if (!selectedModel) {
          return void 0;
        }
        const runtime = await this.#createRuntime({
          sessionId: lane.session.header.sessionId,
          project: lane.project,
          selectedModel,
          purpose: "memory"
        });
        const prompt = [
          "Update Scorel session memory for context management. Return strict JSON only.",
          "This is not long-term memory. It is a compact current-session summary used by future auto compact.",
          "Keys: summary string, recentMessages string[], decisions string[], followUps string[].",
          "Keep it dense, current, and useful after old conversation history is replaced.",
          "",
          "<current_session_memory>",
          current.trim() || "(empty)",
          "</current_session_memory>",
          "",
          "<recent_events>",
          this.#recentConversationLines(lane, 24).join("\n"),
          "</recent_events>"
        ].join("\n");
        let raw = "";
        for await (const rawEvent of runtime.executeTurn(
          [{ role: "user", content: [{ type: "text", text: prompt }] }],
          "You maintain session memory for context compaction. Output strict JSON only.",
          {}
        )) {
          if (rawEvent.type === "text_delta") {
            raw += rawEvent.delta;
          } else if (rawEvent.type === "message_end") {
            raw = assistantText(rawEvent.message) || raw;
          } else if (rawEvent.type === "error") {
            throw rawEvent.error;
          }
        }
        return parseSessionMemoryJson(raw);
      }
      #fallbackSessionMemorySummary(lane) {
        const recentMessages = this.#recentConversationLines(lane, 12);
        return {
          summary: recentMessages.at(-1) ?? "Session is active. Continue from the latest visible user request.",
          recentMessages,
          decisions: [],
          followUps: []
        };
      }
      #recentConversationLines(lane, limit) {
        const events = [...lane.session.tree].filter((event) => "message" in event || event.type === "compact").slice(-limit);
        return events.map((event) => {
          if (event.type === "compact") {
            return `[compact] ${compactLine2(event.summary, 500)}`;
          }
          return `[${event.message.role}] ${compactLine2(messageText(event.message), 500)}`;
        });
      }
      async #appendChannelHarness(lane, clientId, context, parentId) {
        const lines = [
          "This message came from an IM channel.",
          "",
          `channel: ${context.channel}`,
          ...context.conversationType ? [`conversation_type: ${context.conversationType}`] : [],
          ...context.senderDisplayName ? [`sender_display_name: ${context.senderDisplayName}`] : [],
          ...context.mentionedBot !== void 0 ? [`mentioned_bot: ${context.mentionedBot}`] : [],
          "",
          "Use SendChannelMessage to reply to the current conversation when needed.",
          "In IM, send a short acknowledgement before long work so the user does not think the bot is stuck.",
          "For longer tasks, send concise progress updates instead of waiting until every tool call has finished.",
          "Keep replies conversational and avoid exposing internal tool names unless they help the user."
        ];
        return this.#appendPersistent(lane, {
          type: "harness_item",
          id: asEventId(this.#createId()),
          parentId,
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          item: {
            kind: "channel_context",
            origin: "system",
            content: lines.join("\n"),
            visibility: "hidden",
            data: {
              extensionId: context.extensionId,
              channel: context.channel,
              externalConversationId: context.externalConversationId,
              ...context.conversationType ? { conversationType: context.conversationType } : {},
              ...context.mentionedBot !== void 0 ? { mentionedBot: context.mentionedBot } : {}
            }
          }
        });
      }
      async #scheduleMemoryDream(lane, clientId) {
        const memory = await this.#safeMemorySettingsForRuntime(lane, clientId);
        if (!memory.enabled || !memory.autoDream) {
          return;
        }
        const projectId = lane.project.projectId;
        const existing = this.#memoryDreams.get(projectId);
        if (existing?.timer) {
          clearTimeout(existing.timer);
        }
        const schedule = {
          running: existing?.running ?? false,
          sessionId: lane.session.header.sessionId,
          clientId,
          lastActivityAt: this.#now()
        };
        const delayMs = Math.max(0, memory.dreamIdleMinutes) * 60 * 1e3;
        const scheduledFor = this.#now() + delayMs;
        const currentState = await readMemoryDreamState({
          projectId: lane.project.projectId,
          homeDir: this.#memoryHomeDir,
          now: this.#now
        });
        await this.#writeMemoryDreamState(lane.project.projectId, {
          ...currentState ?? {},
          projectId: String(lane.project.projectId),
          dirty: true,
          running: schedule.running,
          sessionId: String(lane.session.header.sessionId),
          clientId: String(clientId),
          lastDailyAppendAt: currentState?.lastDailyAppendAt ?? schedule.lastActivityAt,
          scheduledFor
        });
        schedule.timer = setTimeout(() => {
          void this.#runIdleMemoryDream(projectId).catch((cause) => {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            void this.#appendDiagnostic(schedule.sessionId, "idle_memory_dream_failed", {
              clientId: schedule.clientId,
              message: error.message,
              stack: shortStack(error)
            });
          });
        }, delayMs);
        schedule.timer.unref?.();
        this.#memoryDreams.set(projectId, schedule);
        await this.#appendDiagnostic(lane.session.header.sessionId, "idle_memory_dream_scheduled", {
          clientId,
          projectId,
          idleMinutes: memory.dreamIdleMinutes
        });
      }
      async #markMemoryDreamDirty(lane, clientId, dailyPath) {
        const current = await readMemoryDreamState({
          projectId: lane.project.projectId,
          homeDir: this.#memoryHomeDir,
          now: this.#now
        });
        await this.#writeMemoryDreamState(lane.project.projectId, {
          projectId: String(lane.project.projectId),
          dirty: true,
          running: current?.running ?? false,
          sessionId: String(lane.session.header.sessionId),
          clientId: String(clientId),
          lastDailyAppendAt: this.#now(),
          lastDailyPath: dailyPath,
          lastFailure: current?.lastFailure,
          lastSuccessAt: current?.lastSuccessAt,
          lastProjectMemoryUpdateAt: current?.lastProjectMemoryUpdateAt,
          lastRootMemoryUpdateAt: current?.lastRootMemoryUpdateAt
        });
      }
      async #runIdleMemoryDream(projectId) {
        const schedule = this.#memoryDreams.get(projectId);
        if (!schedule || schedule.running) {
          return;
        }
        schedule.running = true;
        schedule.timer = void 0;
        this.#memoryDreams.set(projectId, schedule);
        const beforeRun = await readMemoryDreamState({
          projectId,
          homeDir: this.#memoryHomeDir,
          now: this.#now
        });
        await this.#writeMemoryDreamState(projectId, {
          ...beforeRun ?? { projectId: String(projectId), dirty: true },
          projectId: String(projectId),
          running: true,
          lastAttemptAt: this.#now()
        });
        try {
          const lane = await this.#getLane(schedule.sessionId);
          const memory = await this.#safeMemorySettingsForRuntime(lane, schedule.clientId);
          if (!memory.enabled || !memory.autoDream) {
            await this.#writeMemoryDreamState(projectId, {
              ...beforeRun ?? { projectId: String(projectId) },
              projectId: String(projectId),
              dirty: false,
              running: false,
              lastFailure: { at: this.#now(), message: "Memory dream disabled" }
            });
            return;
          }
          const generated = await this.#generateMemoryUpdate(lane, memory);
          const paths = scorelMemoryPaths({
            projectId: lane.project.projectId,
            homeDir: this.#memoryHomeDir,
            now: this.#now
          });
          if (generated?.projectMemory?.trim()) {
            await writeFile6(paths.projectMemoryPath, normalizeMarkdownFile2(generated.projectMemory), "utf8");
            await this.#appendDiagnostic(lane.session.header.sessionId, "project_memory_updated", {
              clientId: schedule.clientId,
              path: paths.projectMemoryPath
            });
          }
          if (memory.promoteRoot && generated?.rootMemory?.trim()) {
            await writeFile6(paths.rootMemoryPath, normalizeMarkdownFile2(generated.rootMemory), "utf8");
            await this.#appendDiagnostic(lane.session.header.sessionId, "root_memory_updated", {
              clientId: schedule.clientId,
              path: paths.rootMemoryPath
            });
          }
          const now = this.#now();
          const latestState = await readMemoryDreamState({ projectId, homeDir: this.#memoryHomeDir, now: this.#now });
          const hasNewDailyDuringRun = latestState?.lastDailyAppendAt !== void 0 && beforeRun?.lastDailyAppendAt !== void 0 && latestState.lastDailyAppendAt > beforeRun.lastDailyAppendAt;
          await this.#writeMemoryDreamState(projectId, {
            ...latestState ?? { projectId: String(projectId) },
            projectId: String(projectId),
            dirty: hasNewDailyDuringRun,
            running: false,
            ...hasNewDailyDuringRun ? {} : { scheduledFor: void 0 },
            lastSuccessAt: now,
            lastFailure: void 0,
            ...generated?.projectMemory?.trim() ? { lastProjectMemoryUpdateAt: now } : {},
            ...memory.promoteRoot && generated?.rootMemory?.trim() ? { lastRootMemoryUpdateAt: now } : {}
          });
          if (hasNewDailyDuringRun) {
            await this.#scheduleMemoryDream(lane, schedule.clientId);
          }
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          await this.#writeMemoryDreamState(projectId, {
            ...await readMemoryDreamState({ projectId, homeDir: this.#memoryHomeDir, now: this.#now }) ?? { projectId: String(projectId) },
            projectId: String(projectId),
            dirty: true,
            running: false,
            lastFailure: { at: this.#now(), message }
          });
          throw cause;
        } finally {
          this.#memoryDreams.delete(projectId);
        }
      }
      async #memoryStatusForProject(projectId) {
        const state = await readMemoryDreamState({
          projectId,
          homeDir: this.#memoryHomeDir,
          now: this.#now
        });
        await this.#recoverMemoryDream(projectId, state);
        const recovered = await readMemoryDreamState({
          projectId,
          homeDir: this.#memoryHomeDir,
          now: this.#now
        });
        return {
          projectId,
          dirty: recovered?.dirty ?? false,
          running: recovered?.running ?? false,
          ...recovered?.lastDailyAppendAt !== void 0 ? { lastDailyAppendAt: recovered.lastDailyAppendAt } : {},
          ...recovered?.lastDailyPath ? { lastDailyPath: recovered.lastDailyPath } : {},
          ...recovered?.scheduledFor !== void 0 ? { scheduledFor: recovered.scheduledFor } : {},
          ...recovered?.lastAttemptAt !== void 0 ? { lastAttemptAt: recovered.lastAttemptAt } : {},
          ...recovered?.lastSuccessAt !== void 0 ? { lastSuccessAt: recovered.lastSuccessAt } : {},
          ...recovered?.lastFailure ? { lastFailure: recovered.lastFailure } : {},
          ...recovered?.lastProjectMemoryUpdateAt !== void 0 ? { lastProjectMemoryUpdateAt: recovered.lastProjectMemoryUpdateAt } : {},
          ...recovered?.lastRootMemoryUpdateAt !== void 0 ? { lastRootMemoryUpdateAt: recovered.lastRootMemoryUpdateAt } : {}
        };
      }
      async #recoverMemoryDream(projectId, state) {
        if (!state?.dirty || this.#memoryDreams.has(projectId)) {
          return;
        }
        const lane = [...this.#sessions.values()].find((candidate) => candidate.project.projectId === projectId);
        if (!lane) {
          return;
        }
        const clientId = state.clientId ? asClientId(state.clientId) : asClientId("client_memory_recovery");
        await this.#scheduleMemoryDream(lane, clientId);
      }
      async #writeMemoryDreamState(projectId, state) {
        await writeMemoryDreamState({
          projectId,
          homeDir: this.#memoryHomeDir,
          now: this.#now,
          state
        });
      }
      async #generateMemoryUpdate(lane, memory) {
        const selectedModel = await this.#selectedModelFromMeta(
          { projectId: lane.project.projectId, modelSelection: { role: "auxiliary" } },
          lane.project
        );
        if (!selectedModel) {
          return void 0;
        }
        const context = await buildMemoryContext({
          projectId: lane.project.projectId,
          homeDir: this.#memoryHomeDir,
          now: this.#now
        });
        const runtime = await this.#createRuntime({
          sessionId: lane.session.header.sessionId,
          project: lane.project,
          selectedModel,
          purpose: "memory"
        });
        let raw = "";
        for await (const rawEvent of runtime.executeTurn(
          [{
            role: "user",
            content: [{
              type: "text",
              text: [
                "Consolidate Scorel filesystem memory from recent project daily notes.",
                "Return only strict JSON with optional keys: projectMemory, rootMemory.",
                "projectMemory: full replacement markdown for Project MEMORY.md, only durable project preferences/decisions/workflows/open questions.",
                memory.promoteRoot ? "rootMemory: full replacement markdown for root MEMORY.md, only cross-project stable user preferences. Omit if no global preference." : "Do not return rootMemory.",
                "Do not store secrets, transient tool noise, or code facts that can be read from the repo.",
                "Use daily notes as recent evidence, but only promote stable facts and decisions into memory.",
                "",
                "<root_memory>",
                context.rootMemory,
                "</root_memory>",
                "<project_memory>",
                context.projectMemory,
                "</project_memory>",
                "<recent_daily>",
                context.yesterdayDaily,
                "",
                context.todayDaily,
                "</recent_daily>"
              ].join("\n")
            }]
          }],
          "You are Scorel's automatic memory dreamer. Output strict JSON only.",
          {}
        )) {
          if (rawEvent.type === "text_delta") {
            raw += rawEvent.delta;
          } else if (rawEvent.type === "message_end") {
            raw = assistantText(rawEvent.message) || raw;
          } else if (rawEvent.type === "error") {
            throw rawEvent.error;
          }
        }
        return parseMemoryUpdate(raw);
      }
      async #appendSkillHarness(lane, clientId, kind, content) {
        await this.#appendPersistent(lane, {
          type: "harness_item",
          id: asEventId(this.#createId()),
          parentId: lane.session.activeLeafId,
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          item: {
            kind,
            origin: "system",
            content,
            visibility: "hidden"
          }
        });
      }
      #broadcastTransient(sessionId, event) {
        const withSeq = { ...event, seq: this.#nextSeq(sessionId) };
        this.#recordAndBroadcast(sessionId, withSeq);
        return withSeq;
      }
      #recordAndBroadcast(sessionId, event) {
        const events = this.#events.get(sessionId) ?? [];
        events.push(event);
        this.#events.set(sessionId, events);
        for (const connection of this.#connections) {
          if (connection.sessionId === sessionId) {
            connection.emit({ type: "event", event });
          }
        }
      }
      #nextSeq(sessionId) {
        const next = (this.#seqs.get(sessionId) ?? 0) + 1;
        this.#seqs.set(sessionId, next);
        return asSeq(next);
      }
      #eventsAfter(sessionId, fromSeq) {
        const from = Number(fromSeq ?? 0);
        return (this.#events.get(sessionId) ?? []).filter((event) => Number(event.seq) > from);
      }
      async #resyncEvents(sessionId, anchors) {
        if (!this.#seqs.has(sessionId)) {
          try {
            await this.#getLane(sessionId);
          } catch {
          }
        }
        const currentSeq = asSeq(this.#seqs.get(sessionId) ?? 0);
        const persistentLastSeq = anchors.persistentLastSeq ?? asSeq(0);
        const streamLastSeq = anchors.streamLastSeq ?? persistentLastSeq;
        if (Number(streamLastSeq) >= Number(currentSeq)) {
          const result2 = {
            events: [],
            throughSeq: currentSeq,
            mode: "stream_resume"
          };
          await this.#appendDiagnostic(sessionId, "resync_events", {
            mode: result2.mode,
            persistentLastSeq,
            streamLastSeq,
            throughSeq: result2.throughSeq,
            eventCount: result2.events.length
          });
          return result2;
        }
        const buffered = this.#eventsAfter(sessionId, streamLastSeq);
        if (hasContinuousCoverage(buffered, Number(streamLastSeq) + 1)) {
          const result2 = {
            events: buffered,
            throughSeq: buffered.at(-1)?.seq ?? streamLastSeq,
            mode: "stream_resume"
          };
          await this.#appendDiagnostic(sessionId, "resync_events", {
            mode: result2.mode,
            persistentLastSeq,
            streamLastSeq,
            throughSeq: result2.throughSeq,
            eventCount: result2.events.length
          });
          return result2;
        }
        const lane = await this.#getLane(sessionId);
        const events = [...lane.session.tree].filter((event) => Number(event.seq) > Number(persistentLastSeq));
        const throughSeq = events.at(-1)?.seq ?? persistentLastSeq;
        const mode = Number(persistentLastSeq) === 0 && Number(streamLastSeq) === 0 ? "full_reload" : "persistent_fallback";
        const result = {
          events,
          throughSeq,
          mode,
          gapFromSeq: asSeq(Number(streamLastSeq) + 1),
          gapToSeq: currentSeq
        };
        await this.#appendDiagnostic(sessionId, "resync_events", {
          mode: result.mode,
          persistentLastSeq,
          streamLastSeq,
          throughSeq: result.throughSeq,
          eventCount: result.events.length,
          gapFromSeq: result.gapFromSeq,
          gapToSeq: result.gapToSeq
        });
        return result;
      }
      async #getLane(sessionId) {
        const existing = this.#sessions.get(sessionId);
        if (existing) {
          return existing;
        }
        const loaded = await loadSession({ sessionsDir: this.#sessionsDir, sessionId });
        const project = await this.#resolveProject(sessionId, loaded.header.meta.projectId);
        const selectedModel = await this.#selectedModelFromMeta(loaded.header.meta, project);
        const runtime = await this.#createRuntime({ sessionId, project, selectedModel, purpose: "chat" });
        await this.#appendDiagnostic(sessionId, "runtime_created", {
          projectId: project.projectId,
          workDir: project.workDir,
          selectedModelId: selectedModel?.modelId
        });
        const lane = {
          session: loaded,
          project,
          runtime,
          queue: Promise.resolve(),
          appendQueue: Promise.resolve(),
          followUpWaiters: /* @__PURE__ */ new Map()
        };
        this.#registerLaneTools(lane);
        this.#sessions.set(sessionId, lane);
        this.#seqs.set(sessionId, Number(loaded.currentSeq));
        return lane;
      }
      async #loadExistingLaneIfPresent(sessionId) {
        if (this.#sessions.has(sessionId)) {
          return true;
        }
        try {
          await this.#getLane(sessionId);
          return true;
        } catch (cause) {
          if (isNodeErrorCode4(cause, "ENOENT")) {
            return false;
          }
          throw cause;
        }
      }
      async #createLane(sessionId, meta, project) {
        const selectedModel = await this.#selectedModelFromMeta(meta, project);
        const session = await createSession({
          sessionsDir: this.#sessionsDir,
          header: {
            version: 1,
            sessionId,
            deviceId: this.#deviceId,
            createdAt: this.#now(),
            meta: {
              ...meta,
              ...selectedModel ? {
                model: selectedModel.displayName,
                selectedModel
              } : {}
            }
          }
        });
        const runtime = await this.#createRuntime({ sessionId, project, selectedModel, purpose: "chat" });
        await this.#appendDiagnostic(sessionId, "runtime_created", {
          projectId: project.projectId,
          workDir: project.workDir,
          selectedModelId: selectedModel?.modelId
        });
        const lane = {
          session,
          project,
          runtime,
          queue: Promise.resolve(),
          appendQueue: Promise.resolve(),
          followUpWaiters: /* @__PURE__ */ new Map()
        };
        this.#registerLaneTools(lane);
        return lane;
      }
      #registerLaneTools(lane) {
        lane.runtime.registerTool(
          createSkillTool({
            getEntry: (name) => lane.session.tree.controlState.skillIndex[name],
            listNames: () => Object.keys(lane.session.tree.controlState.skillIndex).sort()
          })
        );
      }
      #syncChannelTool(lane, channelContext) {
        if (!channelContext) {
          lane.runtime.unregisterTool("SendChannelMessage");
          return;
        }
        lane.runtime.registerTool(
          createSendChannelMessageTool({
            sendCurrent: async (input) => {
              const current = lane.channelContext;
              if (!current) {
                throw new Error("no_channel_context");
              }
              if (input.channel && input.channel !== current.channel) {
                throw new Error(`channel_mismatch: current channel is ${current.channel}`);
              }
              const extension = this.#imExtensions.get(current.extensionId);
              if (!extension) {
                throw new Error(`channel_adapter_unavailable: ${current.extensionId}`);
              }
              await extension.adapter.sendMessage(current.target, {
                ...input.text ? { text: input.text } : {},
                ...input.attachments ? { attachments: input.attachments } : {}
              });
              await this.#appendDiagnostic(lane.session.header.sessionId, "channel_message_sent", {
                extensionId: current.extensionId,
                channel: current.channel,
                externalConversationId: current.externalConversationId,
                attachments: input.attachments?.length ?? 0
              });
              return { channel: current.channel, target: "current", attachments: input.attachments?.length ?? 0 };
            }
          })
        );
      }
      async #startEnabledImExtensions() {
        const config = await this.#loadUserConfigProfile();
        const enabled = Object.entries(config?.extensions ?? {}).filter(([, extension]) => extension.enabled && extension.kind === "im").map(([extensionId]) => extensionId);
        if (enabled.length === 0) {
          return;
        }
        const manifests = await this.#discoverExtensionManifests();
        for (const extensionId of enabled) {
          const manifest = manifests.get(extensionId);
          if (!manifest) {
            await this.#appendHostDiagnostic("im_extension_missing", { extensionId });
            continue;
          }
          let adapter;
          try {
            adapter = await this.#loadImAdapter(manifest, config?.extensions[extensionId]?.config ?? {});
          } catch (cause) {
            await this.#appendHostDiagnostic("im_extension_load_failed", {
              extensionId,
              message: cause instanceof Error ? cause.message : String(cause)
            });
            continue;
          }
          const extension = {
            manifest,
            adapter,
            skillRoots: manifest.skills.map((path) => resolve5(manifest.rootDir, path))
          };
          let started = false;
          await adapter.start({
            onMessage: async (message) => {
              await this.#handleImMessage(extension, message);
            },
            logger: {
              info: (message, data) => void this.#appendHostDiagnostic("im_extension_info", { extensionId, message, ...data }),
              error: (message, data) => void this.#appendHostDiagnostic("im_extension_error", { extensionId, message, ...data })
            }
          }).then(() => {
            started = true;
          }).catch(async (cause) => {
            await this.#appendHostDiagnostic("im_extension_start_failed", {
              extensionId,
              message: cause instanceof Error ? cause.message : String(cause)
            });
            return void 0;
          });
          if (!started) {
            continue;
          }
          this.#imExtensions.set(extensionId, extension);
          await this.#appendHostDiagnostic("im_extension_started", { extensionId });
        }
      }
      async #stopImExtensions() {
        for (const extension of this.#imExtensions.values()) {
          await extension.adapter.stop().catch((cause) => {
            void this.#appendHostDiagnostic("im_extension_stop_failed", {
              extensionId: extension.manifest.id,
              message: cause instanceof Error ? cause.message : String(cause)
            });
          });
        }
        this.#imExtensions.clear();
      }
      async #discoverExtensionManifests() {
        const roots = [
          this.#builtinExtensionsDir,
          join10(this.#scorelHomeDir, "extensions")
        ];
        const manifests = /* @__PURE__ */ new Map();
        for (const root of roots) {
          let children;
          try {
            children = await readdir6(root);
          } catch (cause) {
            if (isNodeErrorCode4(cause, "ENOENT") || isNodeErrorCode4(cause, "ENOTDIR")) {
              continue;
            }
            throw cause;
          }
          for (const child of children.sort()) {
            const manifestPath = join10(root, child, "scorel.extension.json");
            try {
              const manifest = await loadExtensionManifest(manifestPath);
              manifests.set(manifest.id, manifest);
            } catch (cause) {
              await this.#appendHostDiagnostic("extension_manifest_invalid", {
                path: manifestPath,
                message: cause instanceof Error ? cause.message : String(cause)
              });
            }
          }
        }
        return manifests;
      }
      async #loadImAdapter(manifest, config) {
        const adapterPath = resolve5(manifest.rootDir, manifest.adapter);
        const mod = await import(pathToFileURL(adapterPath).href);
        const adapter = mod.createAdapter ? await mod.createAdapter({ config, manifest }) : mod.default;
        if (!adapter || typeof adapter.start !== "function" || typeof adapter.stop !== "function" || typeof adapter.sendMessage !== "function") {
          throw new Error(`IM adapter ${adapterPath} must export createAdapter() or default adapter with start/stop/sendMessage`);
        }
        return adapter;
      }
      async #handleImMessage(extension, message) {
        const binding = await this.#ensureImBinding(extension.manifest.id, message.externalConversationId);
        const lane = await this.#getLane(binding.sessionId);
        const runningBehavior = isSteerMessage(message.text) ? "steer" : "follow_up";
        const content = stripImCommandPrefix(message.text);
        const channelContext = {
          channel: extension.manifest.id,
          externalConversationId: message.externalConversationId,
          ...message.conversationType ? { conversationType: message.conversationType } : {},
          ...message.senderDisplayName ? { senderDisplayName: message.senderDisplayName } : {},
          ...message.mentionedBot !== void 0 ? { mentionedBot: message.mentionedBot } : {},
          data: message.target?.data ?? message.data ?? {}
        };
        await this.#handleSendMessage(
          { clientId: asClientId(`im_${extension.manifest.id}`), emit: () => void 0 },
          {
            type: "send_message",
            requestId: asRequestId(`req_im_${this.#createId()}`),
            sessionId: lane.session.header.sessionId,
            content,
            options: {
              runningBehavior,
              channelContext
            }
          }
        );
        return lane.session.header.sessionId;
      }
      async #ensureImBinding(extensionId, externalConversationId) {
        const key = imBindingKey(extensionId, externalConversationId);
        const existing = this.#imBindings.get(key);
        if (existing) {
          existing.updatedAt = this.#now();
          await this.#saveImBindings();
          return existing;
        }
        const project = await this.#ensureDefaultWorkspaceProject();
        const sessionId = asSessionId(`ses_${this.#createId()}`);
        const lane = await this.#createLane(sessionId, {
          projectId: project.projectId,
          title: `${extensionId}: ${externalConversationId}`
        }, project);
        this.#sessions.set(sessionId, lane);
        this.#events.set(sessionId, []);
        this.#seqs.set(sessionId, 0);
        const binding = {
          extensionId,
          externalConversationId,
          projectId: project.projectId,
          sessionId,
          createdAt: this.#now(),
          updatedAt: this.#now()
        };
        this.#imBindings.set(key, binding);
        await this.#saveImBindings();
        await this.#appendDiagnostic(sessionId, "im_session_bound", {
          extensionId,
          externalConversationId,
          projectId: project.projectId
        });
        this.#onSessionListChanged?.({ projectId: project.projectId, sessionId });
        return binding;
      }
      async #ensureDefaultWorkspaceProject() {
        const workspace = join10(this.#scorelHomeDir, "workspace");
        await mkdir6(workspace, { recursive: true });
        return this.registerProject(workspace);
      }
      #extensionSkillRoots() {
        return [...this.#imExtensions.values()].flatMap(
          (extension) => extension.skillRoots.map((path) => ({ path, extensionId: extension.manifest.id }))
        );
      }
      async #loadImBindings() {
        try {
          const text = await readFile11(this.#imBindingsPath(), "utf8");
          const value = JSON.parse(text);
          for (const binding of value.bindings ?? []) {
            this.#imBindings.set(imBindingKey(binding.extensionId, binding.externalConversationId), binding);
          }
        } catch (cause) {
          if (!isNodeErrorCode4(cause, "ENOENT")) {
            throw cause;
          }
        }
      }
      async #saveImBindings() {
        const path = this.#imBindingsPath();
        await mkdir6(dirname8(path), { recursive: true });
        await writeFile6(path, `${JSON.stringify({ bindings: [...this.#imBindings.values()] }, null, 2)}
`, "utf8");
      }
      #imBindingsPath() {
        return join10(this.#scorelHomeDir, "channels", "im-bindings.json");
      }
      async #loadUserConfigProfile() {
        try {
          return await loadScorelConfigProfile({ cwd: this.#userHomeDir, homeDir: this.#userHomeDir });
        } catch (cause) {
          if (isMissingConfigError(cause)) {
            return void 0;
          }
          throw cause;
        }
      }
      async #listModels(projectId) {
        let config;
        try {
          config = await this.#configProfileForProject(projectId);
        } catch (cause) {
          if (!isMissingConfigError(cause)) {
            throw cause;
          }
          config = void 0;
        }
        if (!config) {
          return {
            providers: [],
            providerModels: [],
            models: [],
            roles: {
              primary: "",
              standard: "",
              auxiliary: ""
            }
          };
        }
        const configWarnings = "warnings" in config ? config.warnings : void 0;
        return {
          providers: listProviderConnections(config),
          providerModels: listProviderModels(config),
          models: listAvailableModels(config),
          roles: config.modelProfile.roles,
          ...configWarnings ? { warnings: configWarnings } : {}
        };
      }
      async #handleUpsertModelProfile(request) {
        const project = await this.#registry.require(request.projectId);
        const configPath = join10(project.workDir, ".scorel", "config.toml");
        let existingConfigText;
        try {
          existingConfigText = await readFile11(configPath, "utf8");
        } catch (cause) {
          if (!isNodeErrorCode4(cause, "ENOENT")) {
            throw cause;
          }
        }
        await mkdir6(join10(project.workDir, ".scorel"), { recursive: true });
        await writeFile6(
          configPath,
          renderModelProfileConfig({
            providerId: request.providerId,
            providerType: request.providerType,
            provider: request.provider,
            apiKeyEnv: request.apiKeyEnv,
            apiKey: request.apiKey,
            api: request.api,
            baseUrl: request.baseUrl,
            modelId: request.modelId,
            providerModelKey: request.providerModelKey,
            availableModelId: request.availableModelId,
            addToAvailable: request.addToAvailable,
            removeAvailableModelId: request.removeAvailableModelId,
            providerModelId: request.providerModelId,
            displayName: request.displayName,
            contextWindow: request.contextWindow,
            maxTokens: request.maxTokens,
            reasoning: request.reasoning,
            supportsDeveloperRole: request.supportsDeveloperRole,
            supportsImageInput: request.supportsImageInput,
            roles: request.roles,
            existingConfigText
          }),
          "utf8"
        );
        await this.#appendHostDiagnostic("model_profile_upserted", {
          projectId: project.projectId,
          workDir: project.workDir,
          providerId: request.providerId,
          modelId: request.modelId
        });
        return this.#listModels(project.projectId);
      }
      async #handleRemoveModelProvider(request) {
        const project = await this.#registry.require(request.projectId);
        const configPath = join10(project.workDir, ".scorel", "config.toml");
        let existingConfigText;
        try {
          existingConfigText = await readFile11(configPath, "utf8");
        } catch (cause) {
          if (!isNodeErrorCode4(cause, "ENOENT")) {
            throw cause;
          }
        }
        await mkdir6(join10(project.workDir, ".scorel"), { recursive: true });
        await writeFile6(
          configPath,
          renderModelProfileConfig({
            removeProviderId: request.providerId,
            existingConfigText
          }),
          "utf8"
        );
        const profile = await this.#listModels(project.projectId);
        return { ...profile, removed: true };
      }
      async #memorySettingsForProject(projectId) {
        const config = await this.#configProfileForProject(projectId).catch((cause) => {
          if (isMissingConfigError(cause)) {
            return void 0;
          }
          throw cause;
        });
        return config?.memory ?? disabledMemorySettings();
      }
      async #safeMemorySettingsForRuntime(lane, clientId) {
        try {
          return await this.#memorySettingsForProject(lane.project.projectId);
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          await this.#appendDiagnostic(lane.session.header.sessionId, "memory_settings_unavailable", {
            clientId,
            message: error.message,
            stack: shortStack(error)
          });
          return disabledMemorySettings();
        }
      }
      async #handleUpsertMemorySettings(request) {
        const project = await this.#registry.require(request.projectId);
        const configPath = join10(project.workDir, ".scorel", "config.toml");
        let existingConfigText;
        try {
          existingConfigText = await readFile11(configPath, "utf8");
        } catch (cause) {
          if (!isNodeErrorCode4(cause, "ENOENT")) {
            throw cause;
          }
        }
        await mkdir6(join10(project.workDir, ".scorel"), { recursive: true });
        await writeFile6(
          configPath,
          renderMemoryConfig({
            enabled: request.enabled,
            daily: request.daily,
            sessionMemory: request.sessionMemory,
            autoDream: request.autoDream,
            promoteRoot: request.promoteRoot,
            dreamIdleMinutes: request.dreamIdleMinutes,
            autoCompactThreshold: request.autoCompactThreshold,
            existingConfigText
          }),
          "utf8"
        );
        await this.#appendHostDiagnostic("memory_settings_upserted", {
          projectId: project.projectId,
          workDir: project.workDir
        });
        return this.#memorySettingsForProject(project.projectId);
      }
      async #runtimeSettingsForProject(projectId, installStatus) {
        const config = await this.#configProfileForProject(projectId).catch((cause) => {
          if (isMissingConfigError(cause)) {
            return void 0;
          }
          throw cause;
        });
        const detected = await detectRtk();
        const savings = await readRuntimeStats(this.#runtimeStatsPath());
        return {
          tokenSavingRtk: config?.runtime.tokenSavingRtk ?? false,
          rtkAvailable: detected.available,
          ...detected.executable ? { rtkExecutable: detected.executable } : {},
          ...detected.version ? { rtkVersion: detected.version } : {},
          ...installStatus?.installStatus ? { installStatus: installStatus.installStatus } : {},
          ...installStatus?.installMessage ? { installMessage: installStatus.installMessage } : {},
          estimatedOutputTokens: savings.rtk.outputTokens,
          estimatedSavedTokens: savings.rtk.savedTokens
        };
      }
      async #handleUpsertRuntimeSettings(request) {
        const project = await this.#registry.require(request.projectId);
        const configPath = join10(project.workDir, ".scorel", "config.toml");
        let existingConfigText;
        try {
          existingConfigText = await readFile11(configPath, "utf8");
        } catch (cause) {
          if (!isNodeErrorCode4(cause, "ENOENT")) {
            throw cause;
          }
        }
        await mkdir6(join10(project.workDir, ".scorel"), { recursive: true });
        await writeFile6(
          configPath,
          renderRuntimeConfig({
            tokenSavingRtk: request.tokenSavingRtk,
            existingConfigText
          }),
          "utf8"
        );
        const installResult = request.tokenSavingRtk === true ? await ensureRtkAvailable() : { status: "idle" };
        await this.#appendHostDiagnostic("runtime_settings_upserted", {
          projectId: project.projectId,
          workDir: project.workDir,
          tokenSavingRtk: request.tokenSavingRtk,
          installStatus: installResult.status
        });
        return this.#runtimeSettingsForProject(project.projectId, {
          installStatus: installResult.status,
          ...installResult.message ? { installMessage: installResult.message } : {}
        });
      }
      async #extensionSettings(extensionId) {
        const config = await this.#loadUserConfigProfile().catch((cause) => {
          if (isMissingConfigError(cause)) {
            return void 0;
          }
          throw cause;
        });
        const extension = config?.extensions[extensionId];
        return {
          extensionId,
          enabled: extension?.enabled ?? false,
          kind: "im",
          config: extension?.config ?? {},
          active: this.#imExtensions.has(extensionId)
        };
      }
      async #handleUpsertExtensionSettings(request) {
        const configPath = join10(this.#scorelHomeDir, "config.toml");
        let existingConfigText;
        try {
          existingConfigText = await readFile11(configPath, "utf8");
        } catch (cause) {
          if (!isNodeErrorCode4(cause, "ENOENT")) {
            throw cause;
          }
        }
        await mkdir6(this.#scorelHomeDir, { recursive: true });
        await writeFile6(
          configPath,
          renderExtensionConfig({
            extensionId: request.extensionId,
            enabled: request.enabled,
            kind: request.kind,
            config: request.config,
            existingConfigText
          }),
          "utf8"
        );
        await this.#appendHostDiagnostic("extension_settings_upserted", {
          extensionId: request.extensionId,
          enabled: request.enabled
        });
        await this.refreshImExtensions();
        return this.#extensionSettings(request.extensionId);
      }
      async #fetchProviderModels(projectId, providerId) {
        const project = await this.#registry.require(projectId);
        const config = await loadScorelConfigProfile({ cwd: project.workDir, includeSecrets: true });
        if (!config) {
          throw new Error("Model profile config is not configured");
        }
        const provider = config.providers[providerId];
        if (!provider) {
          throw new Error(`Provider is not configured: ${providerId}`);
        }
        if (provider.type !== "custom" || provider.api !== "openai-completions" && provider.api !== "openai-responses") {
          throw new Error("Provider catalog fetch currently supports custom OpenAI-compatible providers only");
        }
        if (!provider.baseUrl) {
          throw new Error(`providers.${providerId}.baseUrl is required`);
        }
        const apiKeyEnv = "apiKeyEnv" in provider ? provider.apiKeyEnv : void 0;
        const apiKey = provider.apiKey || (apiKeyEnv ? process.env[apiKeyEnv] : void 0);
        if (!apiKey) {
          throw new Error(apiKeyEnv ? `${apiKeyEnv} is not set` : "Provider API key is not configured");
        }
        const endpoint = `${provider.baseUrl.replace(/\/+$/, "")}/models`;
        const response = await fetch(endpoint, {
          headers: {
            authorization: `Bearer ${apiKey}`
          }
        });
        if (!response.ok) {
          throw new Error(`Provider /models request failed: ${response.status} ${response.statusText}`);
        }
        const payload = await response.json();
        const rawModels = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
        return rawModels.map((model) => {
          const id = typeof model.id === "string" ? model.id : "";
          const name = typeof model.name === "string" ? model.name : id;
          return id ? { id, displayName: name || id } : void 0;
        }).filter((model) => Boolean(model)).sort((left, right) => left.id.localeCompare(right.id));
      }
      async #selectedModelFromMeta(meta, project) {
        const config = await this.#configForProject(project.projectId);
        if (!config) {
          return "selectedModel" in meta ? meta.selectedModel : void 0;
        }
        const persistedSelection = "selectedModel" in meta ? meta.selectedModel : void 0;
        const requestedSelection = "modelSelection" in meta ? meta.modelSelection : void 0;
        const selection = resolveModelSelection(
          config,
          persistedSelection ? { modelId: persistedSelection.modelId, role: persistedSelection.role } : requestedSelection
        );
        const model = resolvePiAiModel(selection.config);
        return {
          modelId: selection.modelId,
          role: selection.role,
          providerId: selection.providerId,
          provider: model.provider,
          id: model.id,
          displayName: selection.displayName,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          reasoning: model.reasoning,
          supportsImageInput: model.input.includes("image")
        };
      }
      async #configForProject(projectId) {
        if (this.#loadConfig) {
          if (!projectId) {
            return this.#modelProfile;
          }
          const project = await this.#registry.require(projectId);
          return this.#loadConfig({ project });
        }
        return this.#modelProfile;
      }
      async #configProfileForProject(projectId) {
        if (this.#loadConfigProfile) {
          if (!projectId) {
            return this.#modelProfile;
          }
          const project = await this.#registry.require(projectId);
          return this.#loadConfigProfile({ project });
        }
        if (this.#loadConfig) {
          if (!projectId) {
            return this.#modelProfile;
          }
          const project = await this.#registry.require(projectId);
          try {
            return await loadScorelConfigProfile({ cwd: project.workDir });
          } catch (cause) {
            if (!isMissingConfigError(cause)) {
              throw cause;
            }
          }
        }
        return this.#modelProfile;
      }
      #respond(connection, request, data) {
        connection.emit({
          type: "response",
          requestType: request.type,
          requestId: request.requestId,
          ok: true,
          data
        });
      }
      #assertStarted() {
        if (!this.#started) {
          throw new Error("ScorelHost is not started");
        }
      }
      async #appendDiagnostic(sessionId, event, fields = {}) {
        const line = formatDiagnosticLine({
          ts: this.#now(),
          level: event.endsWith("_error") || event.endsWith("_failed") ? "error" : "info",
          event,
          sessionId,
          ...fields
        });
        await mkdir6(this.#sessionsDir, { recursive: true });
        await appendFile3(sessionLogFilePath(this.#sessionsDir, sessionId), `${line}
`, "utf8");
      }
      async #appendHostDiagnostic(event, fields = {}) {
        const line = formatDiagnosticLine({ ts: this.#now(), level: "info", event, ...fields });
        await mkdir6(this.#sessionsDir, { recursive: true });
        await appendFile3(join10(this.#sessionsDir, "host.log"), `${line}
`, "utf8");
      }
      #runtimeStatsPath() {
        return join10(this.#scorelHomeDir, "runtime-stats.json");
      }
      async #recordRtkSavings(input) {
        const updateTask = this.#runtimeStatsQueue.then(async () => {
          const path = this.#runtimeStatsPath();
          const stats = await readRuntimeStats(path);
          addRtkSavings(stats, String(input.projectId), String(input.sessionId), input.savings);
          await writeRuntimeStats(path, stats);
        });
        this.#runtimeStatsQueue = updateTask.catch(() => {
        });
        await updateTask;
      }
      async #resolveProject(sessionId, projectId) {
        const project = await this.#registry.require(projectId);
        await this.#appendDiagnostic(sessionId, "project_resolved", {
          projectId: project.projectId,
          workDir: project.workDir
        });
        return project;
      }
    };
    isMissingConfigError = (cause) => cause instanceof Error && cause.message.startsWith("Scorel config not found:");
    createEmbeddedTransport = (host) => {
      const handlers = /* @__PURE__ */ new Set();
      const connection = {
        clientId: asClientId("embedded_unconnected"),
        emit: (message) => {
          for (const handler of handlers) {
            handler(message);
          }
        }
      };
      return {
        async connect(params) {
          connection.clientId = params.clientId;
          const result = host.connect(connection, params.sessionId);
          connection.emit({
            type: "connected",
            clientId: params.clientId,
            sessionId: result.sessionId,
            currentSeq: result.currentSeq,
            deviceId: result.deviceId,
            deviceDisplayName: result.deviceDisplayName
          });
          return {
            clientId: params.clientId,
            sessionId: result.sessionId,
            currentSeq: result.currentSeq,
            deviceId: result.deviceId,
            deviceDisplayName: result.deviceDisplayName
          };
        },
        send(message) {
          return host.handleMessage(connection, message);
        },
        onMessage(handler) {
          handlers.add(handler);
          return () => {
            handlers.delete(handler);
          };
        },
        close() {
          host.disconnect(connection);
          handlers.clear();
        }
      };
    };
    isNodeErrorCode4 = (cause, code) => cause instanceof Error && "code" in cause && cause.code === code;
    wireErrorCode = (cause) => {
      if (!(cause instanceof ProjectRegistryError)) {
        return "internal_error";
      }
      return cause.code;
    };
    hasContinuousCoverage = (events, expectedFirstSeq) => {
      if (events.length === 0) {
        return false;
      }
      let expected = expectedFirstSeq;
      for (const event of events) {
        if (Number(event.seq) !== expected) {
          return false;
        }
        expected += 1;
      }
      return true;
    };
    countContentBlocks = (message, type) => message.content.filter((block) => block.type === type).length;
    normalizeContent = (content) => typeof content === "string" ? [{ type: "text", text: content }] : content;
    inputText = (message) => message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
    assistantText = (message) => message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
    messageText = (message) => {
      const text = message.content.map((block) => {
        if (block.type === "text") {
          return block.text;
        }
        if (block.type === "thinking") {
          return `[thinking] ${block.text}`;
        }
        if (block.type === "tool_call") {
          return `[tool_call:${block.toolName}] ${JSON.stringify(block.args)}`;
        }
        if (block.type === "tool_result") {
          return `[tool_result:${block.toolName}] ${JSON.stringify(block.result)}`;
        }
        return "";
      }).filter(Boolean).join("\n").trim();
      return text || "(empty)";
    };
    estimateScorelMessagesTokens = (messages) => estimateTextTokens(messages.map(messageText).join("\n"));
    estimateTextTokens = (value) => Math.ceil(value.length / 3);
    compactLine2 = (value, maxChars) => value.replace(/\s+/g, " ").trim().slice(0, maxChars);
    parseSessionMemoryJson = (raw) => {
      const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      if (!text) {
        return void 0;
      }
      const parsed = JSON.parse(text);
      if (!isRecord8(parsed)) {
        return void 0;
      }
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary : void 0,
        recentMessages: stringArray(parsed.recentMessages),
        decisions: stringArray(parsed.decisions),
        followUps: stringArray(parsed.followUps)
      };
    };
    stringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : void 0;
    disabledMemorySettings = () => ({
      enabled: false,
      daily: false,
      sessionMemory: false,
      autoDream: false,
      promoteRoot: false,
      dreamIdleMinutes: 60,
      autoCompactThreshold: 0.8
    });
    detectRtk = async () => {
      try {
        const shell = resolveDefaultShell2();
        const path = (await execFileAsync2(shell, shellCommandArgs2(shell, "command -v rtk"), { timeout: 5e3 })).stdout.trim();
        if (!path) {
          return { available: false };
        }
        const version = await execFileAsync2(path, ["--version"], { timeout: 5e3 }).then((result) => result.stdout.trim() || result.stderr.trim()).catch(() => void 0);
        return {
          available: true,
          executable: path,
          ...version ? { version } : {}
        };
      } catch {
        return { available: false };
      }
    };
    ensureRtkAvailable = async () => {
      const existing = await detectRtk();
      if (existing.available) {
        return { status: "installed", message: existing.version ?? existing.executable };
      }
      const shell = resolveDefaultShell2();
      const brew = await execFileAsync2(shell, shellCommandArgs2(shell, "command -v brew"), { timeout: 5e3 }).then((result) => result.stdout.trim()).catch(() => "");
      if (!brew) {
        return { status: "failed", message: "Homebrew is not available; install RTK manually with `brew install rtk`." };
      }
      try {
        await execFileAsync2(brew, ["install", "rtk"], { timeout: 12e4, maxBuffer: 2e7 });
        const installed = await detectRtk();
        return installed.available ? { status: "installed", message: installed.version ?? installed.executable } : { status: "failed", message: "RTK install finished but `rtk` is still not on PATH." };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return { status: "failed", message };
      }
    };
    emptyRuntimeStats = () => ({
      version: 1,
      rtk: {
        outputTokens: 0,
        savedTokens: 0,
        byProject: {},
        bySession: {}
      }
    });
    readRuntimeStats = async (path) => {
      try {
        return parseRuntimeStats(JSON.parse(await readFile11(path, "utf8")));
      } catch (cause) {
        if (isNodeErrorCode4(cause, "ENOENT")) {
          return emptyRuntimeStats();
        }
        return emptyRuntimeStats();
      }
    };
    writeRuntimeStats = async (path, stats) => {
      await mkdir6(dirname8(path), { recursive: true });
      const tempPath = join10(dirname8(path), `.runtime-stats-${process.pid}-${Date.now()}.tmp`);
      try {
        await writeFile6(tempPath, `${JSON.stringify(stats, null, 2)}
`, "utf8");
        await rename3(tempPath, path);
      } catch (cause) {
        await rm2(tempPath, { force: true }).catch(() => void 0);
        throw cause;
      }
    };
    parseRuntimeStats = (value) => {
      if (!isRecord8(value) || !isRecord8(value.rtk)) {
        return emptyRuntimeStats();
      }
      return {
        version: 1,
        rtk: {
          outputTokens: nonNegativeInteger2(value.rtk.outputTokens),
          savedTokens: nonNegativeInteger2(value.rtk.savedTokens),
          byProject: parseRuntimeStatsBuckets(value.rtk.byProject),
          bySession: parseRuntimeStatsBuckets(value.rtk.bySession)
        }
      };
    };
    parseRuntimeStatsBuckets = (value) => {
      if (!isRecord8(value)) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, bucket]) => [
          key,
          isRecord8(bucket) ? {
            outputTokens: nonNegativeInteger2(bucket.outputTokens),
            savedTokens: nonNegativeInteger2(bucket.savedTokens)
          } : { outputTokens: 0, savedTokens: 0 }
        ])
      );
    };
    addRtkSavings = (stats, projectId, sessionId, savings) => {
      addRuntimeStatsBucket(stats.rtk, savings);
      stats.rtk.byProject[projectId] = addRuntimeStatsBucket(stats.rtk.byProject[projectId] ?? { outputTokens: 0, savedTokens: 0 }, savings);
      stats.rtk.bySession[sessionId] = addRuntimeStatsBucket(stats.rtk.bySession[sessionId] ?? { outputTokens: 0, savedTokens: 0 }, savings);
    };
    addRuntimeStatsBucket = (bucket, savings) => {
      bucket.outputTokens += savings.outputTokens;
      bucket.savedTokens += savings.savedTokens;
      return bucket;
    };
    rtkSavingsFromToolResult = (result) => {
      if (!isRecord8(result) || !isRecord8(result.details)) {
        return void 0;
      }
      const rtk = result.details.rtk;
      if (!isRecord8(rtk) || rtk.applied !== true) {
        return void 0;
      }
      const outputTokens = nonNegativeInteger2(rtk.estimatedOutputTokens);
      const savedTokens = nonNegativeInteger2(rtk.estimatedSavedTokens);
      return outputTokens > 0 || savedTokens > 0 ? { outputTokens, savedTokens } : void 0;
    };
    nonNegativeInteger2 = (value) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return 0;
      }
      return Math.floor(value);
    };
    resolveDefaultShell2 = () => {
      const shell = process.env.SHELL || userShell2() || "/bin/sh";
      return shell.trim() || "/bin/sh";
    };
    shellCommandArgs2 = (shell, command) => {
      const name = basename3(shell).toLowerCase();
      if (name === "csh" || name === "tcsh" || name === "fish") {
        return ["-c", command];
      }
      return ["-lc", command];
    };
    userShell2 = () => {
      try {
        return userInfo2().shell ?? void 0;
      } catch {
        return void 0;
      }
    };
    runtimeChannelContextFromWire = (context) => ({
      extensionId: context.channel,
      channel: context.channel,
      externalConversationId: context.externalConversationId,
      target: {
        externalConversationId: context.externalConversationId,
        data: context.data
      },
      ...context.conversationType ? { conversationType: context.conversationType } : {},
      ...context.senderDisplayName ? { senderDisplayName: context.senderDisplayName } : {},
      ...context.mentionedBot !== void 0 ? { mentionedBot: context.mentionedBot } : {},
      ...context.data ? { data: context.data } : {}
    });
    parseQueuedChannelContext = (value) => {
      if (!isRecord8(value)) {
        return void 0;
      }
      if (typeof value.channel !== "string" || typeof value.externalConversationId !== "string") {
        return void 0;
      }
      return runtimeChannelContextFromWire({
        channel: value.channel,
        externalConversationId: value.externalConversationId,
        ...typeof value.conversationType === "string" ? { conversationType: value.conversationType } : {},
        ...typeof value.senderDisplayName === "string" ? { senderDisplayName: value.senderDisplayName } : {},
        ...typeof value.mentionedBot === "boolean" ? { mentionedBot: value.mentionedBot } : {},
        ...isRecord8(value.data) ? { data: value.data } : {}
      });
    };
    imBindingKey = (extensionId, externalConversationId) => `${extensionId}:${externalConversationId}`;
    defaultBuiltinExtensionsDir = () => findBuiltinExtensionsDir([
      runtimeModuleDir(),
      process.cwd()
    ]);
    runtimeModuleDir = () => {
      if (typeof __dirname === "string") {
        return __dirname;
      }
      return process.argv[1] ? dirname8(process.argv[1]) : process.cwd();
    };
    findBuiltinExtensionsDir = (starts) => {
      for (const start of starts) {
        let current = resolve5(start);
        while (true) {
          const candidate = join10(current, "extensions", "builtin");
          if (existsSync3(candidate)) {
            return candidate;
          }
          const next = dirname8(current);
          if (next === current) {
            break;
          }
          current = next;
        }
      }
      return join10(starts[0] ?? process.cwd(), "extensions", "builtin");
    };
    isSteerMessage = (text) => /^\/(?:steer|interrupt)\b/i.test(text.trim());
    stripImCommandPrefix = (text) => text.trim().replace(/^\/(?:steer|interrupt)\s*/i, "").trim() || text;
    isRecord8 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    parseMemoryUpdate = (raw) => {
      const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      if (!text) {
        return void 0;
      }
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return void 0;
      }
      const record = parsed;
      return {
        ...typeof record.projectMemory === "string" && record.projectMemory.trim() ? { projectMemory: record.projectMemory.trim() } : {},
        ...typeof record.rootMemory === "string" && record.rootMemory.trim() ? { rootMemory: record.rootMemory.trim() } : {}
      };
    };
    normalizeMarkdownFile2 = (value) => `${value.trimEnd()}
`;
    sanitizeSessionTitle = (value) => {
      const title = value.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "").replace(/[.!?。！？]+$/g, "").trim();
      if (!title) {
        return "";
      }
      return title.slice(0, 80);
    };
    shortStack = (error) => error.stack?.split("\n").slice(0, 3).join(" | ");
    formatDiagnosticLine = (fields) => Object.entries(fields).filter(([, value]) => value !== void 0 && value !== null).map(([key, value]) => `${key}=${formatDiagnosticValue(value)}`).join(" ");
    formatDiagnosticValue = (value) => {
      const text = typeof value === "string" ? value : String(value);
      return /^[A-Za-z0-9_./:@+-]+$/.test(text) ? text : JSON.stringify(text);
    };
  }
});

// apps/cli/src/relay-cli.ts
import { homedir as homedir5 } from "node:os";
import { join as join11 } from "node:path";
var DEFAULT_SCOREL_RELAY_URL, DEFAULT_SCOREL_WEBUI_URL, defaultStateDir, runCliPair, resolveDefaultRelayUrl, parsePairFlags, requireValue, writePairUsage;
var init_relay_cli = __esm({
  "apps/cli/src/relay-cli.ts"() {
    "use strict";
    init_src4();
    DEFAULT_SCOREL_RELAY_URL = "wss://scorel-relay.chanler.dev";
    DEFAULT_SCOREL_WEBUI_URL = "https://scorel.chanler.dev";
    defaultStateDir = () => join11(homedir5(), ".scorel");
    runCliPair = async (argv, options) => {
      let flags;
      try {
        flags = parsePairFlags(argv, options.env ?? process.env);
      } catch (cause) {
        options.error.write(`scorel pair error: ${cause.message}
`);
        writePairUsage(options.error);
        return 1;
      }
      const stateDir = options.stateDir ?? defaultStateDir();
      const identity = await loadOrCreateHostDeviceIdentity({ stateDir });
      try {
        const result = await redeemRelayPair({
          relayUrl: flags.relayUrl,
          pairCode: flags.pairCode,
          deviceId: identity.deviceId,
          label: identity.displayName,
          stateDir
        });
        options.output.write(`scorel pair authorized client=${result.clientId} device=${identity.deviceId}
`);
        return 0;
      } catch (cause) {
        options.error.write(`scorel pair error: ${cause instanceof Error ? cause.message : String(cause)}
`);
        return 1;
      }
    };
    resolveDefaultRelayUrl = (env = process.env) => env.SCOREL_RELAY_URL?.trim() || DEFAULT_SCOREL_RELAY_URL;
    parsePairFlags = (argv, env) => {
      const pairCode = argv[0];
      if (!pairCode || pairCode.startsWith("-")) {
        throw new Error("pair code is required");
      }
      let relayUrl = resolveDefaultRelayUrl(env);
      for (let index = 1; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--relay") {
          relayUrl = requireValue(argv, index, "--relay");
          index += 1;
          continue;
        }
        throw new Error(`Unknown pair option: ${arg}`);
      }
      return { pairCode, relayUrl };
    };
    requireValue = (argv, index, flag) => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${flag} requires a value`);
      }
      return value;
    };
    writePairUsage = (output) => {
      output.write("Usage: scorel pair <pair-code> [--relay <relay-url>]\n");
    };
  }
});

// apps/cli/src/daemon-cli.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir as homedir6 } from "node:os";
import { dirname as dirname9, join as join12 } from "node:path";
import { fileURLToPath } from "node:url";
var DEFAULT_HOST, DEFAULT_PORT, STOP_POLL_INTERVAL_MS, STOP_GRACE_MS, START_READY_TIMEOUT_MS, DEFAULT_IDLE_SHUTDOWN_MS, defaultStateDir2, isLoopbackHost, formatTimestamp, runCliDaemon, runStartCommand, runServeCommand, stopRunningDaemon, runStatusCommand, runStopCommand, runResetCommand, formatStatusLine, parseServeFlags, parseStatusFlags, requireValue2, sleep, waitForDaemonReady, detachBackgroundDaemon, nodeEntrypointArgs, writeDaemonUsage;
var init_daemon_cli = __esm({
  "apps/cli/src/daemon-cli.ts"() {
    "use strict";
    init_src4();
    init_relay_cli();
    DEFAULT_HOST = "127.0.0.1";
    DEFAULT_PORT = 7777;
    STOP_POLL_INTERVAL_MS = 200;
    STOP_GRACE_MS = 5e3;
    START_READY_TIMEOUT_MS = 1e4;
    DEFAULT_IDLE_SHUTDOWN_MS = 15 * 60 * 1e3;
    defaultStateDir2 = () => join12(homedir6(), ".scorel");
    isLoopbackHost = (host) => host === "127.0.0.1" || host === "::1" || host === "localhost";
    formatTimestamp = (epochMs) => new Date(epochMs).toISOString();
    runCliDaemon = async (argv, options) => {
      const [command, ...rest] = argv;
      const stateDir = options.stateDir ?? defaultStateDir2();
      switch (command) {
        case "start":
          return runStartCommand(rest, { ...options, stateDir });
        case "serve":
          return runServeCommand(rest, { ...options, stateDir });
        case "status":
          return runStatusCommand(rest, { ...options, stateDir });
        case "stop":
          return runStopCommand(rest, { ...options, stateDir });
        case "reset":
          return runResetCommand({ ...options, stateDir });
        case "--help":
        case "-h":
          writeDaemonUsage(options.output);
          return 0;
        default:
          writeDaemonUsage(options.error);
          return 1;
      }
    };
    runStartCommand = async (argv, options) => {
      let flags;
      try {
        flags = parseServeFlags(argv, options.cwd ?? process.cwd(), options.env ?? process.env);
      } catch (cause) {
        options.error.write(`scorel daemon start error: ${cause.message}
`);
        return 1;
      }
      const readState = options.readState ?? ((stateDir) => readLocalDaemonState({ stateDir }));
      const existing = await readState(options.stateDir);
      if (existing && daemonStateLiveness(existing) === "running") {
        options.output.write(`scorel host already running url=${existing.wsUrl} pid=${existing.pid}
`);
        return 0;
      }
      const cliEntrypoint = options.cliEntrypoint ?? fileURLToPath(import.meta.url).replace(/daemon-cli\.ts$/, "index.ts");
      const child = (options.spawn ?? spawn)(process.execPath, [
        ...nodeEntrypointArgs(cliEntrypoint),
        "host",
        "serve",
        "--host",
        flags.host,
        "--port",
        String(flags.port),
        "--cwd",
        flags.cwd,
        "--idle-timeout-ms",
        String(flags.idleShutdownMs),
        ...flags.token ? ["--token", flags.token] : [],
        ...flags.relayUrl ? ["--relay", flags.relayUrl] : ["--no-relay"],
        ...flags.replace ? ["--replace"] : []
      ], {
        cwd: dirname9(cliEntrypoint),
        env: { ...process.env, ...options.env ?? {} },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      try {
        await waitForDaemonReady(child, options.daemonReadyTimeoutMs ?? START_READY_TIMEOUT_MS);
      } catch (cause) {
        options.error.write(`scorel daemon start error: ${cause.message}
`);
        child.kill("SIGTERM");
        return 1;
      }
      const state = await readState(options.stateDir);
      if (!state || daemonStateLiveness(state) !== "running") {
        options.error.write("scorel daemon start error: daemon state missing after start\n");
        child.kill("SIGTERM");
        return 1;
      }
      detachBackgroundDaemon(child);
      options.output.write(`scorel host started url=${state.wsUrl} pid=${state.pid}
`);
      return 0;
    };
    runServeCommand = async (argv, options) => {
      let flags;
      try {
        flags = parseServeFlags(argv, options.cwd ?? process.cwd(), options.env ?? process.env);
      } catch (cause) {
        options.error.write(`scorel daemon serve error: ${cause.message}
`);
        return 1;
      }
      const existing = await readLocalDaemonState({ stateDir: options.stateDir });
      if (existing) {
        const liveness = daemonStateLiveness(existing);
        if (liveness === "running") {
          if (flags.replace) {
            await stopRunningDaemon(existing, options);
          } else {
            options.error.write(
              `scorel host already running pid=${existing.pid} url=${existing.wsUrl}
Use --replace to stop it and start a new one.
`
            );
            return 1;
          }
        }
      }
      const token = flags.token ?? existing?.token ?? randomUUID4();
      const identity = await loadOrCreateHostDeviceIdentity({ stateDir: options.stateDir });
      let signalReason = "natural";
      let resolveStopWaiter;
      const requestStop = (reason) => {
        signalReason = reason;
        resolveStopWaiter?.();
      };
      const daemon = new ScorelHost({
        sessionsDir: options.sessionsDir ?? scorelSessionsDir(homedir6()),
        projectsPath: join12(options.stateDir, "projects.json"),
        deviceId: identity.deviceId,
        deviceDisplayName: identity.displayName,
        idleShutdownMs: flags.idleShutdownMs,
        onIdleShutdown: () => requestStop("idle"),
        loadConfig: async ({ project }) => loadScorelConfig({ cwd: project.workDir }),
        loadConfigProfile: async ({ project }) => loadScorelConfigProfile({ cwd: project.workDir }),
        createRuntime: async ({ project, selectedModel, purpose }) => createRealRuntime({
          cwd: project.workDir,
          config: await loadScorelConfig({ cwd: project.workDir }),
          modelSelection: selectedModel ? { modelId: selectedModel.modelId, role: selectedModel.role } : void 0,
          includeTools: purpose === "chat"
        })
      });
      await daemon.start();
      await daemon.registerProject(flags.cwd);
      const server = await startScorelHostWebSocketServer({
        hostService: daemon,
        host: flags.host,
        port: flags.port,
        token
      });
      const startedAt = Date.now();
      const persistedState = {
        host: flags.host,
        port: server.port,
        wsUrl: server.url,
        token,
        pid: process.pid,
        startedAt,
        stoppedAt: null
      };
      await createLocalDaemonState({ stateDir: options.stateDir, ...persistedState });
      options.output.write(`scorel host serving url=${server.url}
`);
      options.output.write(`scorel host initial project cwd=${flags.cwd}
`);
      let relayClient;
      if (flags.relayUrl) {
        relayClient = await startHostRelayClient({
          relayUrl: flags.relayUrl,
          hostService: daemon,
          deviceId: identity.deviceId,
          deviceDisplayName: identity.displayName,
          stateDir: options.stateDir,
          onDiagnostic: (type) => {
            if (type === "relay_host_connected") {
              options.output.write(`scorel host relay connected url=${flags.relayUrl} device=${identity.deviceId}
`);
              options.output.write(`scorel hosted webui ${DEFAULT_SCOREL_WEBUI_URL}
`);
            }
            if (type === "relay_host_reconnecting") {
              options.output.write(`scorel host relay reconnecting url=${flags.relayUrl} device=${identity.deviceId}
`);
            }
          }
        });
      }
      const shutdown = async () => {
        try {
          relayClient?.close();
          await server.close();
        } finally {
          await daemon.shutdown();
          await markDaemonStopped({ stateDir: options.stateDir, stoppedAt: Date.now() });
        }
      };
      const signalHandlers = /* @__PURE__ */ new Map();
      const stopWaiter = new Promise((resolve7) => {
        resolveStopWaiter = resolve7;
        if (options.serveSignal) {
          if (options.serveSignal.aborted) {
            requestStop("abort");
            return;
          }
          options.serveSignal.addEventListener(
            "abort",
            () => {
              requestStop("abort");
            },
            { once: true }
          );
          return;
        }
        const installSignal = (signal) => {
          const handler = () => {
            requestStop(signal);
          };
          signalHandlers.set(signal, handler);
          process.once(signal, handler);
        };
        installSignal("SIGINT");
        installSignal("SIGTERM");
      });
      try {
        await stopWaiter;
      } finally {
        for (const [signal, handler] of signalHandlers) {
          process.off(signal, handler);
        }
        await shutdown();
      }
      options.output.write(`scorel host serve stopped reason=${signalReason}
`);
      return 0;
    };
    stopRunningDaemon = async (state, options) => {
      try {
        process.kill(state.pid, "SIGTERM");
      } catch {
        return;
      }
      const deadline = Date.now() + STOP_GRACE_MS;
      while (Date.now() < deadline) {
        await sleep(STOP_POLL_INTERVAL_MS);
        const refreshed = await readLocalDaemonState({ stateDir: options.stateDir });
        if (!refreshed || refreshed.stoppedAt !== null || daemonStateLiveness(refreshed) !== "running") {
          return;
        }
      }
      try {
        process.kill(state.pid, "SIGKILL");
      } catch {
      }
    };
    runStatusCommand = async (argv, options) => {
      let flags;
      try {
        flags = parseStatusFlags(argv);
      } catch (cause) {
        options.error.write(`scorel daemon status error: ${cause.message}
`);
        return 1;
      }
      const state = await readLocalDaemonState({ stateDir: options.stateDir });
      if (!state) {
        options.error.write("scorel daemon not configured\n");
        return 1;
      }
      const liveness = daemonStateLiveness(state);
      options.output.write(`${formatStatusLine(state, liveness, flags.showToken)}
`);
      return 0;
    };
    runStopCommand = async (_argv, options) => {
      const state = await readLocalDaemonState({ stateDir: options.stateDir });
      if (!state) {
        options.error.write("scorel daemon not configured\n");
        return 1;
      }
      const liveness = daemonStateLiveness(state);
      if (liveness !== "running") {
        options.output.write(
          `scorel daemon already stopped pid=${state.pid} liveness=${liveness}
`
        );
        return 0;
      }
      try {
        process.kill(state.pid, "SIGTERM");
      } catch (cause) {
        options.error.write(
          `scorel daemon stop error: ${cause instanceof Error ? cause.message : String(cause)}
`
        );
        return 1;
      }
      const deadline = Date.now() + STOP_GRACE_MS;
      while (Date.now() < deadline) {
        await sleep(STOP_POLL_INTERVAL_MS);
        const refreshed = await readLocalDaemonState({ stateDir: options.stateDir });
        if (!refreshed) {
          break;
        }
        if (refreshed.stoppedAt !== null) {
          options.output.write(`scorel daemon stopped pid=${refreshed.pid}
`);
          return 0;
        }
        const refreshedLiveness = daemonStateLiveness(refreshed);
        if (refreshedLiveness !== "running") {
          options.output.write(
            `scorel daemon stopped pid=${refreshed.pid} liveness=${refreshedLiveness}
`
          );
          return 0;
        }
      }
      try {
        process.kill(state.pid, "SIGKILL");
      } catch {
      }
      options.output.write(`scorel daemon stopped pid=${state.pid} via=SIGKILL
`);
      return 0;
    };
    runResetCommand = async (options) => {
      await removeLocalDaemonState({ stateDir: options.stateDir });
      options.output.write("scorel daemon state reset; next serve will generate a new token\n");
      return 0;
    };
    formatStatusLine = (state, liveness, showToken) => {
      if (liveness === "running") {
        const tokenSuffix = isLoopbackHost(state.host) || showToken ? ` token=${state.token}` : "";
        return `running url=${state.wsUrl} pid=${state.pid}${tokenSuffix}`;
      }
      const stoppedAt = state.stoppedAt !== null ? formatTimestamp(state.stoppedAt) : "unknown";
      return `stopped url=${state.wsUrl} last-pid=${state.pid} stoppedAt=${stoppedAt} liveness=${liveness}`;
    };
    parseServeFlags = (argv, defaultCwd, env) => {
      let host = DEFAULT_HOST;
      let port = DEFAULT_PORT;
      let cwd = defaultCwd;
      let token;
      let relayUrl = resolveDefaultRelayUrl(env);
      let replace = false;
      let idleShutdownMs = DEFAULT_IDLE_SHUTDOWN_MS;
      for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--host") {
          host = requireValue2(argv, index, "--host");
          index += 1;
          continue;
        }
        if (arg === "--port") {
          port = Number(requireValue2(argv, index, "--port"));
          if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error("--port must be an integer from 0 to 65535");
          }
          index += 1;
          continue;
        }
        if (arg === "--token") {
          token = requireValue2(argv, index, "--token");
          index += 1;
          continue;
        }
        if (arg === "--cwd") {
          cwd = requireValue2(argv, index, "--cwd");
          index += 1;
          continue;
        }
        if (arg === "--project" || arg === "--bootstrap-project") {
          cwd = requireValue2(argv, index, arg);
          index += 1;
          continue;
        }
        if (arg === "--relay") {
          relayUrl = requireValue2(argv, index, "--relay");
          index += 1;
          continue;
        }
        if (arg === "--no-relay") {
          relayUrl = void 0;
          continue;
        }
        if (arg === "--replace") {
          replace = true;
          continue;
        }
        if (arg === "--idle-timeout-ms") {
          idleShutdownMs = Number(requireValue2(argv, index, "--idle-timeout-ms"));
          if (!Number.isInteger(idleShutdownMs) || idleShutdownMs < 0) {
            throw new Error("--idle-timeout-ms must be a non-negative integer");
          }
          index += 1;
          continue;
        }
        throw new Error(`Unknown serve option: ${arg}`);
      }
      return { host, port, token, cwd, relayUrl, replace, idleShutdownMs };
    };
    parseStatusFlags = (argv) => {
      let showToken = false;
      for (const arg of argv) {
        if (arg === "--show-token") {
          showToken = true;
          continue;
        }
        throw new Error(`Unknown status option: ${arg}`);
      }
      return { showToken };
    };
    requireValue2 = (argv, index, flag) => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${flag} requires a value`);
      }
      return value;
    };
    sleep = (ms) => new Promise((resolve7) => {
      setTimeout(resolve7, ms);
    });
    waitForDaemonReady = (child, timeoutMs) => new Promise((resolveReady, rejectReady) => {
      if (!child.stdout) {
        rejectReady(new Error("daemon child has no stdout stream"));
        return;
      }
      let buffer = "";
      let stderrBuffer = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectReady(new Error("timed out waiting for daemon ready line"));
      }, timeoutMs);
      const onData = (chunk) => {
        buffer += chunk.toString();
        if (!buffer.includes("\n")) return;
        if (buffer.includes("scorel daemon serving url=") || buffer.includes("scorel host serving url=")) {
          if (settled) return;
          settled = true;
          cleanup();
          resolveReady();
        }
        const newlineIndex = buffer.lastIndexOf("\n");
        buffer = newlineIndex >= 0 ? buffer.slice(newlineIndex + 1) : buffer;
      };
      const onStderr = (chunk) => {
        stderrBuffer += chunk.toString();
      };
      const onExit = (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        const trimmed = stderrBuffer.trim();
        const detail = trimmed ? `: ${trimmed}` : "";
        rejectReady(new Error(`daemon exited before ready code=${code}${detail}`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onStderr);
        child.off("exit", onExit);
      };
      child.stdout.on("data", onData);
      child.stderr?.on("data", onStderr);
      child.once("exit", onExit);
    });
    detachBackgroundDaemon = (child) => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    };
    nodeEntrypointArgs = (entrypoint) => entrypoint.endsWith(".ts") ? ["--import", "tsx", entrypoint] : [entrypoint];
    writeDaemonUsage = (output) => {
      output.write(
        [
          "Usage: scorel host serve [--host <h>] [--port <p>] [--token <t>] [--project <dir>]",
          "                        [--relay <relay-url> | --no-relay] [--replace] [--idle-timeout-ms <ms>]",
          "       scorel host start [--host <h>] [--port <p>] [--token <t>] [--project <dir>]",
          "                        [--relay <relay-url> | --no-relay] [--replace] [--idle-timeout-ms <ms>]",
          "       scorel host status [--show-token]",
          "       scorel host stop",
          "       scorel host reset",
          "       scorel daemon ...  # pre-1.0 alias"
        ].join("\n") + "\n"
      );
    };
  }
});

// apps/relay/src/diagnostics.ts
var createConsoleRelayDiagnostics, forbiddenKeys, sanitizeDiagnosticData;
var init_diagnostics = __esm({
  "apps/relay/src/diagnostics.ts"() {
    "use strict";
    createConsoleRelayDiagnostics = () => ({
      record(type, data = {}) {
        console.log(JSON.stringify({ type, ts: Date.now(), data: sanitizeDiagnosticData(data) }));
      }
    });
    forbiddenKeys = /* @__PURE__ */ new Set(["payload", "content", "message", "prompt", "result", "data"]);
    sanitizeDiagnosticData = (input) => {
      const output = {};
      for (const [key, value] of Object.entries(input)) {
        output[key] = forbiddenKeys.has(key) ? "[redacted]" : value;
      }
      return output;
    };
  }
});

// apps/relay/src/pairing.ts
import { randomInt } from "node:crypto";
var RelayPairing, defaultPairCode;
var init_pairing = __esm({
  "apps/relay/src/pairing.ts"() {
    "use strict";
    RelayPairing = class {
      #sessions = /* @__PURE__ */ new Map();
      #ttlMs;
      #now;
      #createPairCode;
      constructor(options = {}) {
        this.#ttlMs = options.ttlMs ?? 5 * 6e4;
        this.#now = options.now ?? Date.now;
        this.#createPairCode = options.createPairCode ?? defaultPairCode;
      }
      create(clientId) {
        this.#pruneExpired();
        let pairCode = this.#createPairCode();
        while (this.#sessions.has(pairCode)) {
          pairCode = this.#createPairCode();
        }
        const session = { pairCode, clientId, expiresAt: this.#now() + this.#ttlMs };
        this.#sessions.set(pairCode, session);
        return session;
      }
      consume(pairCode) {
        const session = this.#sessions.get(pairCode);
        if (!session) {
          return { ok: false, reason: "not_found" };
        }
        this.#sessions.delete(pairCode);
        if (session.expiresAt <= this.#now()) {
          return { ok: false, reason: "expired" };
        }
        return { ok: true, clientId: session.clientId };
      }
      #pruneExpired() {
        const now = this.#now();
        for (const [pairCode, session] of this.#sessions) {
          if (session.expiresAt <= now) {
            this.#sessions.delete(pairCode);
          }
        }
      }
    };
    defaultPairCode = () => `${randomInt(1e5, 1e6)}`;
  }
});

// apps/relay/src/presence.ts
var RelayPresence;
var init_presence = __esm({
  "apps/relay/src/presence.ts"() {
    "use strict";
    RelayPresence = class {
      #devices = /* @__PURE__ */ new Map();
      #clients = /* @__PURE__ */ new Map();
      setDevice(deviceId, socket) {
        let sockets = this.#devices.get(deviceId);
        if (!sockets) {
          sockets = /* @__PURE__ */ new Set();
          this.#devices.set(deviceId, sockets);
        }
        sockets.add(socket);
        socket.once("close", () => {
          sockets.delete(socket);
          if (sockets.size === 0) {
            this.#devices.delete(deviceId);
          }
        });
      }
      addClient(clientId, socket) {
        let sockets = this.#clients.get(clientId);
        if (!sockets) {
          sockets = /* @__PURE__ */ new Set();
          this.#clients.set(clientId, sockets);
        }
        sockets.add(socket);
        socket.once("close", () => {
          sockets.delete(socket);
          if (sockets.size === 0) {
            this.#clients.delete(clientId);
          }
        });
      }
      deviceSocket(deviceId) {
        const sockets = this.#devices.get(deviceId) ?? /* @__PURE__ */ new Set();
        return [...sockets].find((socket) => socket.readyState === socket.OPEN);
      }
      clientSockets(clientId) {
        return [...this.#clients.get(clientId) ?? []].filter((socket) => socket.readyState === socket.OPEN);
      }
      isDeviceOnline(deviceId) {
        return this.deviceSocket(deviceId) !== void 0;
      }
    };
  }
});

// apps/relay/src/routing.ts
var routeEntryToDevice, routeHostToEntry, sendJson;
var init_routing = __esm({
  "apps/relay/src/routing.ts"() {
    "use strict";
    routeEntryToDevice = async (input) => {
      if (!await input.store.isBound({ clientId: input.clientId, deviceId: input.deviceId })) {
        input.diagnostics.record("entry_route_rejected", {
          clientId: input.clientId,
          deviceId: input.deviceId,
          reason: "unauthorized"
        });
        return { ok: false, code: "unauthorized", message: "entry is not authorized for device" };
      }
      const socket = input.presence.deviceSocket(input.deviceId);
      if (!socket) {
        input.diagnostics.record("entry_route_rejected", {
          clientId: input.clientId,
          deviceId: input.deviceId,
          reason: "device_offline"
        });
        return { ok: false, code: "device_offline", message: "device is offline" };
      }
      sendJson(socket, {
        type: "relay_to_host",
        clientId: input.clientId,
        payload: input.payload
      });
      input.diagnostics.record("entry_route_forwarded", {
        clientId: input.clientId,
        deviceId: input.deviceId,
        payloadType: input.payload.type
      });
      return { ok: true };
    };
    routeHostToEntry = (input) => {
      const sockets = input.presence.clientSockets(input.clientId);
      if (sockets.length === 0) {
        input.diagnostics.record("host_route_rejected", {
          clientId: input.clientId,
          deviceId: input.deviceId,
          reason: "client_offline"
        });
        return { ok: false, code: "client_offline", message: "entry is offline" };
      }
      for (const socket of sockets) {
        sendJson(socket, {
          type: "device_to_entry",
          deviceId: input.deviceId,
          payload: input.payload
        });
      }
      input.diagnostics.record("host_route_forwarded", {
        clientId: input.clientId,
        deviceId: input.deviceId,
        payloadType: input.payload.type,
        clientSocketCount: sockets.length
      });
      return { ok: true };
    };
    sendJson = (socket, value) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(value));
      }
    };
  }
});

// apps/relay/src/store.ts
import { mkdir as mkdir7, readFile as readFile12, writeFile as writeFile7 } from "node:fs/promises";
import { join as join13 } from "node:path";
var FileRelayStore, emptyStoreFile;
var init_store = __esm({
  "apps/relay/src/store.ts"() {
    "use strict";
    FileRelayStore = class {
      #filePath;
      #now;
      #queue = Promise.resolve();
      constructor(options) {
        this.#filePath = join13(options.dataDir, "relay-store.json");
        this.#now = options.now ?? Date.now;
      }
      async upsertDevice(record) {
        await this.#mutate((file) => {
          const existing = file.devices.find((candidate) => candidate.deviceId === record.deviceId);
          if (existing) {
            Object.assign(existing, { ...record, createdAt: existing.createdAt, updatedAt: record.updatedAt });
          } else {
            file.devices.push(record);
          }
        });
      }
      async upsertClient(record) {
        await this.#mutate((file) => {
          const existing = file.clients.find((candidate) => candidate.clientId === record.clientId);
          if (existing) {
            Object.assign(existing, { ...record, createdAt: existing.createdAt, updatedAt: record.updatedAt });
          } else {
            file.clients.push(record);
          }
        });
      }
      async bind(input) {
        await this.#mutate((file) => {
          if (!file.bindings.some((binding) => binding.deviceId === input.deviceId && binding.clientId === input.clientId)) {
            file.bindings.push({ ...input, createdAt: this.#now() });
          }
        });
      }
      async isBound(input) {
        const file = await this.#read();
        return file.bindings.some((binding) => binding.deviceId === input.deviceId && binding.clientId === input.clientId);
      }
      async listDevicesForClient(clientId) {
        const file = await this.#read();
        const deviceIds = new Set(file.bindings.filter((binding) => binding.clientId === clientId).map((binding) => binding.deviceId));
        return file.devices.filter((device) => deviceIds.has(device.deviceId));
      }
      async #mutate(mutator) {
        this.#queue = this.#queue.then(async () => {
          const file = await this.#read();
          mutator(file);
          await mkdir7(join13(this.#filePath, ".."), { recursive: true });
          await writeFile7(this.#filePath, `${JSON.stringify(file, null, 2)}
`);
        });
        await this.#queue;
      }
      async #read() {
        try {
          const raw = JSON.parse(await readFile12(this.#filePath, "utf8"));
          if (raw.version !== 1 || !Array.isArray(raw.devices) || !Array.isArray(raw.clients) || !Array.isArray(raw.bindings)) {
            return emptyStoreFile();
          }
          return {
            version: 1,
            devices: raw.devices,
            clients: raw.clients,
            bindings: raw.bindings
          };
        } catch (cause) {
          if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
            return emptyStoreFile();
          }
          throw cause;
        }
      }
    };
    emptyStoreFile = () => ({
      version: 1,
      devices: [],
      clients: [],
      bindings: []
    });
  }
});

// apps/relay/src/server.ts
import { WebSocketServer as WebSocketServer2 } from "ws";
var startRelayServer, handleEntryFrame, handleHostFrame, isEntryFrame, parseFrame, sendResponse, sendError, sendJson2, closeWebSocketServer2;
var init_server = __esm({
  "apps/relay/src/server.ts"() {
    "use strict";
    init_diagnostics();
    init_pairing();
    init_presence();
    init_routing();
    startRelayServer = async (options) => {
      const diagnostics = options.diagnostics ?? createConsoleRelayDiagnostics();
      const pairing = options.pairing ?? new RelayPairing();
      const presence = new RelayPresence();
      const socketStates = /* @__PURE__ */ new WeakMap();
      const now = options.now ?? Date.now;
      const server = new WebSocketServer2({ host: options.host, port: options.port });
      server.on("connection", (socket) => {
        socketStates.set(socket, {});
        diagnostics.record("socket_connected");
        let queue = Promise.resolve();
        socket.on("message", (data) => {
          queue = queue.then(async () => {
            const state = socketStates.get(socket) ?? {};
            const frame = parseFrame(data);
            if (!frame) {
              sendError(socket, void 0, "invalid_request", "invalid relay frame");
              return;
            }
            if (isEntryFrame(frame)) {
              await handleEntryFrame({ frame, socket, state, store: options.store, diagnostics, pairing, presence, now });
              return;
            }
            await handleHostFrame({ frame, socket, state, store: options.store, diagnostics, pairing, presence, now });
          }).catch((cause) => {
            diagnostics.record("relay_internal_error", {
              error: cause instanceof Error ? cause.message : String(cause)
            });
            sendError(socket, void 0, "internal_error", cause instanceof Error ? cause.message : String(cause));
          });
        });
      });
      await new Promise((resolve7, reject) => {
        server.once("error", reject);
        server.once("listening", () => {
          server.off("error", reject);
          resolve7();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        await closeWebSocketServer2(server);
        throw new Error("relay server did not expose a TCP address");
      }
      const host = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
      return {
        host: options.host,
        port: address.port,
        url: `ws://${host}:${address.port}`,
        close: () => closeWebSocketServer2(server)
      };
    };
    handleEntryFrame = async (input) => {
      switch (input.frame.type) {
        case "entry_hello": {
          input.state.clientId = input.frame.clientId;
          input.presence.addClient(input.frame.clientId, input.socket);
          const ts = input.now();
          await input.store.upsertClient({
            clientId: input.frame.clientId,
            label: input.frame.label,
            publicKey: input.frame.publicKey,
            createdAt: ts,
            updatedAt: ts
          });
          input.diagnostics.record("entry_online", { clientId: input.frame.clientId });
          return;
        }
        case "create_pair_session": {
          const clientId = input.frame.clientId ?? input.state.clientId;
          if (!clientId) {
            sendError(input.socket, input.frame.requestId, "not_announced", "entry must announce clientId before pairing");
            return;
          }
          const session = input.pairing.create(clientId);
          input.diagnostics.record("pair_session_created", { clientId, pairCode: session.pairCode });
          sendResponse(input.socket, input.frame.requestId, {
            pairCode: session.pairCode,
            expiresAt: session.expiresAt
          });
          return;
        }
        case "list_authorized_devices": {
          if (!input.state.clientId) {
            sendError(input.socket, input.frame.requestId, "not_announced", "entry must announce clientId before listing devices");
            return;
          }
          const devices = await input.store.listDevicesForClient(input.state.clientId);
          sendResponse(input.socket, input.frame.requestId, {
            devices: devices.map((device) => ({
              ...device,
              online: input.presence.isDeviceOnline(device.deviceId)
            }))
          });
          return;
        }
        case "entry_to_device": {
          if (!input.state.clientId) {
            sendError(input.socket, void 0, "not_announced", "entry must announce clientId before routing");
            return;
          }
          const result = await routeEntryToDevice({
            store: input.store,
            presence: input.presence,
            diagnostics: input.diagnostics,
            clientId: input.state.clientId,
            deviceId: input.frame.deviceId,
            payload: input.frame.payload
          });
          if (!result.ok) {
            sendError(input.socket, "requestId" in input.frame.payload ? input.frame.payload.requestId : void 0, result.code, result.message);
          }
          return;
        }
      }
    };
    handleHostFrame = async (input) => {
      switch (input.frame.type) {
        case "host_hello": {
          input.state.deviceId = input.frame.deviceId;
          input.presence.setDevice(input.frame.deviceId, input.socket);
          const ts = input.now();
          await input.store.upsertDevice({
            deviceId: input.frame.deviceId,
            label: input.frame.label,
            publicKey: input.frame.publicKey,
            createdAt: ts,
            updatedAt: ts
          });
          input.diagnostics.record("device_online", { deviceId: input.frame.deviceId });
          return;
        }
        case "redeem_pair": {
          const result = input.pairing.consume(input.frame.pairCode);
          if (!result.ok) {
            sendError(
              input.socket,
              input.frame.requestId,
              result.reason === "expired" ? "pair_expired" : "pair_not_found",
              result.reason === "expired" ? "pair code expired" : "pair code not found"
            );
            return;
          }
          await input.store.bind({ deviceId: input.frame.deviceId, clientId: result.clientId });
          input.diagnostics.record("pair_session_redeemed", {
            deviceId: input.frame.deviceId,
            clientId: result.clientId
          });
          sendResponse(input.socket, input.frame.requestId, { clientId: result.clientId });
          return;
        }
        case "host_to_entry": {
          if (!input.state.deviceId) {
            sendError(input.socket, void 0, "not_announced", "host must announce deviceId before routing");
            return;
          }
          const result = routeHostToEntry({
            presence: input.presence,
            diagnostics: input.diagnostics,
            deviceId: input.state.deviceId,
            clientId: input.frame.clientId,
            payload: input.frame.payload
          });
          if (!result.ok) {
            sendError(input.socket, void 0, result.code, result.message);
          }
          return;
        }
      }
    };
    isEntryFrame = (frame) => frame.type === "entry_hello" || frame.type === "create_pair_session" || frame.type === "entry_to_device" || frame.type === "list_authorized_devices";
    parseFrame = (data) => {
      try {
        const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const frame = JSON.parse(text);
        return typeof frame.type === "string" ? frame : null;
      } catch {
        return null;
      }
    };
    sendResponse = (socket, requestId, data) => {
      sendJson2(socket, { type: "relay_response", requestId, ok: true, data });
    };
    sendError = (socket, requestId, code, message) => {
      sendJson2(socket, { type: "relay_error", requestId, ok: false, code, message });
    };
    sendJson2 = (socket, value) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(value));
      }
    };
    closeWebSocketServer2 = (server) => new Promise((resolve7, reject) => {
      for (const client of server.clients) {
        client.close();
      }
      server.close((error) => error ? reject(error) : resolve7());
    });
  }
});

// apps/relay/src/library.ts
var init_library = __esm({
  "apps/relay/src/library.ts"() {
    "use strict";
    init_src();
    init_diagnostics();
    init_pairing();
    init_presence();
    init_routing();
    init_store();
    init_server();
  }
});

// apps/cli/src/relay-server-cli.ts
import { homedir as homedir7 } from "node:os";
import { join as join14 } from "node:path";
var DEFAULT_HOST2, DEFAULT_PORT2, runCliRelay, runRelayServe, parseRelayServeFlags, waitForStop, requireValue3, writeRelayUsage;
var init_relay_server_cli = __esm({
  "apps/cli/src/relay-server-cli.ts"() {
    "use strict";
    init_library();
    DEFAULT_HOST2 = "127.0.0.1";
    DEFAULT_PORT2 = 8787;
    runCliRelay = async (argv, options) => {
      const [command, ...rest] = argv;
      if (command === "serve") {
        return runRelayServe(rest, options);
      }
      if (command === "--help" || command === "-h") {
        writeRelayUsage(options.output);
        return 0;
      }
      writeRelayUsage(options.error);
      return 1;
    };
    runRelayServe = async (argv, options) => {
      let flags;
      try {
        flags = parseRelayServeFlags(argv);
      } catch (cause) {
        options.error.write(`scorel relay serve error: ${cause.message}
`);
        return 1;
      }
      let server;
      try {
        server = await startRelayServer({
          host: flags.host,
          port: flags.port,
          store: new FileRelayStore({ dataDir: flags.dataDir }),
          diagnostics: createConsoleRelayDiagnostics()
        });
      } catch (cause) {
        options.error.write(`scorel relay serve error: ${cause instanceof Error ? cause.message : String(cause)}
`);
        return 1;
      }
      options.output.write(`scorel relay serving url=${server.url}
`);
      await waitForStop(options.serveSignal);
      await server.close();
      options.output.write("scorel relay serve stopped\n");
      return 0;
    };
    parseRelayServeFlags = (argv) => {
      let host = DEFAULT_HOST2;
      let port = DEFAULT_PORT2;
      let dataDir = join14(homedir7(), ".scorel", "relay");
      for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--host") {
          host = requireValue3(argv, index, "--host");
          index += 1;
          continue;
        }
        if (arg === "--port") {
          port = Number(requireValue3(argv, index, "--port"));
          if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error("--port must be an integer from 0 to 65535");
          }
          index += 1;
          continue;
        }
        if (arg === "--data-dir") {
          dataDir = requireValue3(argv, index, "--data-dir");
          index += 1;
          continue;
        }
        throw new Error(`Unknown relay serve option: ${arg}`);
      }
      return { host, port, dataDir };
    };
    waitForStop = (signal) => new Promise((resolve7) => {
      if (signal) {
        if (signal.aborted) {
          resolve7();
          return;
        }
        signal.addEventListener("abort", () => resolve7(), { once: true });
        return;
      }
      const onSignal = () => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        resolve7();
      };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    });
    requireValue3 = (argv, index, flag) => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${flag} requires a value`);
      }
      return value;
    };
    writeRelayUsage = (output) => {
      output.write("Usage: scorel relay serve [--host <h>] [--port <p>] [--data-dir <dir>]\n");
    };
  }
});

// apps/cli/src/up-cli.ts
import { spawn as spawn2 } from "node:child_process";
import { homedir as homedir8 } from "node:os";
import { dirname as dirname10, join as join15 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var DEFAULT_DAEMON_PORT, DEFAULT_WEBUI_PORT, DEFAULT_DAEMON_READY_TIMEOUT_MS, defaultStateDir3, defaultAttachSigint, runCliUp, parseUpFlags, requireValue4, waitForDaemonReady2, pipeWithPrefix, detachBackgroundDaemon2, nodeEntrypointArgs2, pipeStreamLines, once;
var init_up_cli = __esm({
  "apps/cli/src/up-cli.ts"() {
    "use strict";
    init_src4();
    DEFAULT_DAEMON_PORT = 7777;
    DEFAULT_WEBUI_PORT = 3e3;
    DEFAULT_DAEMON_READY_TIMEOUT_MS = 1e4;
    defaultStateDir3 = () => join15(homedir8(), ".scorel");
    defaultAttachSigint = (listener) => {
      process.on("SIGINT", listener);
      return () => process.off("SIGINT", listener);
    };
    runCliUp = async (argv, options) => {
      let flags;
      try {
        flags = parseUpFlags(argv, options.cwd ?? process.cwd());
      } catch (cause) {
        options.error.write(`scorel up error: ${cause.message}
`);
        return 1;
      }
      const stateDir = options.stateDir ?? defaultStateDir3();
      const cliEntrypoint = options.cliEntrypoint ?? fileURLToPath2(import.meta.url).replace(/up-cli\.ts$/, "index.ts");
      const spawnFn = options.spawn ?? spawn2;
      const readState = options.readState ?? ((dir) => readLocalDaemonState({ stateDir: dir }));
      const attachSigint = options.attachSigint ?? defaultAttachSigint;
      const readyTimeout = options.daemonReadyTimeoutMs ?? DEFAULT_DAEMON_READY_TIMEOUT_MS;
      const existingState = await readState(stateDir);
      const existingLiveness = existingState ? daemonStateLiveness(existingState) : null;
      const reuseDaemon = existingState && existingLiveness === "running";
      let daemonChild;
      let daemonState = existingState;
      if (!reuseDaemon) {
        const daemonArgs = [
          ...nodeEntrypointArgs2(cliEntrypoint),
          "daemon",
          "serve",
          "--port",
          String(flags.daemonPort),
          "--cwd",
          flags.cwd,
          "--no-relay"
        ];
        daemonChild = spawnFn(process.execPath, daemonArgs, {
          cwd: dirname10(cliEntrypoint),
          env: { ...process.env },
          detached: true,
          stdio: ["ignore", "pipe", "pipe"]
        });
        try {
          await waitForDaemonReady2(daemonChild, readyTimeout);
        } catch (cause) {
          options.error.write(`scorel up error: ${cause.message}
`);
          daemonChild.kill("SIGTERM");
          return 1;
        }
        daemonState = await readState(stateDir);
      }
      if (!daemonState) {
        options.error.write("scorel up error: daemon state missing after start\n");
        daemonChild?.kill("SIGTERM");
        return 1;
      }
      if (daemonChild) {
        detachBackgroundDaemon2(daemonChild);
      }
      const webuiArgs = [
        ...nodeEntrypointArgs2(cliEntrypoint),
        "webui",
        "--port",
        String(flags.webuiPort)
      ];
      const webuiChild = spawnFn(process.execPath, webuiArgs, {
        cwd: dirname10(cliEntrypoint),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"]
      });
      pipeWithPrefix(webuiChild, "[webui] ", options.output, options.error);
      options.output.write(`scorel up
`);
      options.output.write(`  daemon  ${daemonState.wsUrl}  token=${daemonState.token}
`);
      options.output.write(`  webui   http://127.0.0.1:${flags.webuiPort}
`);
      let shuttingDown = false;
      const detachSigint = attachSigint(() => {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;
        webuiChild.kill("SIGTERM");
      });
      const webuiExit = once(webuiChild);
      const webuiDeathWatcher = webuiExit.then((code) => {
        if (!shuttingDown) {
          shuttingDown = true;
          options.error.write(`scorel up webui exited code=${code}
`);
        }
        return code;
      });
      const webuiCode = await webuiDeathWatcher;
      detachSigint();
      options.output.write("scorel up stopped\n");
      return webuiCode === 0 ? 0 : 1;
    };
    parseUpFlags = (argv, defaultCwd) => {
      let daemonPort = DEFAULT_DAEMON_PORT;
      let webuiPort = DEFAULT_WEBUI_PORT;
      let cwd = defaultCwd;
      for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--daemon-port") {
          daemonPort = Number(requireValue4(argv, index, "--daemon-port"));
          if (!Number.isInteger(daemonPort) || daemonPort < 0 || daemonPort > 65535) {
            throw new Error("--daemon-port must be an integer from 0 to 65535");
          }
          index += 1;
          continue;
        }
        if (arg === "--webui-port") {
          webuiPort = Number(requireValue4(argv, index, "--webui-port"));
          if (!Number.isInteger(webuiPort) || webuiPort < 0 || webuiPort > 65535) {
            throw new Error("--webui-port must be an integer from 0 to 65535");
          }
          index += 1;
          continue;
        }
        if (arg === "--cwd") {
          cwd = requireValue4(argv, index, "--cwd");
          index += 1;
          continue;
        }
        throw new Error(`Unknown up option: ${arg}`);
      }
      return { daemonPort, webuiPort, cwd };
    };
    requireValue4 = (argv, index, flag) => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${flag} requires a value`);
      }
      return value;
    };
    waitForDaemonReady2 = (child, timeoutMs) => new Promise((resolveReady, rejectReady) => {
      if (!child.stdout) {
        rejectReady(new Error("daemon child has no stdout stream"));
        return;
      }
      let buffer = "";
      let stderrBuffer = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectReady(new Error("timed out waiting for daemon ready line"));
      }, timeoutMs);
      const onData = (chunk) => {
        buffer += chunk.toString();
        const newlineIndex = buffer.lastIndexOf("\n");
        if (newlineIndex < 0) {
          return;
        }
        if (buffer.includes("scorel daemon serving url=") || buffer.includes("scorel host serving url=")) {
          if (settled) return;
          settled = true;
          cleanup();
          resolveReady();
        }
        buffer = buffer.slice(newlineIndex + 1);
      };
      const onStderr = (chunk) => {
        stderrBuffer += chunk.toString();
      };
      const onExit = (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        const trimmed = stderrBuffer.trim();
        const detail = trimmed ? `: ${trimmed}` : "";
        rejectReady(new Error(`daemon exited before ready code=${code}${detail}`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onStderr);
        child.off("exit", onExit);
      };
      child.stdout.on("data", onData);
      child.stderr?.on("data", onStderr);
      child.once("exit", onExit);
    });
    pipeWithPrefix = (child, prefix, output, error) => {
      if (child.stdout) {
        pipeStreamLines(child.stdout, prefix, output);
      }
      if (child.stderr) {
        pipeStreamLines(child.stderr, prefix, error);
      }
    };
    detachBackgroundDaemon2 = (child) => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    };
    nodeEntrypointArgs2 = (entrypoint) => entrypoint.endsWith(".ts") ? ["--import", "tsx", entrypoint] : [entrypoint];
    pipeStreamLines = (stream, prefix, destination) => {
      let buffer = "";
      stream.setEncoding?.("utf8");
      stream.on("data", (chunk) => {
        buffer += chunk.toString();
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          destination.write(`${prefix} ${line}
`);
          newlineIndex = buffer.indexOf("\n");
        }
      });
      stream.on("end", () => {
        if (buffer.length > 0) {
          destination.write(`${prefix} ${buffer}
`);
          buffer = "";
        }
      });
    };
    once = (child) => new Promise((resolveExit) => {
      child.once("exit", (code) => resolveExit(typeof code === "number" ? code : 0));
    });
  }
});

// apps/cli/src/webui-cli.ts
import { spawn as spawn3 } from "node:child_process";
import { existsSync as existsSync4 } from "node:fs";
import { dirname as dirname11, resolve as resolve6 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var DEFAULT_PORT3, DEFAULT_HOST3, runCliWebUi, findWebuiAppDir, buildWebUiSpawnPlan, parseWebUiFlags, requireValue5, waitForChildExit;
var init_webui_cli = __esm({
  "apps/cli/src/webui-cli.ts"() {
    "use strict";
    DEFAULT_PORT3 = 3e3;
    DEFAULT_HOST3 = "127.0.0.1";
    runCliWebUi = async (argv, options) => {
      let flags;
      try {
        flags = parseWebUiFlags(argv);
      } catch (cause) {
        options.error.write(`scorel webui error: ${cause.message}
`);
        return 1;
      }
      const webuiAppDir = options.webuiAppDir ?? findWebuiAppDir();
      if (!webuiAppDir) {
        options.error.write("scorel webui error: could not locate apps/webui\n");
        return 1;
      }
      const plan = buildWebUiSpawnPlan(flags, webuiAppDir);
      const spawnFn = options.spawn ?? spawn3;
      const child = spawnFn(plan.command, plan.argv, {
        cwd: plan.cwd,
        env: plan.env,
        stdio: "inherit"
      });
      return await waitForChildExit(child, options);
    };
    findWebuiAppDir = () => {
      let cursor = dirname11(fileURLToPath3(import.meta.url));
      for (let depth = 0; depth < 8; depth += 1) {
        const candidate = resolve6(cursor, "apps/webui/package.json");
        if (existsSync4(candidate)) {
          return resolve6(cursor, "apps/webui");
        }
        const parent = resolve6(cursor, "..");
        if (parent === cursor) {
          return void 0;
        }
        cursor = parent;
      }
      return void 0;
    };
    buildWebUiSpawnPlan = (flags, webuiAppDir) => {
      const env = {
        ...process.env,
        PORT: String(flags.port),
        HOST: flags.host
      };
      const nextBin = resolve6(webuiAppDir, "node_modules/next/dist/bin/next");
      if (existsSync4(nextBin)) {
        return {
          command: process.execPath,
          argv: [nextBin, "dev", "-p", String(flags.port), "-H", flags.host],
          cwd: webuiAppDir,
          env
        };
      }
      return {
        command: "pnpm",
        argv: ["--filter", "@scorel/app-webui", "dev"],
        cwd: webuiAppDir,
        env
      };
    };
    parseWebUiFlags = (argv) => {
      let host = DEFAULT_HOST3;
      let port = DEFAULT_PORT3;
      for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--host") {
          host = requireValue5(argv, index, "--host");
          index += 1;
          continue;
        }
        if (arg === "--port") {
          port = Number(requireValue5(argv, index, "--port"));
          if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error("--port must be an integer from 0 to 65535");
          }
          index += 1;
          continue;
        }
        throw new Error(`Unknown webui option: ${arg}`);
      }
      return { host, port };
    };
    requireValue5 = (argv, index, flag) => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${flag} requires a value`);
      }
      return value;
    };
    waitForChildExit = (child, options) => new Promise((resolveExit) => {
      child.once("error", (cause) => {
        options.error.write(`scorel webui error: ${cause.message}
`);
        resolveExit(1);
      });
      child.once("exit", (code) => {
        resolveExit(typeof code === "number" ? code : 1);
      });
    });
  }
});

// apps/cli/src/index.ts
var index_exports = {};
__export(index_exports, {
  cliAppName: () => cliAppName,
  cliClientDependency: () => cliClientDependency,
  cliDaemonDependency: () => cliDaemonDependency,
  createSigintHandler: () => createSigintHandler,
  runChat: () => runChat,
  runCli: () => runCli
});
import { createHash as createHash3 } from "node:crypto";
import { appendFile as appendFile4, mkdir as mkdir8, readFile as readFile13, realpath as realpath3, readdir as readdir7, writeFile as writeFile8 } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { homedir as homedir9 } from "node:os";
import { fileURLToPath as fileURLToPath4 } from "node:url";
import { basename as basename4, dirname as dirname12, join as join16 } from "node:path";
var cliAppName, cliClientDependency, cliDaemonDependency, defaultSessionsDir, defaultStateDir4, runCli, runProject, runLogs, runAttach, attachCacheScope, attachCacheFilePath, attachDiagnosticsFilePath, findAttachDiagnosticsFilePath, stateDirFromSessionsDir, AttachDiagnostics, readAttachCache, writeAttachCache, emptyAttachCacheSnapshot, mergePersistentEvents, highestSeq, highestCachedStreamSeq, updateAttachCacheSnapshot, removeCompletedTransients, isCachedTransientMessage, AsyncInputQueue, parseAttachOptions, parseLogsOptions, runChat, createSigintHandler, loadOrCreateSession, parseChatOptions, requireValue6, promptIfInteractive, writeUsage, writeProjectUsage, writeEventError, writeToolResult, redactDiagnosticFields, formatDiagnosticLine2, formatDiagnosticValue2, AttachEventRenderer, blocksToText, isCliEntrypoint;
var init_index = __esm({
  async "apps/cli/src/index.ts"() {
    "use strict";
    init_src2();
    init_src4();
    init_src();
    init_daemon_cli();
    init_relay_cli();
    init_relay_server_cli();
    init_up_cli();
    init_webui_cli();
    cliAppName = "@scorel/app-cli";
    cliClientDependency = clientPackageName;
    cliDaemonDependency = daemonPackageName;
    defaultSessionsDir = () => scorelSessionsDir(homedir9());
    defaultStateDir4 = () => join16(homedir9(), ".scorel");
    runCli = async (argv, io = { input: process.stdin, output: process.stdout, error: process.stderr }, runOptions = {}) => {
      const [command, ...rest] = argv;
      if (!command || command === "chat") {
        if (rest.includes("--help") || rest.includes("-h")) {
          writeUsage(io.output);
          return 0;
        }
        const chatOptions = parseChatOptions(rest);
        const sessionsDir = runOptions.sessionsDir ?? chatOptions.sessionsDir;
        return runChat({ ...chatOptions, config: runOptions.config, sessionsDir, stateDir: stateDirFromSessionsDir(sessionsDir) }, io);
      }
      if (command === "daemon") {
        return runCliDaemon(rest, {
          stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
          sessionsDir: runOptions.sessionsDir,
          output: io.output,
          error: io.error
        });
      }
      if (command === "host") {
        return runCliDaemon(rest, {
          stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
          sessionsDir: runOptions.sessionsDir,
          output: io.output,
          error: io.error
        });
      }
      if (command === "relay") {
        return runCliRelay(rest, { output: io.output, error: io.error });
      }
      if (command === "pair") {
        return runCliPair(rest, {
          stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
          output: io.output,
          error: io.error
        });
      }
      if (command === "webui") {
        return runCliWebUi(rest, { output: io.output, error: io.error });
      }
      if (command === "up") {
        return runCliUp(rest, {
          stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
          output: io.output,
          error: io.error
        });
      }
      if (command === "attach") {
        try {
          return runAttach(parseAttachOptions(rest), {
            stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
            cwd: process.cwd(),
            input: io.input,
            output: io.output,
            error: io.error
          });
        } catch (cause) {
          io.error.write(`scorel attach error: ${cause instanceof Error ? cause.message : String(cause)}
`);
          return 1;
        }
      }
      if (command === "project") {
        return runProject(rest, {
          stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
          output: io.output,
          error: io.error
        });
      }
      if (command === "logs") {
        try {
          return runLogs(parseLogsOptions(rest), {
            sessionsDir: runOptions.sessionsDir ?? defaultSessionsDir(),
            stateDir: stateDirFromSessionsDir(runOptions.sessionsDir),
            output: io.output,
            error: io.error
          });
        } catch (cause) {
          io.error.write(`scorel logs error: ${cause instanceof Error ? cause.message : String(cause)}
`);
          return 1;
        }
      }
      writeUsage(io.error);
      return command === "--help" || command === "-h" ? 0 : 1;
    };
    runProject = async (argv, io) => {
      const [command, value, ...extra] = argv;
      if (extra.length > 0 || !["list", "add", "remove"].includes(command ?? "")) {
        writeProjectUsage(io.error);
        return 1;
      }
      if ((command === "add" || command === "remove") && !value) {
        writeProjectUsage(io.error);
        return 1;
      }
      if (command === "list" && value) {
        writeProjectUsage(io.error);
        return 1;
      }
      const state = await readLocalDaemonState({ stateDir: io.stateDir });
      if (!state || state.stoppedAt !== null) {
        io.error.write("scorel project error: local daemon is not running\n");
        return 1;
      }
      const client = new DaemonClient(new WsTransport({ url: state.wsUrl, token: state.token }), {
        clientId: asClientId("client_cli_project")
      });
      try {
        await client.connect();
        if (command === "list") {
          for (const project of await client.listProjects()) {
            io.output.write(`${project.projectId}	${project.displayName}	${project.workDir}
`);
          }
        } else if (command === "add") {
          const project = await client.registerProject(value);
          io.output.write(`${project.projectId}	${project.displayName}	${project.workDir}
`);
        } else {
          await client.removeProject(asProjectId(value));
          io.output.write(`removed ${value}
`);
        }
        return 0;
      } catch (cause) {
        io.error.write(`scorel project error: ${cause instanceof Error ? cause.message : String(cause)}
`);
        return 1;
      } finally {
        client.disconnect();
      }
    };
    runLogs = async (options, io) => {
      const filePath = options.attach ? await findAttachDiagnosticsFilePath(io.stateDir, options.sessionId, options.remoteUrl) : join16(io.sessionsDir, `${options.sessionId}.log`);
      let content;
      try {
        content = await readFile13(filePath, "utf8");
      } catch (cause) {
        io.error.write(`scorel logs error: ${cause instanceof Error ? cause.message : String(cause)}
`);
        return 1;
      }
      const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
      const selected = options.tail === void 0 ? lines : lines.slice(-options.tail);
      if (selected.length > 0) {
        io.output.write(`${selected.join("\n")}
`);
      }
      return 0;
    };
    runAttach = async (options, io) => {
      const transport = new WsTransport({ url: options.remoteUrl, token: options.token });
      const client = new DaemonClient(transport, {
        clientId: asClientId("client_cli_attach")
      });
      const diagnostics = new AttachDiagnostics(io.stateDir, options.sessionId);
      try {
        diagnostics.record("attach_connect_started", {
          remoteUrl: options.remoteUrl
        });
        await client.connect();
        const loaded = await client.loadSession(options.sessionId);
        const renderer = new AttachEventRenderer(io.output, io.error);
        const cacheScope = attachCacheScope(client.connectionIdentity, loaded.meta.projectId);
        diagnostics.setScope(cacheScope);
        diagnostics.record("attach_connect_succeeded", {
          scopeKind: cacheScope.kind,
          scopeLocator: cacheScope.locator,
          deviceId: client.connectionIdentity?.deviceId,
          deviceDisplayName: client.connectionIdentity?.deviceDisplayName,
          projectId: loaded.meta.projectId
        });
        diagnostics.record("attach_cache_scope_resolved", {
          scopeKind: cacheScope.kind,
          scopeLocator: cacheScope.locator,
          displayName: cacheScope.displayName
        });
        const cacheSnapshot = await readAttachCache(io.stateDir, cacheScope, options.sessionId);
        diagnostics.record("attach_cache_read", {
          persistentEvents: cacheSnapshot.events.length,
          transients: cacheSnapshot.transients.length
        });
        const persistCache = async () => {
          await writeAttachCache(io.stateDir, cacheScope, options.sessionId, cacheSnapshot);
          diagnostics.record("attach_cache_written", {
            persistentEvents: cacheSnapshot.events.length,
            transients: cacheSnapshot.transients.length
          });
        };
        const unsubscribe = client.subscribe((event) => {
          renderer.renderLive(event);
          updateAttachCacheSnapshot(cacheSnapshot, event);
          diagnostics.record("attach_event_rendered", {
            type: event.type,
            seq: "seq" in event ? event.seq : void 0
          });
          void persistCache();
        });
        diagnostics.record("attach_session_loaded");
        renderer.writeLine(`scorel attach resumed session ${options.sessionId}`);
        renderer.renderBacklog(cacheSnapshot.events);
        renderer.renderTransientBacklog(cacheSnapshot.transients);
        const persistentLastSeq = highestSeq(cacheSnapshot.events);
        const resync = await client.resync({
          persistentLastSeq,
          streamLastSeq: highestCachedStreamSeq(cacheSnapshot)
        });
        diagnostics.record("attach_resync_finished", {
          mode: resync.mode,
          throughSeq: resync.throughSeq,
          persistentLastSeq,
          streamLastSeq: highestCachedStreamSeq(cacheSnapshot),
          receivedEvents: client.getEvents().length
        });
        if (resync.mode === "full_reload" && cacheSnapshot.events.length > 0) {
          renderer.writeLine("scorel attach authoritative reload follows cached history");
        }
        renderer.renderBacklog(client.getEvents());
        cacheSnapshot.events = mergePersistentEvents([...cacheSnapshot.events, ...client.getEvents()]);
        cacheSnapshot.transients = removeCompletedTransients(cacheSnapshot.transients, cacheSnapshot.events);
        await persistCache();
        renderer.promptIfInteractive();
        const rl = createInterface({ input: io.input, crlfDelay: Infinity });
        const inputQueue = new AsyncInputQueue();
        const inputWorker = (async () => {
          for (; ; ) {
            const line = await inputQueue.next();
            if (line === null) {
              return;
            }
            if (line === ".exit" || line === ".quit") {
              return;
            }
            diagnostics.record("attach_send_message_started", { contentLength: line.length });
            try {
              await client.sendMessage(line);
              diagnostics.record("attach_send_message_finished", { contentLength: line.length });
            } catch (cause) {
              diagnostics.record("attach_send_message_error", {
                message: cause instanceof Error ? cause.message : String(cause)
              });
              throw cause;
            }
            renderer.endLine();
            renderer.promptIfInteractive();
          }
        })();
        try {
          for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (line.length === 0) {
              continue;
            }
            inputQueue.push(line);
            if (line === ".exit" || line === ".quit") {
              break;
            }
          }
          inputQueue.close();
          await inputWorker;
        } finally {
          inputQueue.close();
          unsubscribe();
          rl.close();
          await persistCache();
        }
        diagnostics.record("attach_disconnected");
        await diagnostics.flush();
        client.disconnect();
        return 0;
      } catch (cause) {
        diagnostics.record("attach_failed", { message: cause instanceof Error ? cause.message : String(cause) });
        await diagnostics.flush();
        io.error.write(`scorel attach error: ${cause instanceof Error ? cause.message : String(cause)}
`);
        return 1;
      }
    };
    attachCacheScope = (identity, projectId) => {
      if (!identity.deviceId) {
        throw new Error("Remote daemon handshake is missing deviceId");
      }
      return {
        kind: "remote",
        locator: `device:${identity.deviceId}/project:${projectId}`,
        displayName: identity.deviceDisplayName
      };
    };
    attachCacheFilePath = (stateDir, scope, sessionId) => {
      const scopeKey = createHash3("sha256").update(`${scope.kind}\0${scope.locator}`).digest("hex").slice(0, 24);
      return join16(stateDir, "attach-cache", scopeKey, `${sessionId}.json`);
    };
    attachDiagnosticsFilePath = (stateDir, scope, sessionId) => {
      const scopeKey = createHash3("sha256").update(`${scope.kind}\0${scope.locator}`).digest("hex").slice(0, 24);
      return join16(stateDir, "attach-cache", scopeKey, `${sessionId}.log`);
    };
    findAttachDiagnosticsFilePath = async (stateDir, sessionId, _remoteUrl) => {
      const root = join16(stateDir, "attach-cache");
      const scopes = await readdir7(root).catch(() => []);
      for (const scope of scopes) {
        const candidate = join16(root, scope, `${sessionId}.log`);
        try {
          await readFile13(candidate, "utf8");
          return candidate;
        } catch {
          continue;
        }
      }
      return join16(root, "__missing__", `${sessionId}.log`);
    };
    stateDirFromSessionsDir = (sessionsDir) => {
      if (!sessionsDir) {
        return defaultStateDir4();
      }
      return basename4(sessionsDir) === "sessions" ? dirname12(sessionsDir) : sessionsDir;
    };
    AttachDiagnostics = class {
      #stateDir;
      #sessionId;
      #pendingLines = [];
      #writes = [];
      #scope;
      constructor(stateDir, sessionId) {
        this.#stateDir = stateDir;
        this.#sessionId = sessionId;
      }
      setScope(scope) {
        this.#scope = scope;
        for (const line of this.#pendingLines.splice(0)) {
          this.#append(line);
        }
      }
      ensureScope(scope) {
        if (!this.#scope) {
          this.setScope(scope);
        }
      }
      record(event, fields = {}) {
        const line = formatDiagnosticLine2({
          ts: Date.now(),
          level: event.endsWith("_error") || event.endsWith("_failed") ? "error" : "info",
          event,
          sessionId: this.#sessionId,
          ...redactDiagnosticFields(fields)
        });
        if (!this.#scope) {
          this.#pendingLines.push(line);
          return;
        }
        this.#append(line);
      }
      async flush() {
        if (this.#scope) {
          for (const line of this.#pendingLines.splice(0)) {
            this.#append(line);
          }
        }
        await Promise.allSettled(this.#writes);
      }
      #append(line) {
        if (!this.#scope) {
          this.#pendingLines.push(line);
          return;
        }
        const filePath = attachDiagnosticsFilePath(this.#stateDir, this.#scope, this.#sessionId);
        this.#writes.push(
          mkdir8(dirname12(filePath), { recursive: true }).then(() => appendFile4(filePath, `${line}
`, "utf8"))
        );
      }
    };
    readAttachCache = async (stateDir, scope, sessionId) => {
      try {
        const raw = JSON.parse(await readFile13(attachCacheFilePath(stateDir, scope, sessionId), "utf8"));
        if (raw.version !== 1 || raw.sessionId !== String(sessionId) || raw.scope.kind !== scope.kind || raw.scope.locator !== scope.locator || !Array.isArray(raw.events)) {
          return emptyAttachCacheSnapshot();
        }
        const events = mergePersistentEvents(raw.events);
        return {
          events,
          transients: removeCompletedTransients(
            Array.isArray(raw.transients) ? raw.transients.filter(isCachedTransientMessage) : [],
            events
          )
        };
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return emptyAttachCacheSnapshot();
        }
        return emptyAttachCacheSnapshot();
      }
    };
    writeAttachCache = async (stateDir, scope, sessionId, snapshot) => {
      const filePath = attachCacheFilePath(stateDir, scope, sessionId);
      const uniqueEvents = mergePersistentEvents(snapshot.events);
      const transients = removeCompletedTransients(snapshot.transients, uniqueEvents);
      await mkdir8(dirname12(filePath), { recursive: true });
      await writeFile8(
        filePath,
        `${JSON.stringify({ version: 1, scope, sessionId: String(sessionId), events: uniqueEvents, transients }, null, 2)}
`
      );
    };
    emptyAttachCacheSnapshot = () => ({ events: [], transients: [] });
    mergePersistentEvents = (events) => {
      const byId = /* @__PURE__ */ new Map();
      for (const event of events) {
        byId.set(String(event.id), event);
      }
      return [...byId.values()].sort((left, right) => Number(left.seq) - Number(right.seq));
    };
    highestSeq = (events) => asSeq(events.reduce((max, event) => Math.max(max, Number(event.seq)), 0));
    highestCachedStreamSeq = (snapshot) => asSeq(Math.max(Number(highestSeq(snapshot.events)), ...snapshot.transients.map((event) => event.seq), 0));
    updateAttachCacheSnapshot = (snapshot, event) => {
      if ("id" in event) {
        snapshot.events = mergePersistentEvents([...snapshot.events, event]);
        snapshot.transients = removeCompletedTransients(snapshot.transients, snapshot.events);
        return;
      }
      if (event.type !== "text_delta") {
        return;
      }
      const existing = snapshot.transients.find((candidate) => candidate.eventId === String(event.eventId));
      if (existing) {
        existing.seq = Math.max(existing.seq, Number(event.seq));
        existing.text += event.delta;
      } else {
        snapshot.transients.push({
          eventId: String(event.eventId),
          seq: Number(event.seq),
          text: event.delta
        });
      }
    };
    removeCompletedTransients = (transients, events) => {
      const persistentIds = new Set(events.map((event) => String(event.id)));
      return transients.filter((transient) => !persistentIds.has(transient.eventId) && transient.text.length > 0);
    };
    isCachedTransientMessage = (value) => typeof value === "object" && value !== null && "eventId" in value && "seq" in value && "text" in value && typeof value.eventId === "string" && typeof value.seq === "number" && typeof value.text === "string";
    AsyncInputQueue = class {
      #items = [];
      #closed = false;
      #notify;
      push(line) {
        if (this.#closed) {
          return;
        }
        this.#items.push(line);
        this.#notify?.();
        this.#notify = void 0;
      }
      close() {
        this.#closed = true;
        this.#notify?.();
        this.#notify = void 0;
      }
      async next() {
        while (this.#items.length === 0 && !this.#closed) {
          await new Promise((resolve7) => {
            this.#notify = resolve7;
          });
        }
        return this.#items.shift() ?? null;
      }
    };
    parseAttachOptions = (argv) => {
      let sessionId = asSessionId("ses_default");
      let remoteUrl;
      let token;
      for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--session") {
          sessionId = asSessionId(requireValue6(argv, index, "--session"));
          index += 1;
          continue;
        }
        if (arg === "--remote") {
          remoteUrl = requireValue6(argv, index, "--remote");
          index += 1;
          continue;
        }
        if (arg === "--token") {
          token = requireValue6(argv, index, "--token");
          index += 1;
          continue;
        }
        throw new Error(`Unknown attach option: ${arg}`);
      }
      if (!remoteUrl) {
        throw new Error("--remote is required (e.g. --remote ws://127.0.0.1:7777)");
      }
      if (!token) {
        throw new Error("--token is required with --remote");
      }
      return { sessionId, remoteUrl, token };
    };
    parseLogsOptions = (argv) => {
      let sessionId;
      let tail;
      let attach = false;
      let remoteUrl;
      for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--attach") {
          attach = true;
          continue;
        }
        if (arg === "--remote") {
          remoteUrl = requireValue6(argv, index, "--remote");
          index += 1;
          continue;
        }
        if (arg === "--session") {
          sessionId = asSessionId(requireValue6(argv, index, "--session"));
          index += 1;
          continue;
        }
        if (arg === "--tail") {
          tail = Number(requireValue6(argv, index, "--tail"));
          if (!Number.isInteger(tail) || tail < 0) {
            throw new Error("--tail must be a non-negative integer");
          }
          index += 1;
          continue;
        }
        throw new Error(`Unknown logs option: ${arg}`);
      }
      if (!sessionId) {
        throw new Error("--session requires a value");
      }
      return { sessionId, tail, attach, remoteUrl };
    };
    runChat = async (options, io) => {
      const loadProjectConfig = async (project2) => options.config ?? await loadScorelConfig({ cwd: project2.workDir });
      const loadProjectConfigProfile = async (project2) => options.config ?? await loadScorelConfigProfile({ cwd: project2.workDir });
      const daemon = new ScorelHost({
        sessionsDir: options.sessionsDir,
        projectsPath: join16(options.stateDir, "projects.json"),
        deviceId: asDeviceId("device_local"),
        loadConfig: async ({ project: project2 }) => loadProjectConfig(project2),
        loadConfigProfile: async ({ project: project2 }) => loadProjectConfigProfile(project2),
        createRuntime: async ({ project: project2, selectedModel, purpose }) => createRealRuntime({
          cwd: project2.workDir,
          config: await loadProjectConfig(project2),
          modelSelection: selectedModel ? { modelId: selectedModel.modelId, role: selectedModel.role } : void 0,
          includeTools: purpose === "chat"
        })
      });
      const client = new DaemonClient(createEmbeddedTransport(daemon), {
        clientId: asClientId("client_cli")
      });
      await daemon.start();
      const project = await daemon.registerProject(options.cwd);
      let inFlight = false;
      let rlClose = () => void 0;
      const sigintHandler = createSigintHandler({
        isInFlight: () => inFlight,
        cancel: () => client.cancel().then(() => void 0).catch(() => void 0),
        output: io.output,
        exit: () => rlClose()
      });
      process.on("SIGINT", sigintHandler);
      try {
        await client.connect(options.sessionId);
        const resumed = await loadOrCreateSession(client, options, project.projectId);
        io.error.write(`scorel chat ${resumed ? "resumed" : "created"} session ${options.sessionId}
`);
        const rl = createInterface({ input: io.input, crlfDelay: Infinity });
        rlClose = () => rl.close();
        promptIfInteractive(io.output);
        for await (const rawLine of rl) {
          const line = rawLine.trim();
          if (line.length === 0) {
            promptIfInteractive(io.output);
            continue;
          }
          if (line === ".exit" || line === ".quit") {
            break;
          }
          const unsubscribe = client.subscribe((event) => {
            if (event.type === "text_delta") {
              io.output.write(event.delta);
            }
            if (event.type === "tool_result") {
              writeToolResult(io.output, event);
            }
            if (event.type === "error") {
              writeEventError(io.error, event);
            }
          });
          inFlight = true;
          try {
            await client.sendMessage(line);
            io.output.write("\n");
          } finally {
            inFlight = false;
            unsubscribe();
          }
          promptIfInteractive(io.output);
        }
        rl.close();
        return 0;
      } catch (cause) {
        io.error.write(`scorel chat error: ${cause instanceof Error ? cause.message : String(cause)}
`);
        return 1;
      } finally {
        process.off("SIGINT", sigintHandler);
        client.disconnect();
        await daemon.shutdown();
      }
    };
    createSigintHandler = (options) => {
      return () => {
        if (options.isInFlight()) {
          options.output.write("\n[cancelled]\n");
          void options.cancel().catch(() => void 0);
          return;
        }
        options.exit();
      };
    };
    loadOrCreateSession = async (client, options, projectId) => {
      try {
        await client.loadSession(options.sessionId);
        return true;
      } catch {
        await client.createSession({
          sessionId: options.sessionId,
          meta: { projectId }
        });
        return false;
      }
    };
    parseChatOptions = (argv) => {
      let sessionId = asSessionId("ses_default");
      let cwd = process.cwd();
      for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--session") {
          sessionId = asSessionId(requireValue6(argv, index, "--session"));
          index += 1;
          continue;
        }
        if (arg === "--cwd") {
          cwd = requireValue6(argv, index, "--cwd");
          index += 1;
          continue;
        }
        throw new Error(`Unknown chat option: ${arg}`);
      }
      const sessionsDir = defaultSessionsDir();
      return { sessionId, sessionsDir, stateDir: stateDirFromSessionsDir(sessionsDir), cwd };
    };
    requireValue6 = (argv, index, flag) => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${flag} requires a value`);
      }
      return value;
    };
    promptIfInteractive = (output) => {
      if (output.isTTY) {
        output.write("> ");
      }
    };
    writeUsage = (output) => {
      output.write(
        [
          "Usage: scorel chat [--session <id>] [--cwd <dir>]",
          "       scorel [--session <id>] [--cwd <dir>]",
          "       scorel attach --session <id> --remote <ws-url> --token <token>",
          "       scorel host start [--host <h>] [--port <p>] [--token <t>] [--project <dir>]",
          "                        [--relay <relay-url> | --no-relay] [--replace] [--idle-timeout-ms <ms>]",
          "       scorel host serve [--host <h>] [--port <p>] [--token <t>] [--project <dir>]",
          "                        [--relay <relay-url> | --no-relay] [--replace] [--idle-timeout-ms <ms>]",
          "       scorel host status [--show-token]",
          "       scorel host stop",
          "       scorel host reset",
          "       scorel pair <pair-code> [--relay <relay-url>]",
          "       scorel relay serve [--host <h>] [--port <p>] [--data-dir <dir>]",
          "       scorel webui [--port <p>] [--host <h>]",
          "       scorel up [--daemon-port <p>] [--webui-port <p>] [--cwd <d>]",
          "       scorel logs [--attach] --session <id> [--remote <ws-url>] [--tail <n>]",
          "       scorel project list",
          "       scorel project add <dir>",
          "       scorel project remove <project-id>"
        ].join("\n") + "\n"
      );
    };
    writeProjectUsage = (output) => {
      output.write("Usage: scorel project list | add <dir> | remove <project-id>\n");
    };
    writeEventError = (output, event) => {
      output.write(`scorel event error: ${event.message}
`);
    };
    writeToolResult = (output, event) => {
      const block = event.message.content.find((candidate) => candidate.type === "tool_result");
      if (!block || typeof block.result !== "object" || block.result === null) {
        return;
      }
      const result = block.result;
      const text = result.content?.find((candidate) => candidate.type === "text")?.text ?? "";
      output.write(`
[tool:${block.toolName}]${block.isError ? " error" : ""}
${text}
`);
    };
    redactDiagnosticFields = (fields) => Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        /token|secret|api[-_]?key|authorization/i.test(key) ? "[redacted]" : value
      ])
    );
    formatDiagnosticLine2 = (fields) => Object.entries(fields).filter(([, value]) => value !== void 0 && value !== null).map(([key, value]) => `${key}=${formatDiagnosticValue2(value)}`).join(" ");
    formatDiagnosticValue2 = (value) => {
      const text = typeof value === "string" ? value : String(value);
      return /^[A-Za-z0-9_./:@+-]+$/.test(text) ? text : JSON.stringify(text);
    };
    AttachEventRenderer = class {
      #output;
      #error;
      #printedPersistentIds = /* @__PURE__ */ new Set();
      #streamedMessageIds = /* @__PURE__ */ new Set();
      #atLineStart = true;
      constructor(output, error) {
        this.#output = output;
        this.#error = error;
      }
      renderBacklog(events) {
        for (const event of events) {
          this.#render(event);
        }
      }
      renderTransientBacklog(transients) {
        for (const transient of transients) {
          this.#streamedMessageIds.add(transient.eventId);
          this.#write(transient.text);
        }
      }
      renderLive(event) {
        this.#render(event);
      }
      endLine() {
        if (!this.#atLineStart) {
          this.#write("\n");
        }
      }
      writeLine(text) {
        this.#ensureLineStart();
        this.#write(`${text}
`);
      }
      promptIfInteractive() {
        if (this.#output.isTTY) {
          this.#write("> ");
        }
      }
      #render(event) {
        if (event.type === "text_delta") {
          this.#streamedMessageIds.add(String(event.eventId));
          this.#write(event.delta);
          return;
        }
        if (event.type === "error") {
          this.endLine();
          writeEventError(this.#error, event);
          return;
        }
        if (!("id" in event) || this.#printedPersistentIds.has(String(event.id))) {
          return;
        }
        this.#printedPersistentIds.add(String(event.id));
        if (event.type === "user_message") {
          this.#ensureLineStart();
          this.#write(`[user] ${blocksToText(event.message.content)}
`);
          return;
        }
        if (event.type === "assistant_message") {
          if (this.#streamedMessageIds.has(String(event.id))) {
            this.endLine();
            return;
          }
          const text = blocksToText(event.message.content);
          if (text.length > 0) {
            this.#ensureLineStart();
            this.#write(`${text}
`);
          }
          return;
        }
        if (event.type === "tool_result") {
          this.#ensureLineStart();
          writeToolResult(this.#output, event);
          this.#atLineStart = true;
        }
      }
      #ensureLineStart() {
        if (!this.#atLineStart) {
          this.#write("\n");
        }
      }
      #write(text) {
        this.#output.write(text);
        this.#atLineStart = text.endsWith("\n");
      }
    };
    blocksToText = (blocks) => blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
    isCliEntrypoint = async () => {
      if (!process.argv[1]) return false;
      const [argvPath, modulePath] = await Promise.all([
        realpath3(process.argv[1]).catch(() => process.argv[1]),
        realpath3(fileURLToPath4(import.meta.url)).catch(() => fileURLToPath4(import.meta.url))
      ]);
      return argvPath === modulePath;
    };
    if (process.env.SCOREL_SKIP_INDEX_ENTRY !== "1" && await isCliEntrypoint()) {
      runCli(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
      });
    }
  }
});

// apps/cli/src/bin.ts
process.env.SCOREL_SKIP_INDEX_ENTRY = "1";
var { runCli: runCli2 } = await init_index().then(() => index_exports);
runCli2(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
//# sourceMappingURL=index.js.map
