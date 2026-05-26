import { corePackageName } from "@scorel/core";
import { protocolPackageName, protocolVersion, type DaemonTransport } from "@scorel/protocol";

export const daemonPackageName = "@scorel/daemon" as const;
export const daemonCoreDependency = corePackageName;
export const daemonProtocolDependency = protocolPackageName;
export const daemonProtocolVersion = protocolVersion;
export type EmbeddedDaemonTransport = DaemonTransport;
