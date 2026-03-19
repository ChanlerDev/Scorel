/**
 * Write-only secret management using macOS Keychain.
 *
 * The renderer NEVER receives plaintext secrets.
 * Exposed IPC surface: storeSecret / hasSecret / clearSecret only.
 * getSecret is internal — used by the main process to build provider auth headers.
 */

import { execFile } from "node:child_process";

const KEYCHAIN_SERVICE = "com.scorel.provider";
const SECURITY_BIN = "/usr/bin/security";

/** Exit code returned by `security find-generic-password` when entry is not found. */
const NOT_FOUND_EXIT = 44;

function run(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(SECURITY_BIN, args, (error, stdout) => {
      if (error && "code" in error && typeof error.code === "number") {
        resolve({ stdout: stdout ?? "", exitCode: error.code });
        return;
      }
      if (error) {
        // Unexpected error (e.g. binary missing) — treat as generic failure
        resolve({ stdout: "", exitCode: -1 });
        return;
      }
      resolve({ stdout: stdout ?? "", exitCode: 0 });
    });
  });
}

/**
 * Store a secret (API key) for a provider.
 * Uses `-U` to update in place if the entry already exists.
 */
export async function storeSecret(
  providerId: string,
  secret: string,
): Promise<void> {
  const { exitCode } = await run([
    "add-generic-password",
    "-a", providerId,
    "-s", KEYCHAIN_SERVICE,
    "-w", secret,
    "-U",
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Failed to store secret for provider "${providerId}" (exit ${exitCode})`,
    );
  }
}

/**
 * Check whether a secret exists for a provider.
 * Returns false on not-found (exit 44) or any other error.
 */
export async function hasSecret(providerId: string): Promise<boolean> {
  const { exitCode } = await run([
    "find-generic-password",
    "-a", providerId,
    "-s", KEYCHAIN_SERVICE,
  ]);
  return exitCode === 0;
}

/**
 * Delete a secret for a provider.
 * Silently succeeds if the entry does not exist.
 */
export async function clearSecret(providerId: string): Promise<void> {
  const { exitCode } = await run([
    "delete-generic-password",
    "-a", providerId,
    "-s", KEYCHAIN_SERVICE,
  ]);
  if (exitCode !== 0 && exitCode !== NOT_FOUND_EXIT) {
    throw new Error(
      `Failed to clear secret for provider "${providerId}" (exit ${exitCode})`,
    );
  }
}

/**
 * Retrieve a secret. Main-process only — NEVER expose via preload/IPC.
 * Returns null if the entry does not exist or on any error.
 */
export async function getSecret(providerId: string): Promise<string | null> {
  const { stdout, exitCode } = await run([
    "find-generic-password",
    "-a", providerId,
    "-s", KEYCHAIN_SERVICE,
    "-w",
  ]);
  if (exitCode !== 0) {
    return null;
  }
  // `-w` prints the password followed by a newline
  return stdout.replace(/\n$/, "");
}
