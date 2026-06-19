import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("GUI application menu", () => {
  it("binds CommandOrControl+, to open Settings", async () => {
    const source = await readFile(join(process.cwd(), "src", "main.ts"), "utf8");

    expect(source).toContain('accelerator: "CommandOrControl+,"');
    expect(source).toContain("guiIpcChannels.openSettings");
  });

  it("installs packaged-app auto updates through electron-updater", async () => {
    const source = await readFile(join(process.cwd(), "src", "main.ts"), "utf8");

    expect(source).toContain('import { autoUpdater } from "electron-updater"');
    expect(source).toContain("if (!app.isPackaged) return");
    expect(source).toContain("checkForUpdatesAndNotify");
  });

  it("exposes manual update checks in the app menu and tray menu", async () => {
    const source = await readFile(join(process.cwd(), "src", "main.ts"), "utf8");

    expect(source).toContain('label: "Check for Updates..."');
    expect(source).toContain("manual: true");
    expect(source).toContain("installStatusTray");
    expect(source).toContain("new Tray");
    expect(source).toContain("createFromDataURL");
    expect(source).toContain('label: "Show Scorel"');
    expect(source).toContain("`Host: ${hostStatus.state}`");
  });
});
