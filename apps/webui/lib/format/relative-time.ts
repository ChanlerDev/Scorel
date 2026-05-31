// Pure relative-time formatter (S0045). Takes both `updatedAt` and a caller-
// supplied `now` so the function stays SSR-safe and trivially unit-testable
// without `Date.now()` mocking. Returns Chinese strings matching the locked
// thresholds in `docs/spec/ship/S0045-webui-card-sidebar-and-session-fixes.md`
// §2.

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * Format the elapsed time between `updatedAt` and `now` as a short Chinese
 * relative-time hint. Returns the empty string when `updatedAt` is undefined,
 * NaN, or in the future (clock skew defensive).
 */
export function formatRelativeTime(
  updatedAt: number | undefined,
  now: number,
): string {
  if (updatedAt === undefined) return "";
  if (!Number.isFinite(updatedAt)) return "";
  const diff = now - updatedAt;
  if (!Number.isFinite(diff)) return "";
  if (diff < 0) return "刚刚";
  if (diff < MINUTE_MS) return "刚刚";
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} 分钟`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} 小时`;
  if (diff < WEEK_MS) return `${Math.floor(diff / DAY_MS)} 天`;
  if (diff < MONTH_MS) return `${Math.floor(diff / WEEK_MS)} 周`;
  if (diff < YEAR_MS) return `${Math.floor(diff / MONTH_MS)} 个月`;
  return `${Math.floor(diff / YEAR_MS)} 年`;
}
