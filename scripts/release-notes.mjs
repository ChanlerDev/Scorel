#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const defaultBaseUrl = "https://api.deepseek.com/v1";
const defaultModel = "deepseek-v4-flash";
const defaultMaxTokens = 65_536;
const defaultPatchLimit = 180_000;

const generatedPathPatterns = [
  /^dist\//,
  /^pnpm-lock\.yaml$/,
  /\.map$/,
  /(^|\/)\.next\//,
  /(^|\/)node_modules\//,
];

const commitSummarySystemPrompt = `You are Scorel's release-note analyst.

Summarize one git commit into JSON evidence for a changelog.

Scorel is developed through SHIP specs. A file under docs/spec/ship/S*.md is not ordinary documentation noise: it often records the intent, boundary, acceptance criteria, risks, and verification expectations behind the work. Use spec diffs as context for what the commit is trying to ship, but do not treat future plans, non-goals, or unfinished acceptance criteria as completed behavior.

Use only the provided commit subject, body, changed files, diff stat, and patch.

Write for people deciding whether this release matters to them:
- Prefer user impact over implementation detail.
- Mark userVisible as true only when the commit changes CLI behavior, release behavior, WebUI behavior, Host/Relay behavior, installed package behavior, config behavior, or a documented user workflow.
- Keep pure refactors, tests, build plumbing, and planning-only spec changes internal unless they affect a user-facing release path.
- Breaking changes require explicit evidence.
- Verification requires explicit evidence from tests, scripts, workflows, docs, or commit text.
- Do not invent commands, providers, platforms, results, or product behavior.

Return valid json only, matching this shape:
{
  "sha": "string",
  "category": "feature|fix|docs|release|test|refactor|chore|internal",
  "areas": ["cli|webui|host|relay|release|package|docs|config|workflow|internal"],
  "userVisible": true,
  "summary": "string",
  "details": ["string"],
  "breakingChanges": ["string"],
  "verification": ["string"],
  "confidence": "high|medium|low"
}`;

const aggregateSystemPrompt = `You are Scorel's changelog editor.

Turn commit-level JSON evidence into release-level JSON changelog notes.

Use only the provided commit summaries. Group related work into clear user-facing items. Do not list every commit mechanically.

Rules:
- Lead with the most important user-visible changes.
- Keep implementation-only work under internal.
- Do not mention SHIP specs by default unless the spec itself is the released artifact or clarifies an important user-facing boundary.
- Do not turn future plans into shipped behavior.
- Include breaking changes only when commit summaries explicitly contain them.
- Include verification only when commit summaries explicitly contain it.
- Omit empty ideas by returning empty arrays.

Return valid json only, matching this shape:
{
  "version": "string",
  "date": "YYYY-MM-DD",
  "highlights": ["string"],
  "changes": ["string"],
  "fixes": ["string"],
  "breakingChanges": ["string"],
  "verification": ["string"],
  "internal": ["string"]
}`;

export const defaultRunGit = (args, options = {}) => {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
};

export const isGeneratedPath = (path) => generatedPathPatterns.some((pattern) => pattern.test(path));

const pathsFromDiffHeader = (line) => {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return match ? [match[1], match[2]] : [];
};

export const filterPatch = (patch, options = {}) => {
  const maxChars = options.maxChars ?? defaultPatchLimit;
  const lines = patch.split("\n");
  const kept = [];
  let keepBlock = true;
  let removedBlocks = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const paths = pathsFromDiffHeader(line);
      keepBlock = paths.length === 0 || paths.every((path) => !isGeneratedPath(path));
      if (!keepBlock) {
        removedBlocks += 1;
      }
    }
    if (keepBlock) {
      kept.push(line);
    }
  }

  let filtered = kept.join("\n").trim();
  let truncated = false;
  if (filtered.length > maxChars) {
    filtered = `${filtered.slice(0, maxChars)}\n\n[release-notes: patch truncated at ${maxChars} characters]`;
    truncated = true;
  }
  if (removedBlocks > 0) {
    filtered = `${filtered}\n\n[release-notes: omitted ${removedBlocks} generated or oversized file diff block${removedBlocks === 1 ? "" : "s"}]`.trim();
  }
  return { patch: filtered, truncated, removedBlocks };
};

const jsonArray = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : []);

const parseJsonObject = (content) => {
  try {
    return JSON.parse(content);
  } catch {
    const match = /\{[\s\S]*\}/.exec(content);
    if (!match) {
      throw new Error("DeepSeek response did not contain a JSON object");
    }
    return JSON.parse(match[0]);
  }
};

const deepSeekSettings = (options = {}) => {
  const baseUrl = (options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? defaultBaseUrl).replace(/\/+$/, "");
  const model = options.model ?? process.env.DEEPSEEK_MODEL ?? defaultModel;
  const maxTokens = Number(options.maxTokens ?? process.env.DEEPSEEK_MAX_TOKENS ?? defaultMaxTokens);
  return { baseUrl, model, maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.trunc(maxTokens) : defaultMaxTokens };
};

export const buildCommitSummaryRequest = (evidence, options = {}) => {
  const settings = deepSeekSettings(options);
  return {
    url: `${settings.baseUrl}/chat/completions`,
    body: {
      model: settings.model,
      messages: [
        { role: "system", content: commitSummarySystemPrompt },
        { role: "user", content: JSON.stringify(evidence, null, 2) },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      max_tokens: settings.maxTokens,
    },
  };
};

export const buildAggregateRequest = (evidence, options = {}) => {
  const settings = deepSeekSettings(options);
  return {
    url: `${settings.baseUrl}/chat/completions`,
    body: {
      model: settings.model,
      messages: [
        { role: "system", content: aggregateSystemPrompt },
        { role: "user", content: JSON.stringify(evidence, null, 2) },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      max_tokens: settings.maxTokens,
    },
  };
};

const postDeepSeekJson = async (request, options = {}) => {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required for AI release notes");
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("fetch is unavailable in this Node runtime");
  }
  const response = await fetchImpl(request.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    const text = typeof response.text === "function" ? await response.text() : "";
    throw new Error(`DeepSeek request failed status=${response.status}${text ? `\n${text}` : ""}`);
  }
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`DeepSeek response missing message content: ${JSON.stringify(json)}`);
  }
  return parseJsonObject(content);
};

const normalizeCommitSummary = (value, sha) => ({
  sha: typeof value.sha === "string" && value.sha ? value.sha : sha,
  category: typeof value.category === "string" ? value.category : "internal",
  areas: jsonArray(value.areas),
  userVisible: value.userVisible === true,
  summary: typeof value.summary === "string" && value.summary.trim() ? value.summary.trim() : "Updated Scorel internals.",
  details: jsonArray(value.details),
  breakingChanges: jsonArray(value.breakingChanges),
  verification: jsonArray(value.verification),
  confidence: ["high", "medium", "low"].includes(value.confidence) ? value.confidence : "low",
});

const normalizeReleaseNotes = (value, version, date) => ({
  version,
  date,
  highlights: jsonArray(value.highlights),
  changes: jsonArray(value.changes),
  fixes: jsonArray(value.fixes),
  breakingChanges: jsonArray(value.breakingChanges),
  verification: jsonArray(value.verification),
  internal: jsonArray(value.internal),
});

export const summarizeCommit = async (evidence, options = {}) => {
  const request = buildCommitSummaryRequest(evidence, options);
  const parsed = await postDeepSeekJson(request, options);
  return normalizeCommitSummary(parsed, evidence.commit.sha);
};

export const aggregateReleaseNotes = async (evidence, options = {}) => {
  const request = buildAggregateRequest(evidence, options);
  const parsed = await postDeepSeekJson(request, options);
  return normalizeReleaseNotes(parsed, evidence.version, evidence.date);
};

const section = (title, items) => (items.length > 0 ? `\n### ${title}\n\n${items.map((item) => `- ${item}`).join("\n")}\n` : "");

export const renderReleaseNotesMarkdown = (notes) => {
  const markdown = [
    `## ${notes.version} - ${notes.date}\n`,
    section("Highlights", jsonArray(notes.highlights)),
    section("Changes", jsonArray(notes.changes)),
    section("Fixes", jsonArray(notes.fixes)),
    section("Breaking Changes", jsonArray(notes.breakingChanges)),
    section("Verification", jsonArray(notes.verification)),
    section("Internal", jsonArray(notes.internal)),
  ]
    .join("")
    .trimEnd();
  return `${markdown}\n`;
};

export const insertReleaseNotes = (changelog, markdown) => {
  const marker = "## Unreleased\n";
  if (!changelog.includes(marker)) {
    throw new Error("docs/CHANGELOG.md is missing ## Unreleased");
  }
  return changelog.replace(marker, `${marker}\n${markdown.trim()}\n`);
};

export const collectCommitEvidence = ({ from, to = "HEAD", runGit = defaultRunGit, patchLimit = defaultPatchLimit }) => {
  const range = from ? `${from}..${to}` : to;
  const log = runGit(["log", "--format=%H%x1f%s%x1f%b%x1e", range]);
  const commits = log
    ? log
        .split("\x1e")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [sha, subject, body = ""] = entry.split("\x1f");
          return { sha, subject, body: body.trim() };
        })
    : [];

  return commits.map((commit) => {
    const changedFiles = runGit(["show", "--format=", "--name-only", commit.sha])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const diffStat = runGit(["show", "--format=", "--stat", commit.sha]);
    const rawPatch = runGit(["show", "--format=", "--patch", "--find-renames", commit.sha]);
    const filtered = filterPatch(rawPatch, { maxChars: patchLimit });
    return {
      repository: "Scorel",
      commit,
      changedFiles,
      diffStat,
      patch: filtered.patch,
      patchMeta: {
        truncated: filtered.truncated,
        removedGeneratedBlocks: filtered.removedBlocks,
      },
    };
  });
};

export const fallbackReleaseNotes = ({ version, date, commitEvidence }) => {
  const changes = commitEvidence.map((item) => item.commit.subject).filter(Boolean);
  return {
    version,
    date,
    highlights: changes.slice(0, 5),
    changes,
    fixes: [],
    breakingChanges: [],
    verification: [],
    internal: changes.length === 0 ? ["No commits found in the release range."] : [],
  };
};

export const generateReleaseNotes = async ({ from, to = "HEAD", version, date = new Date().toISOString().slice(0, 10), allowFallback = false, runGit = defaultRunGit, ...options }) => {
  if (!version) {
    throw new Error("version is required");
  }
  const commitEvidence = collectCommitEvidence({ from, to, runGit, patchLimit: options.patchLimit });
  try {
    const commitSummaries = [];
    for (const evidence of commitEvidence) {
      commitSummaries.push(await summarizeCommit(evidence, options));
    }
    const notes = await aggregateReleaseNotes(
      {
        version,
        date,
        range: from ? `${from}..${to}` : to,
        commitSummaries,
      },
      options,
    );
    return { notes, markdown: renderReleaseNotesMarkdown(notes), fallback: false, commitSummaries };
  } catch (error) {
    if (!allowFallback) {
      throw error;
    }
    const notes = fallbackReleaseNotes({ version, date, commitEvidence });
    return { notes, markdown: renderReleaseNotesMarkdown(notes), fallback: true, error };
  }
};

const parseArgs = (argv) => {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from" || arg === "--to" || arg === "--version") {
      values[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else if (arg === "--fallback") {
      values.fallback = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return values;
};

export const runReleaseNotesCli = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (!args.version) {
    throw new Error("Usage: pnpm release-notes --from <tag> --to <ref> --version <version> [--fallback]");
  }
  const result = await generateReleaseNotes({
    from: args.from,
    to: args.to ?? "HEAD",
    version: args.version,
    allowFallback: args.fallback,
  });
  process.stdout.write(result.markdown);
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  runReleaseNotesCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export const writeReleaseNotesToChangelog = async ({ changelogPath = resolve(root, "docs/CHANGELOG.md"), markdown }) => {
  const current = await readFile(changelogPath, "utf8");
  await writeFile(changelogPath, insertReleaseNotes(current, markdown));
};
