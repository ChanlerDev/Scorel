import { screen } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export type WindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
};

export const DEFAULT_WINDOW_STATE: WindowState = {
  x: 0,
  y: 0,
  width: 1200,
  height: 800,
  isMaximized: false,
};

const WINDOW_STATE_FILE = "window-state.json";

function getWindowStatePath(userDataPath: string): string {
  return path.join(userDataPath, WINDOW_STATE_FILE);
}

function isVisibleOnAnyDisplay(state: WindowState): boolean {
  return screen.getAllDisplays().some((display) => (
    state.x >= display.bounds.x &&
    state.y >= display.bounds.y &&
    state.x < display.bounds.x + display.bounds.width &&
    state.y < display.bounds.y + display.bounds.height
  ));
}

export function loadWindowState(userDataPath: string): WindowState {
  try {
    const raw = fs.readFileSync(getWindowStatePath(userDataPath), "utf8");
    const state = JSON.parse(raw) as WindowState;
    return isVisibleOnAnyDisplay(state) ? state : DEFAULT_WINDOW_STATE;
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

export function saveWindowState(userDataPath: string, state: WindowState): void {
  fs.writeFileSync(
    getWindowStatePath(userDataPath),
    JSON.stringify(state),
    "utf8",
  );
}
