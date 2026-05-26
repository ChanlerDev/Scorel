import { protocolPackageName, protocolVersion, type ScorelEvent } from "@scorel/protocol";

export const corePackageName = "@scorel/core" as const;
export const coreProtocolDependency = protocolPackageName;
export const coreProtocolVersion = protocolVersion;
export type CoreScorelEvent = ScorelEvent;

export * from "./session/index.js";
