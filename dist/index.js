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
        return new Promise((resolve5, reject) => {
          this.#pending.set(String(requestId), { resolve: resolve5, reject });
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
        return new Promise((resolve5, reject) => {
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
            resolve5({
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
var listSessionSummaries, readSummary, tailSeq, clampLimit, parseRecord, isRecord2, isNodeError2;
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
      return {
        sessionId: asSessionId(header.sessionId),
        projectId: asProjectId(header.meta.projectId),
        title: typeof header.meta.title === "string" ? header.meta.title : void 0,
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
var SCOREL_CONFIG_SCHEMA, scorelUserRoot, scorelUserConfigPath, scorelSessionsDir, scorelProjectConfigPath, loadScorelConfig, readConfigText, parseToml, stripComment, requireString, requireNumber, requireBoolean, requireCustomApi, requireSection, ensureSection, setConfigValue, assertKnownKey, setModelValue, parseTomlValue, stripTrailingSlashes;
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
        model: {
          keys: [
            "type",
            "provider",
            "id",
            "api",
            "baseUrl",
            "apiKeyEnv",
            "contextWindow",
            "maxTokens",
            "reasoning",
            "supportsDeveloperRole"
          ]
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
      const model = raw.model;
      if (!model) {
        throw new Error("model config is required");
      }
      const apiKeyEnv = requireString(model.apiKeyEnv, "model.apiKeyEnv");
      const apiKey = env[apiKeyEnv];
      if (!apiKey) {
        throw new Error(`${apiKeyEnv} is not set`);
      }
      if (model.type === "builtin") {
        return {
          model: {
            type: "builtin",
            provider: requireString(model.provider, "model.provider"),
            id: requireString(model.id, "model.id"),
            ...model.baseUrl ? { baseUrl: stripTrailingSlashes(model.baseUrl) } : {},
            apiKey
          }
        };
      }
      if (model.type === "custom") {
        const api = requireCustomApi(model.api);
        return {
          model: {
            type: "custom",
            api,
            provider: requireString(model.provider, "model.provider"),
            id: requireString(model.id, "model.id"),
            baseUrl: stripTrailingSlashes(requireString(model.baseUrl, "model.baseUrl")),
            contextWindow: requireNumber(model.contextWindow, "model.contextWindow"),
            maxTokens: requireNumber(model.maxTokens, "model.maxTokens"),
            reasoning: requireBoolean(model.reasoning, "model.reasoning"),
            ...model.supportsDeveloperRole === void 0 ? {} : { compat: { supportsDeveloperRole: requireBoolean(model.supportsDeveloperRole, "model.supportsDeveloperRole") } },
            apiKey
          }
        };
      }
      throw new Error("model.type must be builtin or custom");
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
      const result = {};
      let section2 = "root";
      for (const rawLine of text.split(/\r?\n/)) {
        const line = stripComment(rawLine).trim();
        if (line.length === 0) {
          continue;
        }
        const sectionMatch = /^\[([A-Za-z0-9_-]+)\]$/.exec(line);
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
    requireNumber = (value, name) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${name} is required`);
      }
      return value;
    };
    requireBoolean = (value, name) => {
      if (typeof value !== "boolean") {
        throw new Error(`${name} is required`);
      }
      return value;
    };
    requireCustomApi = (value) => {
      if (value === "openai-completions" || value === "openai-responses" || value === "google-generative-ai" || value === "anthropic-messages") {
        return value;
      }
      throw new Error("model.api must be openai-completions, openai-responses, google-generative-ai, or anthropic-messages");
    };
    requireSection = (section2) => {
      if (section2 in SCOREL_CONFIG_SCHEMA.sections) {
        return section2;
      }
      throw new Error(`Unsupported config section: ${section2}`);
    };
    ensureSection = (config, section2) => {
      if (section2 === "model") {
        config.model ??= {};
      }
    };
    setConfigValue = (config, section2, key, value) => {
      assertKnownKey(section2, key);
      if (section2 === "model") {
        config.model ??= {};
        setModelValue(config.model, key, value);
      }
    };
    assertKnownKey = (section2, key) => {
      const allowed = SCOREL_CONFIG_SCHEMA.sections[section2].keys;
      if (!allowed.includes(key)) {
        throw new Error(`Unsupported config key: ${key}`);
      }
    };
    setModelValue = (model, key, value) => {
      model[key] = value;
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
  }
});

// packages/core/src/instructions/index.ts
import { existsSync } from "node:fs";
import { readdir as readdir4, readFile as readFile4 } from "node:fs/promises";
import { homedir as homedir2, platform, release } from "node:os";
import { dirname as dirname3, join as join5, resolve } from "node:path";
var BASELINE_PROMPT, buildInstructionSnapshot, renderSystemPrompt, section, discoverAgentsSources, projectAgentsPaths, findGitRoot, renderAgentsBlock, renderWorkspaceBlock, renderEnvironmentBlock, renderTimeBlock, isNodeErrorCode;
var init_instructions = __esm({
  "packages/core/src/instructions/index.ts"() {
    "use strict";
    BASELINE_PROMPT = [
      "You are Scorel, a coding agent running inside a recoverable local workspace.",
      "Follow the user's request, respect the project instructions, use tools deliberately, and keep changes scoped to the active task.",
      "Tool results and user messages may include <system-reminder> tags. These tags contain information automatically added by Scorel's harness. They are not part of the specific tool result or user message in which they appear."
    ].join("\n");
    buildInstructionSnapshot = async (options) => {
      const cwd = resolve(options.cwd);
      const now = options.now ?? Date.now;
      const frozenAt = now();
      const homeDir = resolve(options.homeDir ?? homedir2());
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
          const content = await readFile4(candidate.path, "utf8");
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
        if (current === stopAt || current === dirname3(current)) {
          break;
        }
        const next = dirname3(current);
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
        const next = dirname3(current);
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

// packages/core/src/provider/pi-ai.ts
import {
  Type,
  getModels,
  streamSimple
} from "@mariozechner/pi-ai";
var createPiAiProvider, resolvePiAiModel, toPiContext, toPiMessage, toPiAssistantBlock, fromPiAssistant, fromPiContentBlock, toPiTool, toolParameters, textContent, toolResultText, stringMeta, toPiStopReason, fromPiStopReason, fromPiUsage;
var init_pi_ai = __esm({
  "packages/core/src/provider/pi-ai.ts"() {
    "use strict";
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
          reasoning: config.reasoning,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: config.contextWindow,
          maxTokens: config.maxTokens,
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
var ScorelRuntime, normalizeAssistantMessage, isAssistantMessage, partialAssistantMessage;
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
              const message = normalizeAssistantMessage(next.value, text, signal.aborted ? "cancelled" : "end_turn");
              if (message) {
                yield { type: "message_end", message };
              }
              return { message, stopReason: message?.stopReason ?? "end_turn" };
            }
            if (next.value.type === "text_delta") {
              text += next.value.delta;
              yield next.value;
            }
          }
          const cancelledMessage = partialAssistantMessage(text, "cancelled");
          if (cancelledMessage) {
            yield { type: "message_end", message: cancelledMessage };
          }
          return { stopReason: "cancelled" };
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          const partial = partialAssistantMessage(text, "error");
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
          result,
          isError
        };
        return {
          role: "tool_result",
          content: [block]
        };
      }
    };
    normalizeAssistantMessage = (value, text, fallbackStopReason) => {
      if (value) {
        if (!isAssistantMessage(value)) {
          throw new Error(`Provider returned ${value.role} message instead of assistant`);
        }
        return value;
      }
      return partialAssistantMessage(text, fallbackStopReason);
    };
    isAssistantMessage = (message) => message.role === "assistant";
    partialAssistantMessage = (text, stopReason) => {
      if (text.length === 0) {
        return void 0;
      }
      return {
        role: "assistant",
        content: [{ type: "text", text }],
        stopReason,
        meta: stopReason === "end_turn" ? void 0 : { partial: true }
      };
    };
  }
});

// packages/core/src/session/index.ts
import { appendFile, mkdir as mkdir2, readFile as readFile5, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname4, join as join6 } from "node:path";
function assertTreeEvent(value) {
  if (!isRecord3(value)) {
    throw new SessionStoreError("invalid_event", "Event must be an object");
  }
  if (value.type === "session_header") {
    throw new SessionStoreError("invalid_event", "Session header must be stored as the JSONL header line");
  }
  if (value.type !== "user_message" && value.type !== "assistant_message" && value.type !== "tool_result" && value.type !== "instruction_snapshot" && value.type !== "harness_item" && value.type !== "queue_update" && value.type !== "skill_index_snapshot" && value.type !== "skill_index_delta") {
    throw new SessionStoreError("invalid_event", "Unsupported session event type");
  }
  if (typeof value.id !== "string" || value.parentId !== null && typeof value.parentId !== "string" || typeof value.seq !== "number" || typeof value.clientId !== "string" || typeof value.ts !== "number") {
    throw new SessionStoreError("invalid_event", "Event is missing required base fields");
  }
  if ((value.type === "user_message" || value.type === "assistant_message" || value.type === "tool_result") && !isRecord3(value.message)) {
    throw new SessionStoreError("invalid_event", "Message event is missing message payload");
  }
  if (value.type === "instruction_snapshot" && !isInstructionSnapshot(value.snapshot)) {
    throw new SessionStoreError("invalid_event", "instruction_snapshot is missing snapshot payload");
  }
  if (value.type === "harness_item" && !isHarnessItem(value.item)) {
    throw new SessionStoreError("invalid_event", "harness_item is missing item payload");
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
var SessionStoreError, SessionTree, JsonlSession, sessionFilePath, sessionLogFilePath, createSession, loadSession, buildContext, parseJsonLine, parseHeader, parseSessionEvent, validateSessionMatch, isConversationEvent, isInstructionSnapshot, isHarnessItem, isQueueUpdate, isSkillIndexSnapshot, isSkillIndexDelta, isSkillIndexEntry, appendHarnessItemToContext, appendReminderToToolResult, isToolResultWithContent, renderSystemReminder, cloneMessage, isRecord3;
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
        await appendFile(this.filePath, `${JSON.stringify(event)}
`, "utf8");
        this.tree.append(event);
        return event;
      }
      async close() {
        return Promise.resolve();
      }
    };
    sessionFilePath = (sessionsDir, sessionId) => join6(sessionsDir, `${sessionId}.jsonl`);
    sessionLogFilePath = (sessionsDir, sessionId) => join6(sessionsDir, `${sessionId}.log`);
    createSession = async ({ sessionsDir, header }) => {
      const validHeader = parseHeader(header);
      await mkdir2(sessionsDir, { recursive: true });
      const filePath = sessionFilePath(sessionsDir, validHeader.sessionId);
      await writeFile2(filePath, `${JSON.stringify(validHeader)}
`, { encoding: "utf8", flag: "wx" });
      return new JsonlSession(filePath, validHeader);
    };
    loadSession = async (options) => {
      const filePath = options.filePath !== void 0 ? options.filePath : sessionFilePath(options.sessionsDir, options.sessionId);
      const content = await readFile5(filePath, "utf8");
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
      await mkdir2(dirname4(filePath), { recursive: true });
      return new JsonlSession(filePath, header, tree);
    };
    buildContext = (tree, leafId) => tree.getPath(leafId).reduce((messages, id) => {
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
      return messages;
    }, []);
    parseJsonLine = (line, lineNumber) => {
      try {
        return JSON.parse(line);
      } catch (cause) {
        throw new SessionStoreError("invalid_json", `Invalid JSON at line ${lineNumber}`, { line: lineNumber });
      }
    };
    parseHeader = (value) => {
      if (!isRecord3(value)) {
        throw new SessionStoreError("invalid_header", "Session header must be an object");
      }
      if (value.version !== 1 || typeof value.sessionId !== "string" || typeof value.deviceId !== "string") {
        throw new SessionStoreError("invalid_header", "Session header is missing required identity fields");
      }
      if (typeof value.createdAt !== "number" || !isRecord3(value.meta)) {
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
      if (!isRecord3(value) || typeof value.sessionId !== "string") {
        throw new SessionStoreError("invalid_header", "Event must be an object with a sessionId");
      }
      if (value.sessionId !== header.sessionId) {
        throw new SessionStoreError("session_mismatch", `Event belongs to ${value.sessionId}, expected ${header.sessionId}`);
      }
    };
    isConversationEvent = (event) => event.type === "user_message" || event.type === "assistant_message" || event.type === "tool_result" || event.type === "harness_item";
    isInstructionSnapshot = (value) => {
      if (!isRecord3(value) || value.version !== 1 || typeof value.cwd !== "string" || !Array.isArray(value.sections)) {
        return false;
      }
      return value.sections.every(
        (section2) => isRecord3(section2) && typeof section2.kind === "string" && typeof section2.frozenAt === "number" && typeof section2.renderedBlock === "string"
      );
    };
    isHarnessItem = (value) => isRecord3(value) && typeof value.kind === "string" && typeof value.origin === "string" && typeof value.content === "string" && (value.visibility === "display" || value.visibility === "hidden" || value.visibility === "compact");
    isQueueUpdate = (value) => (value.queue === "follow_up" || value.queue === "steer") && value.operation === "rewrite" && Array.isArray(value.items) && (value.anchorEventId === null || typeof value.anchorEventId === "string") && value.items.every(
      (item) => isRecord3(item) && typeof item.id === "string" && Array.isArray(item.content) && typeof item.createdAt === "number" && typeof item.updatedAt === "number" && typeof item.clientId === "string"
    );
    isSkillIndexSnapshot = (value) => (value.anchorEventId === null || typeof value.anchorEventId === "string") && Array.isArray(value.entries) && value.entries.every(isSkillIndexEntry);
    isSkillIndexDelta = (value) => (value.anchorEventId === null || typeof value.anchorEventId === "string") && Array.isArray(value.added) && Array.isArray(value.changed) && Array.isArray(value.removed) && value.added.every(isSkillIndexEntry) && value.changed.every(isSkillIndexEntry) && value.removed.every(
      (item) => isRecord3(item) && typeof item.name === "string" && typeof item.previousPath === "string"
    );
    isSkillIndexEntry = (value) => isRecord3(value) && typeof value.name === "string" && typeof value.path === "string" && (value.scope === "user" || value.scope === "project") && typeof value.description === "string" && typeof value.mtimeMs === "number" && typeof value.size === "number" && typeof value.contentHash === "string" && typeof value.priority === "number";
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
    isToolResultWithContent = (value) => isRecord3(value) && Array.isArray(value.content);
    renderSystemReminder = (content) => `<system-reminder>
${content}
</system-reminder>`;
    cloneMessage = (message) => ({
      ...message,
      content: message.content.map((block) => {
        if (block.type !== "tool_result" || !isRecord3(block.result)) {
          return { ...block };
        }
        const content = Array.isArray(block.result.content) ? { content: block.result.content.map((item) => isRecord3(item) ? { ...item } : item) } : {};
        return {
          ...block,
          result: {
            ...block.result,
            ...content
          }
        };
      }),
      ...message.meta ? { meta: { ...message.meta } } : {}
    });
    isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  }
});

// packages/core/src/tools/coding-tools.ts
import { createHash, randomUUID as randomUUID2 } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir as mkdir3, readFile as readFile6, rename as rename2, rm, stat as stat3, writeFile as writeFile3 } from "node:fs/promises";
import { dirname as dirname5, extname, isAbsolute, relative, resolve as resolve2 } from "node:path";
import { promisify } from "node:util";
var execFileAsync, DEFAULT_SEARCH_LIMIT, DEFAULT_GREP_LIMIT, DEFAULT_READ_LIMIT, DEFAULT_CONTEXT_WINDOW, READ_TOKEN_BUDGET_RATIO, FULL_READ_TOKEN_BUDGET_RATIO, createCodingTools, parseReadArgs, parseWriteArgs, parseEditArgs, parseBashArgs, parseGlobArgs, parseGrepArgs, parseTodoWriteArgs, parseTodoItem, expectRecord, expectPath, expectString, optionalString, optionalNumber, optionalBoolean, snapshotFile, sameSnapshot, exists, isWithin, linesOf, IMAGE_EXTENSIONS, DOCUMENT_EXTENSIONS, BINARY_EXTENSIONS, assertReadableFileKind, assertTextBuffer, selectCompleteLinesWithinBudget, estimateTokens, renderReadLines, readTokenBudget, completeRanges, hasCompleteCoverage, mergeRanges, countOccurrences, atomicWriteFile, bashResult, truncate, textResult, byteLength, isTimeoutError, isExecError, runRipgrep, splitOutput, vcsExcludes, grepArgs, splitGlobPatterns, paginate, toWorkspaceRelative, relativizeGrepLine, relativizeCountLine, sortPathsByMtime, formatPaginatedText, formatLimitSuffix, parseCountLines;
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
      const root = resolve2(options.cwd);
      const state = { reads: /* @__PURE__ */ new Map(), todos: [] };
      const defaultTimeoutMs = options.defaultTimeoutMs ?? 3e4;
      const maxTimeoutMs = options.maxTimeoutMs ?? 12e4;
      const maxOutputBytes = options.maxOutputBytes ?? 16e3;
      const normalReadTokens = options.maxReadTokens ?? readTokenBudget(options.contextWindow, READ_TOKEN_BUDGET_RATIO);
      const fullReadTokens = options.maxReadTokens ?? readTokenBudget(options.contextWindow, FULL_READ_TOKEN_BUDGET_RATIO);
      const resolveWorkspacePath = (input) => {
        if (input.length === 0) {
          throw new Error("path must not be empty");
        }
        const candidate = isAbsolute(input) ? resolve2(input) : resolve2(root, input);
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
            const buffer = await readFile6(path);
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
            await mkdir3(dirname5(path), { recursive: true });
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
            const content = await readFile6(path, "utf8");
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
            try {
              const result = await execFileAsync("/bin/bash", ["-lc", input.command], {
                cwd: commandCwd,
                timeout: timeoutMs,
                signal,
                maxBuffer: Math.max(outputLimit * 4, 1024 * 1024)
              });
              return bashResult({ exitCode: 0, stdout: result.stdout, stderr: result.stderr, cwd: commandCwd, outputLimit });
            } catch (cause) {
              if (isTimeoutError(cause)) {
                throw new Error(`Bash command timed out after ${timeoutMs}ms`);
              }
              if (isExecError(cause)) {
                return bashResult({
                  exitCode: typeof cause.code === "number" ? cause.code : 1,
                  stdout: String(cause.stdout ?? ""),
                  stderr: String(cause.stderr ?? cause.message),
                  cwd: commandCwd,
                  outputLimit
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
            const all = await runRipgrep(["--files", "--hidden", "--glob", input.pattern, ...vcsExcludes()], workspaceTarget(input.path), root, signal);
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
      const [fileStat, fileContent] = await Promise.all([stat3(path), content ?? readFile6(path, "utf8")]);
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
      const temp = resolve2(dirname5(path), `.${randomUUID2()}.tmp`);
      try {
        await writeFile3(temp, content, "utf8");
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
        cwd: input.cwd
      });
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
      const absolute = isAbsolute(path) ? path : resolve2(root, path);
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
            const info = await stat3(isAbsolute(path) ? path : resolve2(root, path));
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

// packages/core/src/skills/index.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync2 } from "node:fs";
import { readdir as readdir5, readFile as readFile7, stat as stat4 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname6, join as join7, resolve as resolve3 } from "node:path";
var scanSkillIndex, diffSkillIndex, hasSkillIndexDelta, renderSkillListing, renderSkillDelta, createSkillTool, projectSkillRoots, readSkillEntry, parseSkillMetadata, firstParagraph, parseSkillArgs, findGitRoot2, isNodeErrorCode2;
var init_skills = __esm({
  "packages/core/src/skills/index.ts"() {
    "use strict";
    init_tools();
    scanSkillIndex = async (options) => {
      const cwd = resolve3(options.cwd);
      const homeDir = resolve3(options.homeDir ?? homedir3());
      const roots = [
        ...projectSkillRoots(cwd, homeDir),
        { path: join7(homeDir, ".scorel", "skills"), scope: "user", priority: 0 }
      ];
      const byName = /* @__PURE__ */ new Map();
      for (const root of roots) {
        let children;
        try {
          children = await readdir5(root.path);
        } catch (cause) {
          if (isNodeErrorCode2(cause, "ENOENT") || isNodeErrorCode2(cause, "ENOTDIR")) {
            continue;
          }
          throw cause;
        }
        for (const child of children.sort()) {
          const entry = await readSkillEntry({
            name: child,
            skillPath: join7(root.path, child, "SKILL.md"),
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
        const content = await readFile7(entry.path, "utf8");
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
          roots.push(join7(current, ".scorel", "skills"));
        }
        if (current === stopAt || current === dirname6(current)) {
          break;
        }
        const next = dirname6(current);
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
        [fileStat, content] = await Promise.all([stat4(options.skillPath), readFile7(options.skillPath, "utf8")]);
      } catch (cause) {
        if (isNodeErrorCode2(cause, "ENOENT") || isNodeErrorCode2(cause, "ENOTDIR")) {
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
        if (existsSync2(join7(current, ".git"))) {
          return current;
        }
        const next = dirname6(current);
        if (next === current) {
          return void 0;
        }
        current = next;
      }
    };
    isNodeErrorCode2 = (cause, code) => cause instanceof Error && "code" in cause && cause.code === code;
  }
});

// packages/core/src/index.ts
var init_src3 = __esm({
  "packages/core/src/index.ts"() {
    "use strict";
    init_src();
    init_config();
    init_instructions();
    init_pi_ai();
    init_runtime();
    init_session();
    init_skills();
    init_tools();
  }
});

// packages/daemon/src/relay/auth.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { mkdir as mkdir4, readFile as readFile8, writeFile as writeFile4 } from "node:fs/promises";
import { join as join8 } from "node:path";
var hostDeviceIdentityPath, hostRelayAuthPath, loadOrCreateHostDeviceIdentity, readHostDeviceIdentity, readHostRelayAuth, authorizeRelayClient, isRelayClientAuthorized, emptyAuthFile;
var init_auth = __esm({
  "packages/daemon/src/relay/auth.ts"() {
    "use strict";
    init_src();
    hostDeviceIdentityPath = (stateDir) => join8(stateDir, "device.json");
    hostRelayAuthPath = (stateDir) => join8(stateDir, "relay-auth.json");
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
      await mkdir4(options.stateDir, { recursive: true });
      await writeFile4(hostDeviceIdentityPath(options.stateDir), `${JSON.stringify(identity, null, 2)}
`);
      return identity;
    };
    readHostDeviceIdentity = async (stateDir) => {
      try {
        const raw = JSON.parse(await readFile8(hostDeviceIdentityPath(stateDir), "utf8"));
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
        const raw = JSON.parse(await readFile8(hostRelayAuthPath(stateDir), "utf8"));
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
      await mkdir4(options.stateDir, { recursive: true });
      await writeFile4(hostRelayAuthPath(options.stateDir), `${JSON.stringify(auth, null, 2)}
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
    waitForOpen = (socket) => new Promise((resolve5, reject) => {
      socket.once("open", () => resolve5());
      socket.once("error", reject);
    });
    waitForRelayResponse = (socket) => new Promise((resolve5, reject) => {
      socket.once("error", reject);
      socket.on("message", function handle(data) {
        const frame = JSON.parse(data.toString());
        if (frame.type !== "relay_response" && frame.type !== "relay_error") {
          return;
        }
        socket.off("message", handle);
        resolve5(frame);
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
    waitForOpen2 = (socket) => new Promise((resolve5, reject) => {
      socket.once("open", () => resolve5());
      socket.once("error", reject);
    });
  }
});

// packages/daemon/src/index.ts
import { appendFile as appendFile2, mkdir as mkdir5, readFile as readFile9, rm as rm2, writeFile as writeFile5 } from "node:fs/promises";
import { join as join9 } from "node:path";
import { WebSocketServer } from "ws";
var daemonPackageName, localDaemonStateFile, createLocalDaemonState, readLocalDaemonState, removeLocalDaemonState, markDaemonStopped, daemonStateLiveness, defaultIsPidAlive, startRemoteDaemonWebSocketServer, startScorelHostWebSocketServer, closeWebSocketServer, createRealRuntime, ScorelHost, createEmbeddedTransport, isNodeErrorCode3, wireErrorCode, hasContinuousCoverage, countContentBlocks, normalizeContent, shortStack, formatDiagnosticLine, formatDiagnosticValue;
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
    localDaemonStateFile = (stateDir) => join9(stateDir, "daemon.json");
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
      await mkdir5(options.stateDir, { recursive: true });
      await writeFile5(localDaemonStateFile(options.stateDir), `${JSON.stringify(state, null, 2)}
`);
      return state;
    };
    readLocalDaemonState = async (options) => {
      try {
        const raw = JSON.parse(await readFile9(localDaemonStateFile(options.stateDir), "utf8"));
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
      await writeFile5(
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
      await new Promise((resolve5, reject) => {
        server.once("error", reject);
        server.once("listening", () => {
          server.off("error", reject);
          resolve5();
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
    closeWebSocketServer = (server) => new Promise((resolve5, reject) => {
      for (const client of server.clients) {
        client.close();
      }
      server.close((error) => error ? reject(error) : resolve5());
    });
    createRealRuntime = (options) => {
      const model = resolvePiAiModel(options.config.model);
      const runtime = new ScorelRuntime({
        provider: createPiAiProvider({
          model,
          apiKey: options.config.model.apiKey
        })
      });
      for (const tool of createCodingTools({ cwd: options.cwd, contextWindow: model.contextWindow })) {
        runtime.registerTool(tool);
      }
      return runtime;
    };
    ScorelHost = class {
      #sessionsDir;
      #deviceId;
      #deviceDisplayName;
      #createRuntime;
      #now;
      #createId;
      #sessions = /* @__PURE__ */ new Map();
      #connections = /* @__PURE__ */ new Set();
      #events = /* @__PURE__ */ new Map();
      #seqs = /* @__PURE__ */ new Map();
      #registry;
      #started = false;
      constructor(options) {
        this.#sessionsDir = options.sessionsDir;
        this.#deviceId = options.deviceId;
        this.#deviceDisplayName = options.deviceDisplayName;
        this.#createRuntime = options.createRuntime;
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
      }
      async shutdown() {
        this.#connections.clear();
        this.#started = false;
      }
      connect(connection, sessionId) {
        this.#assertStarted();
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
          if (!request.sessionId || !isNodeErrorCode3(cause, "EEXIST")) {
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
        const userEventId = asEventId(this.#createId());
        const userEvent = await this.#appendPersistent(lane, {
          type: "user_message",
          id: userEventId,
          parentId: input.parentId === void 0 ? lane.session.activeLeafId : input.parentId,
          sessionId,
          clientId,
          ts: this.#now(),
          message: {
            role: "user",
            content: input.content,
            ...input.source === "follow_up" ? { meta: { source: "follow_up", queueItemId: input.queueItemId } } : {}
          }
        });
        const firstAssistantEventId = asEventId(this.#createId());
        const state = {
          parentId: userEvent.id,
          assistantEventId: firstAssistantEventId,
          finalAssistantEventId: firstAssistantEventId
        };
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
        const result = { userEventId, assistantEventId: state.finalAssistantEventId };
        await this.#appendDiagnostic(sessionId, "send_message_finished", {
          clientId,
          userEventId,
          assistantEventId: state.finalAssistantEventId,
          source: input.source
        });
        input.onComplete?.(result);
        return { ...result, status: "completed" };
      }
      async #enqueueFollowUp(lane, connection, request) {
        const now = this.#now();
        const item = {
          id: this.#createId(),
          content: normalizeContent(request.content),
          createdAt: now,
          updatedAt: now,
          clientId: connection.clientId
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
          clientId: connection.clientId
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
          case "message_end": {
            await this.#appendDiagnostic(lane.session.header.sessionId, "assistant_result", {
              clientId,
              stopReason: rawEvent.message.stopReason,
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
        const withSeq = { ...event, seq: this.#nextSeq(lane.session.header.sessionId) };
        await lane.session.append(withSeq);
        this.#recordAndBroadcast(lane.session.header.sessionId, withSeq);
        return withSeq;
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
        const entries = await scanSkillIndex({ cwd: lane.project.workDir });
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
        const runtime = await this.#createRuntime({ sessionId, project });
        await this.#appendDiagnostic(sessionId, "runtime_created", {
          projectId: project.projectId,
          workDir: project.workDir
        });
        const lane = {
          session: loaded,
          project,
          runtime,
          queue: Promise.resolve(),
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
          if (isNodeErrorCode3(cause, "ENOENT")) {
            return false;
          }
          throw cause;
        }
      }
      async #createLane(sessionId, meta, project) {
        const session = await createSession({
          sessionsDir: this.#sessionsDir,
          header: {
            version: 1,
            sessionId,
            deviceId: this.#deviceId,
            createdAt: this.#now(),
            meta: {
              ...meta
            }
          }
        });
        const runtime = await this.#createRuntime({ sessionId, project });
        await this.#appendDiagnostic(sessionId, "runtime_created", {
          projectId: project.projectId,
          workDir: project.workDir
        });
        const lane = {
          session,
          project,
          runtime,
          queue: Promise.resolve(),
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
        await mkdir5(this.#sessionsDir, { recursive: true });
        await appendFile2(sessionLogFilePath(this.#sessionsDir, sessionId), `${line}
`, "utf8");
      }
      async #appendHostDiagnostic(event, fields = {}) {
        const line = formatDiagnosticLine({ ts: this.#now(), level: "info", event, ...fields });
        await mkdir5(this.#sessionsDir, { recursive: true });
        await appendFile2(join9(this.#sessionsDir, "host.log"), `${line}
`, "utf8");
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
    isNodeErrorCode3 = (cause, code) => cause instanceof Error && "code" in cause && cause.code === code;
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
    shortStack = (error) => error.stack?.split("\n").slice(0, 3).join(" | ");
    formatDiagnosticLine = (fields) => Object.entries(fields).filter(([, value]) => value !== void 0 && value !== null).map(([key, value]) => `${key}=${formatDiagnosticValue(value)}`).join(" ");
    formatDiagnosticValue = (value) => {
      const text = typeof value === "string" ? value : String(value);
      return /^[A-Za-z0-9_./:@+-]+$/.test(text) ? text : JSON.stringify(text);
    };
  }
});

// apps/cli/src/relay-cli.ts
import { homedir as homedir4 } from "node:os";
import { join as join10 } from "node:path";
var DEFAULT_SCOREL_RELAY_URL, DEFAULT_SCOREL_WEBUI_URL, defaultStateDir, runCliPair, resolveDefaultRelayUrl, parsePairFlags, requireValue, writePairUsage;
var init_relay_cli = __esm({
  "apps/cli/src/relay-cli.ts"() {
    "use strict";
    init_src4();
    DEFAULT_SCOREL_RELAY_URL = "wss://scorel-relay.chanler.dev";
    DEFAULT_SCOREL_WEBUI_URL = "https://scorel.chanler.dev";
    defaultStateDir = () => join10(homedir4(), ".scorel");
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
import { homedir as homedir5 } from "node:os";
import { join as join11 } from "node:path";
var DEFAULT_HOST, DEFAULT_PORT, STOP_POLL_INTERVAL_MS, STOP_GRACE_MS, defaultStateDir2, isLoopbackHost, formatTimestamp, runCliDaemon, runServeCommand, stopRunningDaemon, runStatusCommand, runStopCommand, runResetCommand, formatStatusLine, parseServeFlags, parseStatusFlags, requireValue2, sleep, writeDaemonUsage;
var init_daemon_cli = __esm({
  "apps/cli/src/daemon-cli.ts"() {
    "use strict";
    init_src4();
    init_relay_cli();
    DEFAULT_HOST = "127.0.0.1";
    DEFAULT_PORT = 7777;
    STOP_POLL_INTERVAL_MS = 200;
    STOP_GRACE_MS = 5e3;
    defaultStateDir2 = () => join11(homedir5(), ".scorel");
    isLoopbackHost = (host) => host === "127.0.0.1" || host === "::1" || host === "localhost";
    formatTimestamp = (epochMs) => new Date(epochMs).toISOString();
    runCliDaemon = async (argv, options) => {
      const [command, ...rest] = argv;
      const stateDir = options.stateDir ?? defaultStateDir2();
      switch (command) {
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
      const daemon = new ScorelHost({
        sessionsDir: options.sessionsDir ?? scorelSessionsDir(homedir5()),
        projectsPath: join11(options.stateDir, "projects.json"),
        deviceId: identity.deviceId,
        deviceDisplayName: identity.displayName,
        createRuntime: async ({ project }) => createRealRuntime({
          cwd: project.workDir,
          config: await loadScorelConfig({ cwd: project.workDir })
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
      let signalReason = "natural";
      const signalHandlers = /* @__PURE__ */ new Map();
      const stopWaiter = new Promise((resolve5) => {
        if (options.serveSignal) {
          if (options.serveSignal.aborted) {
            signalReason = "abort";
            resolve5();
            return;
          }
          options.serveSignal.addEventListener(
            "abort",
            () => {
              signalReason = "abort";
              resolve5();
            },
            { once: true }
          );
          return;
        }
        const installSignal = (signal) => {
          const handler = () => {
            signalReason = signal;
            resolve5();
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
        throw new Error(`Unknown serve option: ${arg}`);
      }
      return { host, port, token, cwd, relayUrl, replace };
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
    sleep = (ms) => new Promise((resolve5) => {
      setTimeout(resolve5, ms);
    });
    writeDaemonUsage = (output) => {
      output.write(
        [
          "Usage: scorel host serve [--host <h>] [--port <p>] [--token <t>] [--project <dir>]",
          "                        [--relay <relay-url> | --no-relay] [--replace]",
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
import { mkdir as mkdir6, readFile as readFile10, writeFile as writeFile6 } from "node:fs/promises";
import { join as join12 } from "node:path";
var FileRelayStore, emptyStoreFile;
var init_store = __esm({
  "apps/relay/src/store.ts"() {
    "use strict";
    FileRelayStore = class {
      #filePath;
      #now;
      #queue = Promise.resolve();
      constructor(options) {
        this.#filePath = join12(options.dataDir, "relay-store.json");
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
          await mkdir6(join12(this.#filePath, ".."), { recursive: true });
          await writeFile6(this.#filePath, `${JSON.stringify(file, null, 2)}
`);
        });
        await this.#queue;
      }
      async #read() {
        try {
          const raw = JSON.parse(await readFile10(this.#filePath, "utf8"));
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
      await new Promise((resolve5, reject) => {
        server.once("error", reject);
        server.once("listening", () => {
          server.off("error", reject);
          resolve5();
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
    closeWebSocketServer2 = (server) => new Promise((resolve5, reject) => {
      for (const client of server.clients) {
        client.close();
      }
      server.close((error) => error ? reject(error) : resolve5());
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
import { homedir as homedir6 } from "node:os";
import { join as join13 } from "node:path";
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
      let dataDir = join13(homedir6(), ".scorel", "relay");
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
    waitForStop = (signal) => new Promise((resolve5) => {
      if (signal) {
        if (signal.aborted) {
          resolve5();
          return;
        }
        signal.addEventListener("abort", () => resolve5(), { once: true });
        return;
      }
      const onSignal = () => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        resolve5();
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
import { spawn } from "node:child_process";
import { homedir as homedir7 } from "node:os";
import { join as join14 } from "node:path";
import { fileURLToPath } from "node:url";
var DEFAULT_DAEMON_PORT, DEFAULT_WEBUI_PORT, DEFAULT_DAEMON_READY_TIMEOUT_MS, defaultStateDir3, defaultAttachSigint, runCliUp, parseUpFlags, requireValue4, waitForDaemonReady, pipeWithPrefix, pipeStreamLines, once;
var init_up_cli = __esm({
  "apps/cli/src/up-cli.ts"() {
    "use strict";
    init_src4();
    DEFAULT_DAEMON_PORT = 7777;
    DEFAULT_WEBUI_PORT = 3e3;
    DEFAULT_DAEMON_READY_TIMEOUT_MS = 1e4;
    defaultStateDir3 = () => join14(homedir7(), ".scorel");
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
      const cliEntrypoint = options.cliEntrypoint ?? fileURLToPath(import.meta.url).replace(/up-cli\.ts$/, "index.ts");
      const spawnFn = options.spawn ?? spawn;
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
          "--import",
          "tsx",
          cliEntrypoint,
          "daemon",
          "serve",
          "--port",
          String(flags.daemonPort),
          "--cwd",
          flags.cwd,
          "--no-relay"
        ];
        daemonChild = spawnFn(process.execPath, daemonArgs, {
          cwd: flags.cwd,
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"]
        });
        try {
          await waitForDaemonReady(daemonChild, readyTimeout);
        } catch (cause) {
          options.error.write(`scorel up error: ${cause.message}
`);
          daemonChild.kill("SIGTERM");
          return 1;
        }
        pipeWithPrefix(daemonChild, "[daemon]", options.output, options.error);
        daemonState = await readState(stateDir);
      }
      if (!daemonState) {
        options.error.write("scorel up error: daemon state missing after start\n");
        daemonChild?.kill("SIGTERM");
        return 1;
      }
      const webuiArgs = [
        "--import",
        "tsx",
        cliEntrypoint,
        "webui",
        "--port",
        String(flags.webuiPort)
      ];
      const webuiChild = spawnFn(process.execPath, webuiArgs, {
        cwd: flags.cwd,
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
        daemonChild?.kill("SIGTERM");
        webuiChild.kill("SIGTERM");
      });
      const daemonExit = daemonChild ? once(daemonChild) : Promise.resolve(0);
      const webuiExit = once(webuiChild);
      const daemonDeathWatcher = daemonChild ? daemonExit.then((code) => {
        if (!shuttingDown) {
          shuttingDown = true;
          options.error.write(`scorel up daemon exited code=${code}
`);
          webuiChild.kill("SIGTERM");
        }
        return code;
      }) : Promise.resolve(0);
      const webuiDeathWatcher = webuiExit.then((code) => {
        if (!shuttingDown) {
          shuttingDown = true;
          options.error.write(`scorel up webui exited code=${code}
`);
          daemonChild?.kill("SIGTERM");
        }
        return code;
      });
      const [daemonCode, webuiCode] = await Promise.all([daemonDeathWatcher, webuiDeathWatcher]);
      detachSigint();
      options.output.write("scorel up stopped\n");
      return daemonCode === 0 && webuiCode === 0 ? 0 : 1;
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
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync3 } from "node:fs";
import { dirname as dirname7, resolve as resolve4 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
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
      const spawnFn = options.spawn ?? spawn2;
      const child = spawnFn(plan.command, plan.argv, {
        cwd: plan.cwd,
        env: plan.env,
        stdio: "inherit"
      });
      return await waitForChildExit(child, options);
    };
    findWebuiAppDir = () => {
      let cursor = dirname7(fileURLToPath2(import.meta.url));
      for (let depth = 0; depth < 8; depth += 1) {
        const candidate = resolve4(cursor, "apps/webui/package.json");
        if (existsSync3(candidate)) {
          return resolve4(cursor, "apps/webui");
        }
        const parent = resolve4(cursor, "..");
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
      const nextBin = resolve4(webuiAppDir, "node_modules/next/dist/bin/next");
      if (existsSync3(nextBin)) {
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
import { appendFile as appendFile3, mkdir as mkdir7, readFile as readFile11, realpath as realpath3, readdir as readdir6, writeFile as writeFile7 } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { homedir as homedir8 } from "node:os";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { basename as basename2, dirname as dirname8, join as join15 } from "node:path";
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
    defaultSessionsDir = () => scorelSessionsDir(homedir8());
    defaultStateDir4 = () => join15(homedir8(), ".scorel");
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
      const filePath = options.attach ? await findAttachDiagnosticsFilePath(io.stateDir, options.sessionId, options.remoteUrl) : join15(io.sessionsDir, `${options.sessionId}.log`);
      let content;
      try {
        content = await readFile11(filePath, "utf8");
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
      return join15(stateDir, "attach-cache", scopeKey, `${sessionId}.json`);
    };
    attachDiagnosticsFilePath = (stateDir, scope, sessionId) => {
      const scopeKey = createHash3("sha256").update(`${scope.kind}\0${scope.locator}`).digest("hex").slice(0, 24);
      return join15(stateDir, "attach-cache", scopeKey, `${sessionId}.log`);
    };
    findAttachDiagnosticsFilePath = async (stateDir, sessionId, _remoteUrl) => {
      const root = join15(stateDir, "attach-cache");
      const scopes = await readdir6(root).catch(() => []);
      for (const scope of scopes) {
        const candidate = join15(root, scope, `${sessionId}.log`);
        try {
          await readFile11(candidate, "utf8");
          return candidate;
        } catch {
          continue;
        }
      }
      return join15(root, "__missing__", `${sessionId}.log`);
    };
    stateDirFromSessionsDir = (sessionsDir) => {
      if (!sessionsDir) {
        return defaultStateDir4();
      }
      return basename2(sessionsDir) === "sessions" ? dirname8(sessionsDir) : sessionsDir;
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
          mkdir7(dirname8(filePath), { recursive: true }).then(() => appendFile3(filePath, `${line}
`, "utf8"))
        );
      }
    };
    readAttachCache = async (stateDir, scope, sessionId) => {
      try {
        const raw = JSON.parse(await readFile11(attachCacheFilePath(stateDir, scope, sessionId), "utf8"));
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
      await mkdir7(dirname8(filePath), { recursive: true });
      await writeFile7(
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
          await new Promise((resolve5) => {
            this.#notify = resolve5;
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
      const daemon = new ScorelHost({
        sessionsDir: options.sessionsDir,
        projectsPath: join15(options.stateDir, "projects.json"),
        deviceId: asDeviceId("device_local"),
        createRuntime: async ({ project: project2 }) => createRealRuntime({
          cwd: project2.workDir,
          config: options.config ?? await loadScorelConfig({ cwd: project2.workDir })
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
          "       scorel host serve [--host <h>] [--port <p>] [--token <t>] [--project <dir>]",
          "                        [--relay <relay-url> | --no-relay] [--replace]",
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
        realpath3(fileURLToPath3(import.meta.url)).catch(() => fileURLToPath3(import.meta.url))
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
