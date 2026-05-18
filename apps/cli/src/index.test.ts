import { describe, expect, it } from "vitest";
import { readPromptFromArgsOrStdin } from "./index.js";

describe("readPromptFromArgsOrStdin", () => {
  it("uses command line arguments when provided", async () => {
    await expect(readPromptFromArgsOrStdin(["hello", "world"], async () => "ignored")).resolves.toBe(
      "hello world"
    );
  });

  it("falls back to stdin when no arguments are provided", async () => {
    await expect(readPromptFromArgsOrStdin([], async () => "from stdin\n")).resolves.toBe("from stdin");
  });
});
