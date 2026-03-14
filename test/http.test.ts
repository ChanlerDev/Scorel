import { afterEach, describe, expect, it } from "vitest";

import { HttpStatusServer } from "../src/http.js";

let server: HttpStatusServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe("http status server", () => {
  it("serves state and refresh endpoints", async () => {
    let refreshCount = 0;
    server = new HttpStatusServer(
      {
        snapshot() {
          return {
            generated_at: "2026-01-01T00:00:00Z",
            counts: { running: 1, retrying: 0 },
            running: [{ issue_identifier: "ABC-1" }],
            retrying: []
          };
        },
        refreshNow() {
          refreshCount += 1;
        }
      } as never,
      0
    );

    const port = await server.start();

    const stateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
    const state = (await stateResponse.json()) as { counts: { running: number } };
    expect(state.counts.running).toBe(1);

    const issueResponse = await fetch(`http://127.0.0.1:${port}/api/v1/ABC-1`);
    expect(issueResponse.status).toBe(200);

    const refreshResponse = await fetch(`http://127.0.0.1:${port}/api/v1/refresh`, {
      method: "POST"
    });
    expect(refreshResponse.status).toBe(202);
    expect(refreshCount).toBe(1);
  });
});
