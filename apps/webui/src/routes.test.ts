import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const APP_DIR = path.join(appRoot, "app");

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() && entry.name === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

function pageFileToRoute(file: string): string {
  const rel = path.relative(APP_DIR, file).split(path.sep).join("/");
  // Strip trailing /page.tsx or 'page.tsx' for root.
  const noPage = rel === "page.tsx" ? "" : rel.replace(/\/page\.tsx$/, "");
  // Replace [param] with :param.
  const route = "/" + noPage.replace(/\[([^\]]+)\]/g, ":$1");
  return route === "/" ? "/" : route.replace(/\/$/, "");
}

const EXPECTED_ROUTES = new Set([
  "/",
  "/devices/:deviceId",
  "/devices/:deviceId/projects/:projectSlug",
  "/devices/:deviceId/projects/:projectSlug/sessions/:sessionId",
  "/settings",
  "/settings/devices/:deviceId",
]);

describe("apps/webui routes", () => {
  it("matches the expected route set", async () => {
    const files = await walk(APP_DIR);
    const routes = new Set(files.map(pageFileToRoute));

    const missing: string[] = [];
    for (const expected of EXPECTED_ROUTES) {
      if (!routes.has(expected)) missing.push(expected);
    }
    const extra: string[] = [];
    for (const actual of routes) {
      if (!EXPECTED_ROUTES.has(actual)) extra.push(actual);
    }

    expect(
      { missing, extra },
      `routes mismatch.\nmissing=${JSON.stringify(missing)}\nextra=${JSON.stringify(extra)}`,
    ).toEqual({ missing: [], extra: [] });
  });
});
