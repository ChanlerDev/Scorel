import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relative-time";

const NOW = 1_700_000_000_000;

describe("formatRelativeTime", () => {
  it("returns empty when updatedAt is undefined", () => {
    expect(formatRelativeTime(undefined, NOW)).toBe("");
  });

  it("returns empty when updatedAt is NaN", () => {
    expect(formatRelativeTime(Number.NaN, NOW)).toBe("");
  });

  it("returns 刚刚 for sub-minute deltas", () => {
    expect(formatRelativeTime(NOW - 0, NOW)).toBe("刚刚");
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe("刚刚");
  });

  it("returns 分钟 for sub-hour deltas", () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe("1 分钟");
    expect(formatRelativeTime(NOW - 30 * 60_000, NOW)).toBe("30 分钟");
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe("59 分钟");
  });

  it("returns 小时 for sub-day deltas", () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe("1 小时");
    expect(formatRelativeTime(NOW - 23 * 3_600_000, NOW)).toBe("23 小时");
  });

  it("returns 天 for sub-week deltas", () => {
    expect(formatRelativeTime(NOW - 24 * 3_600_000, NOW)).toBe("1 天");
    expect(formatRelativeTime(NOW - 6 * 86_400_000, NOW)).toBe("6 天");
  });

  it("returns 周 for sub-month deltas", () => {
    expect(formatRelativeTime(NOW - 7 * 86_400_000, NOW)).toBe("1 周");
    expect(formatRelativeTime(NOW - 21 * 86_400_000, NOW)).toBe("3 周");
  });

  it("returns 个月 for sub-year deltas", () => {
    expect(formatRelativeTime(NOW - 30 * 86_400_000, NOW)).toBe("1 个月");
    expect(formatRelativeTime(NOW - 364 * 86_400_000, NOW)).toBe("12 个月");
  });

  it("returns 年 for year+ deltas", () => {
    expect(formatRelativeTime(NOW - 365 * 86_400_000, NOW)).toBe("1 年");
    expect(formatRelativeTime(NOW - 3 * 365 * 86_400_000, NOW)).toBe("3 年");
  });

  it("treats future updatedAt (clock skew) as 刚刚", () => {
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe("刚刚");
  });
});
