import { protocolPackageName, protocolVersion, type DaemonTransport } from "@scorel/protocol";

export const clientPackageName = "@scorel/client" as const;
export const clientProtocolDependency = protocolPackageName;
export const clientProtocolVersion = protocolVersion;
export type ClientDaemonTransport = DaemonTransport;
