import os from "node:os";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactString(input: string): string {
  let output = input
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, "sk-***REDACTED***")
    .replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer ***REDACTED***");

  const homePaths = new Set([process.env.HOME, os.homedir()].filter((value): value is string => Boolean(value)));

  for (const homePath of homePaths) {
    output = output
      .replace(new RegExp(`${escapeRegex(homePath)}/`, "g"), "~/")
      .replace(new RegExp(escapeRegex(homePath), "g"), "~");
  }

  return output
    .replace(/\/Users\/[^/\s]+\//g, "~/")
    .replace(/\/Users\/[^/\s]+(?=$|[\s"'])/g, "~");
}
