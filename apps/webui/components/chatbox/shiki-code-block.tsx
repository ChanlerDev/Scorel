"use client";

/**
 * Lazy-loaded Shiki code block. See
 * `docs/spec/ship/S0041-webui-markdown-and-tool-block.md` §"shiki-code-block".
 *
 * Module-scope singleton: we create the highlighter once, then load grammars
 * on demand. First paint of an unloaded language renders a plain <pre>; once
 * `loadLanguage()` resolves, a `setState` flips us to the highlighted HTML.
 *
 * Bundle strategy: the parent `markdown-view.tsx` imports this module via
 * `lazy()`, so the highlighter engine + WASM only enter the bundle when the
 * first code block actually mounts. Within this module we use a static
 * allow-list of grammar imports so webpack can split each language into its
 * own chunk and load them independently. Adding a language is a one-line
 * addition to `LANG_LOADERS` below.
 */

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

const THEME_NAME = "github-light-default";

type Status = "loading" | "ready" | "error";

// Static loader map. Each entry is a plain function that returns the dynamic
// import for one grammar. Webpack splits each call site into its own chunk
// at build time, so the bundle stays tree-shakeable. Aliases (`ts` → `tsx`
// / `typescript`) flow through the same loader. Unknown languages fall
// through to plain-text rendering.
const LANG_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  ts: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  js: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  shell: () => import("shiki/langs/shellscript.mjs"),
  sh: () => import("shiki/langs/shellscript.mjs"),
  zsh: () => import("shiki/langs/shellscript.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  py: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  rs: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  yml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  md: () => import("shiki/langs/markdown.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();
const langPromises = new Map<string, Promise<void>>();

function ensureHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const themeMod = await import("shiki/themes/github-light-default.mjs");
      const wasm = await import("shiki/wasm");
      return createHighlighterCore({
        themes: [themeMod.default ?? themeMod],
        langs: [],
        engine: createOnigurumaEngine(wasm.default ?? wasm),
      });
    })();
  }
  return highlighterPromise;
}

async function ensureLanguage(lang: string): Promise<void> {
  if (loadedLangs.has(lang)) return;
  const loader = LANG_LOADERS[lang];
  if (!loader) {
    // Mark unsupported languages as resolved so we don't keep retrying. The
    // render path falls back to plain `<pre>` for any unknown grammar.
    loadedLangs.add(lang);
    return;
  }
  let pending = langPromises.get(lang);
  if (!pending) {
    pending = (async () => {
      const highlighter = await ensureHighlighter();
      try {
        const grammar = await loader();
        await highlighter.loadLanguage(grammar.default as never);
        loadedLangs.add(lang);
      } catch {
        loadedLangs.add(lang);
      }
    })();
    langPromises.set(lang, pending);
  }
  return pending;
}

export type ShikiCodeBlockProps = {
  lang: string;
  code: string;
};

const PRE_STYLE: CSSProperties = {
  // Shiki injects an inline `background-color` on its <pre>; the wrapper
  // background takes precedence so the code block matches design tokens.
  backgroundColor: "transparent",
};

export default function ShikiCodeBlock({
  lang,
  code,
}: ShikiCodeBlockProps): JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [copied, setCopied] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    let cancelled = false;
    void (async () => {
      try {
        const highlighter = await ensureHighlighter();
        await ensureLanguage(lang);
        if (cancelled || cancelRef.current) return;
        // Shiki throws if the language is not loaded; we attempt the alias
        // first and fall back to plain "text" highlighting (no tokens) when
        // unknown. Plain `text` is always supported by Shiki without an
        // explicit grammar import.
        let out: string;
        try {
          out = highlighter.codeToHtml(code, {
            lang,
            theme: THEME_NAME,
          });
        } catch {
          out = highlighter.codeToHtml(code, {
            lang: "text",
            theme: THEME_NAME,
          });
        }
        if (cancelled || cancelRef.current) return;
        setHtml(out);
        setStatus("ready");
      } catch {
        if (cancelled || cancelRef.current) return;
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      cancelRef.current = true;
    };
  }, [code, lang]);

  const onCopy = useCallback(() => {
    void (async () => {
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(code);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } catch {
        /* clipboard rejected — silently ignore */
      }
    })();
  }, [code]);

  return (
    <div
      data-testid="shiki-code-block"
      className="group relative my-2 overflow-hidden rounded-md border border-subtle bg-surface-raised"
    >
      <button
        type="button"
        onClick={onCopy}
        className="absolute right-2 top-2 z-10 rounded px-1 text-xs text-faint hover:text-text"
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {status === "ready" && html ? (
        <div
          data-testid="shiki-highlighted"
          className="overflow-x-auto p-3 text-xs [&_pre]:!bg-transparent"
          style={PRE_STYLE}
          // Output is produced by Shiki on the client; sanitization happens
          // upstream in MarkdownView's pipeline before code reaches here, and
          // Shiki never echoes user-provided HTML — only token classes.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre
          data-testid="shiki-fallback"
          className="overflow-x-auto p-3 font-mono text-xs"
        >
          {code}
        </pre>
      )}
    </div>
  );
}
