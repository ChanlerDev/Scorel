import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCommitSummaryRequest,
  collectCommitEvidence,
  filterPatch,
  insertReleaseNotes,
  renderReleaseNotesMarkdown,
  summarizeCommit,
} from "./release-notes.mjs";

test("filterPatch removes generated files and truncates oversized patches", () => {
  const patch = [
    "diff --git a/dist/index.js b/dist/index.js",
    "+generated bundle",
    "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
    "+lockfile",
    "diff --git a/scripts/release.mjs b/scripts/release.mjs",
    "+release behavior",
    "diff --git a/docs/spec/ship/S0063-ai-release-notes.md b/docs/spec/ship/S0063-ai-release-notes.md",
    "+spec behavior",
  ].join("\n");

  const filtered = filterPatch(patch, { maxChars: 80 });

  assert.equal(filtered.truncated, true);
  assert.match(filtered.patch, /scripts\/release\.mjs/);
  assert.match(filtered.patch, /truncated/);
  assert.doesNotMatch(filtered.patch, /generated bundle/);
  assert.doesNotMatch(filtered.patch, /pnpm-lock/);
});

test("collectCommitEvidence skips generated files before reading patches", () => {
  const calls = [];
  const evidence = collectCommitEvidence({
    from: "v0.0.1",
    to: "HEAD",
    patchLimit: 1000,
    runGit: (args) => {
      calls.push(args);
      if (args[0] === "log") {
        return "abc1234\x1ffix: publish release assets\x1f\x1e";
      }
      if (args.includes("--name-only")) {
        return "dist/index.js\ndist/index.js.map\nscripts/release.mjs\n";
      }
      if (args.includes("--stat")) {
        return " scripts/release.mjs | 2 ++\n dist/index.js | 2000 +++++++++++++++++";
      }
      assert.deepEqual(args, ["show", "--format=", "--patch", "--find-renames", "abc1234", "--", "scripts/release.mjs"]);
      return "diff --git a/scripts/release.mjs b/scripts/release.mjs\n+release behavior";
    },
  });

  assert.equal(evidence.length, 1);
  assert.match(evidence[0].patch, /scripts\/release\.mjs/);
  assert.match(evidence[0].patch, /omitted 2 generated/);
  assert.equal(evidence[0].patchMeta.removedGeneratedBlocks, 2);
  assert.equal(calls.some((args) => args.includes("--patch") && !args.includes("--")), false);
  assert.equal(calls.some((args) => args.includes("--patch") && args.includes("dist/index.js")), false);
});

test("buildCommitSummaryRequest uses DeepSeek defaults and large max token budget", () => {
  const request = buildCommitSummaryRequest({
    commit: { sha: "abc1234", subject: "S0063: feat: add AI release notes", body: "" },
    changedFiles: ["docs/spec/ship/S0063-ai-release-notes.md", "scripts/release-notes.mjs"],
    diffStat: "2 files changed",
    patch: "+content",
  });

  assert.equal(request.url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(request.body.model, "deepseek-v4-flash");
  assert.deepEqual(request.body.response_format, { type: "json_object" });
  assert.deepEqual(request.body.thinking, { type: "disabled" });
  assert.equal(request.body.max_tokens >= 32768, true);
  assert.match(request.body.messages[0].content, /SHIP specs/);
});

test("summarizeCommit posts JSON-mode request and parses structured response", async () => {
  const calls = [];
  const summary = await summarizeCommit(
    {
      commit: { sha: "abc1234", subject: "S0063: feat: add AI release notes", body: "" },
      changedFiles: ["scripts/release-notes.mjs"],
      diffStat: "1 file changed",
      patch: "+content",
    },
    {
      apiKey: "test-key",
      fetch: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    sha: "abc1234",
                    category: "release",
                    areas: ["release"],
                    userVisible: true,
                    summary: "Adds AI-generated release notes.",
                    details: ["Release notes are generated during release."],
                    breakingChanges: [],
                    verification: [],
                    confidence: "high",
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(JSON.parse(calls[0].options.body).thinking.type, "disabled");
  assert.equal(summary.summary, "Adds AI-generated release notes.");
});

test("renderReleaseNotesMarkdown omits empty sections", () => {
  const markdown = renderReleaseNotesMarkdown({
    version: "0.0.2",
    date: "2026-06-08",
    highlights: ["AI release notes now run by default."],
    changes: [],
    fixes: [],
    breakingChanges: [],
    verification: ["Release dry-run prints a notes preview."],
    internal: [],
  });

  assert.match(markdown, /^## 0\.0\.2 - 2026-06-08/m);
  assert.match(markdown, /### Highlights/);
  assert.match(markdown, /### Verification/);
  assert.doesNotMatch(markdown, /### Fixes/);
  assert.doesNotMatch(markdown, /### Internal/);
});

test("insertReleaseNotes places rendered notes under Unreleased", () => {
  const changelog = "# Changelog\n\n## Unreleased\n\n## 0.0.1 - 2026-06-06\n\n- Existing\n";
  const updated = insertReleaseNotes(changelog, "## 0.0.2 - 2026-06-08\n\n### Highlights\n\n- New notes\n");

  assert.equal(
    updated,
    "# Changelog\n\n## Unreleased\n\n## 0.0.2 - 2026-06-08\n\n### Highlights\n\n- New notes\n\n## 0.0.1 - 2026-06-06\n\n- Existing\n",
  );
});
