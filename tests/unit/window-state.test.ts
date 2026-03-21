import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let displays = [
  { bounds: { x: 0, y: 0, width: 1440, height: 900 } },
];

vi.mock("electron", () => ({
  screen: {
    getAllDisplays: () => displays,
  },
}));

import {
  DEFAULT_WINDOW_STATE,
  loadWindowState,
  saveWindowState,
} from "../../src/main/window-state.js";

describe("window-state", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scorel-window-state-"));
    displays = [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }];
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns the default state when no persisted file exists", () => {
    expect(loadWindowState(tempDir)).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("loads a persisted visible window state", () => {
    saveWindowState(tempDir, {
      x: 120,
      y: 80,
      width: 1280,
      height: 820,
      isMaximized: true,
    });

    expect(loadWindowState(tempDir)).toEqual({
      x: 120,
      y: 80,
      width: 1280,
      height: 820,
      isMaximized: true,
    });
  });

  it("falls back to the default state when persisted JSON is invalid", () => {
    fs.writeFileSync(path.join(tempDir, "window-state.json"), "not json", "utf8");

    expect(loadWindowState(tempDir)).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("falls back to the default state when the saved window is off-screen", () => {
    saveWindowState(tempDir, {
      x: 4000,
      y: 4000,
      width: 1280,
      height: 820,
      isMaximized: false,
    });

    expect(loadWindowState(tempDir)).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("falls back to the default state when only a tiny corner remains visible", () => {
    saveWindowState(tempDir, {
      x: 1435,
      y: 895,
      width: 1280,
      height: 820,
      isMaximized: false,
    });

    expect(loadWindowState(tempDir)).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("falls back to the default state when a maximized window restore bounds are off-screen", () => {
    saveWindowState(tempDir, {
      x: 4000,
      y: 4000,
      width: 1280,
      height: 820,
      isMaximized: true,
    });

    expect(loadWindowState(tempDir)).toEqual(DEFAULT_WINDOW_STATE);
  });
});
