import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as WorkspacePickerModule from "../../src/renderer/components/WorkspacePicker.js";

describe("WorkspacePicker", () => {
  it("uses the formatted workspace path when no saved label exists", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkspacePickerModule.WorkspacePicker, {
        defaultWorkspace: "/Users/tester/Scorel",
        workspaces: [{
          path: "/Users/tester/Projects/demo-app",
          label: null,
          lastUsedAt: 2,
          createdAt: 1,
          exists: true,
        }],
        loading: false,
        creating: false,
        error: null,
        onUseWorkspace: () => {},
        onBrowse: () => {},
        onClose: () => {},
      }),
    );

    expect(markup).toContain("~/Projects/demo-app");
    expect(markup).not.toContain(">Recent workspace<");
  });

  it("closes on Escape only when the picker is idle", () => {
    const maybeHandler = (
      WorkspacePickerModule as Record<string, unknown>
    ).shouldCloseWorkspacePickerOnKey;

    const shouldClose = typeof maybeHandler === "function"
      ? (maybeHandler as (key: string, creating: boolean) => boolean)
      : () => undefined;

    expect(shouldClose("Escape", false)).toBe(true);
    expect(shouldClose("Enter", false)).toBe(false);
    expect(shouldClose("Escape", true)).toBe(false);
  });
});
