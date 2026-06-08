/**
 * Tiny line-level unified diff using LCS over already-split lines. Visual
 * only — not authoritative.
 */
export type DiffLine =
  | { kind: "ctx"; text: string }
  | { kind: "add"; text: string }
  | { kind: "del"; text: string };

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  const m = oldLines.length;
  const n = newLines.length;
  // LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (oldLines[i] === newLines[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      out.push({ kind: "ctx", text: oldLines[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: "del", text: oldLines[i]! });
      i += 1;
    } else {
      out.push({ kind: "add", text: newLines[j]! });
      j += 1;
    }
  }
  while (i < m) {
    out.push({ kind: "del", text: oldLines[i]! });
    i += 1;
  }
  while (j < n) {
    out.push({ kind: "add", text: newLines[j]! });
    j += 1;
  }
  return out;
}

export function diffCounts(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "del") removed += 1;
  }
  return { added, removed };
}
