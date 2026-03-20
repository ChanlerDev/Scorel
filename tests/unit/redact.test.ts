import { describe, it, expect } from "vitest";
import { redactString } from "../../src/main/core/redact.js";

describe("redactString", () => {
  it("masks API keys, bearer tokens, and home paths", () => {
    const input = [
      "token sk-12345678901234567890",
      "auth Bearer abc.def_ghi-123",
      "home /Users/chanler/projects/scorel",
    ].join("\n");

    const output = redactString(input);

    expect(output).toContain("sk-***REDACTED***");
    expect(output).not.toContain("sk-12345678901234567890");
    expect(output).toContain("Bearer ***REDACTED***");
    expect(output).not.toContain("Bearer abc.def_ghi-123");
    expect(output).toContain("~/projects/scorel");
    expect(output).not.toContain("/Users/chanler/projects/scorel");
  });
});
