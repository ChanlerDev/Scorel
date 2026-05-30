import { describe, expect, it } from "vitest";

import { categorize } from "./error";

describe("categorize", () => {
  it("returns auth when daemon emits auth_failed", () => {
    expect(categorize({ errorCode: "auth_failed", message: "token rejected" })).toEqual({
      reason: "auth",
      message: "token rejected",
    });
  });

  it("returns version_mismatch when daemon emits protocol_mismatch", () => {
    expect(
      categorize({ errorCode: "protocol_mismatch", message: "client too old" }),
    ).toEqual({ reason: "version_mismatch", message: "client too old" });
  });

  it("returns version_mismatch when caller flags protocolMismatch", () => {
    expect(
      categorize({ protocolMismatch: true, message: "negotiation failed" }),
    ).toEqual({ reason: "version_mismatch", message: "negotiation failed" });
  });

  it("returns network on close code 1006", () => {
    expect(
      categorize({ closeCode: 1006, message: "abnormal closure" }),
    ).toEqual({ reason: "network", message: "abnormal closure" });
  });

  it("returns network when message contains ENOTFOUND/ECONNREFUSED/ETIMEDOUT", () => {
    for (const msg of [
      "getaddrinfo ENOTFOUND remote.example.com",
      "connect ECONNREFUSED 127.0.0.1:18789",
      "connect ETIMEDOUT 1.2.3.4:18789",
    ]) {
      expect(categorize({ message: msg })).toEqual({ reason: "network", message: msg });
    }
  });

  it("falls back to unknown otherwise", () => {
    expect(categorize({ message: "boom" })).toEqual({ reason: "unknown", message: "boom" });
    expect(categorize({})).toEqual({ reason: "unknown", message: "Connection failed" });
  });

  it("auth wins over close code", () => {
    expect(
      categorize({ errorCode: "auth_failed", closeCode: 1006, message: "rejected" }),
    ).toEqual({ reason: "auth", message: "rejected" });
  });
});
