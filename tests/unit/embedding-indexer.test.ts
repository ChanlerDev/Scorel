import { describe, expect, it } from "vitest";
import { chunkTextForEmbedding } from "../../src/main/search/chunking.js";

describe("chunkTextForEmbedding", () => {
  it("does not depend on whitespace boundaries for Chinese text", () => {
    const text = "你好".repeat(1250);

    const chunks = chunkTextForEmbedding(text);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text.length).toBe(2048);
    expect(chunks[0]?.tokenCount).toBe(2048);
    expect(chunks[1]?.text.startsWith("你好".repeat(128))).toBe(true);
    expect(chunks[1]?.tokenCount).toBeGreaterThan(0);
  });

  it("uses Unicode-aware character slicing with overlap", () => {
    const text = `${"a".repeat(2048)}${"b".repeat(1024)}`;

    const chunks = chunkTextForEmbedding(text);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toBe("a".repeat(2048));
    expect(chunks[1]?.text.startsWith("a".repeat(256))).toBe(true);
    expect(chunks[1]?.text.endsWith("b".repeat(1024))).toBe(true);
    expect(chunks[1]?.tokenCount).toBe(1280);
  });
});
