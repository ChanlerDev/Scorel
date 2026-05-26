import { clientPackageName } from "@scorel/client";
import { daemonPackageName } from "@scorel/daemon";

export const cliAppName = "@scorel/app-cli" as const;
export const cliClientDependency = clientPackageName;
export const cliDaemonDependency = daemonPackageName;
