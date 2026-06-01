import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DebugPanel } from "./debug-panel";
import type { ConnectionSummary } from "../../lib/diagnostics/connection-summary";

afterEach(() => cleanup());

const summary: ConnectionSummary = {
  localDeviceId: "local-1",
  remoteDeviceId: "remote-1",
  remoteDeviceDisplayName: "Macbook",
  projectId: "Users-foo-bar",
  sessionId: "session_abc",
  connectionState: "connected",
  inFlight: true,
  cancelling: false,
  persistentLastSeq: 5,
  streamLastSeq: 7,
};

describe("DebugPanel", () => {
  it("renders the connection summary fields", () => {
    render(<DebugPanel summary={summary} />);
    const panel = screen.getByTestId("debug-panel");
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain("DEBUG");
    expect(screen.getByTestId("debug-panel-localDevice").textContent).toBe("local-1");
    expect(screen.getByTestId("debug-panel-remoteDevice").textContent).toBe("remote-1");
    expect(screen.getByTestId("debug-panel-remoteName").textContent).toBe("Macbook");
    expect(screen.getByTestId("debug-panel-project").textContent).toBe("Users-foo-bar");
    expect(screen.getByTestId("debug-panel-session").textContent).toBe("session_abc");
    expect(screen.getByTestId("debug-panel-conn").textContent).toBe("connected");
    expect(screen.getByTestId("debug-panel-inFlight").textContent).toBe("true");
    expect(screen.getByTestId("debug-panel-cancelling").textContent).toBe("false");
    expect(screen.getByTestId("debug-panel-seq").textContent).toBe("p=5 s=7");
  });

  it("uses an em-dash placeholder for missing identity fields", () => {
    render(
      <DebugPanel
        summary={{
          localDeviceId: "local-1",
          sessionId: "s",
          connectionState: "idle",
          inFlight: false,
          cancelling: false,
          persistentLastSeq: 0,
          streamLastSeq: 0,
        }}
      />,
    );
    expect(screen.getByTestId("debug-panel-remoteDevice").textContent).toBe("—");
    expect(screen.getByTestId("debug-panel-project").textContent).toBe("—");
    // remoteName row is conditional — only renders when displayName is set.
    expect(screen.queryByTestId("debug-panel-remoteName")).toBeNull();
  });

  it("renders a copy button", () => {
    render(<DebugPanel summary={summary} />);
    const copy = screen.getByTestId("debug-panel-copy") as HTMLButtonElement;
    expect(copy.textContent).toBe("copy");
  });
});
