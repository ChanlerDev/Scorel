import { protocolPackageName, protocolVersion, type ScorelEvent } from "@scorel/protocol";

export const corePackageName = "@scorel/core" as const;
export const coreProtocolDependency = protocolPackageName;
export const coreProtocolVersion = protocolVersion;
export type CoreScorelEvent = ScorelEvent;

export * from "./config/index.js";
export * from "./instructions/index.js";
export * from "./provider/pi-ai.js";
export * from "./runtime/index.js";
export * from "./session/index.js";
export * from "./skills/index.js";
export * from "./tools/index.js";
