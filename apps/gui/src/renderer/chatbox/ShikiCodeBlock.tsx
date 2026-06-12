import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

import { Check, Clipboard } from "../icons/index.js";

const THEME_NAME = "github-dark-default";

type Status = "loading" | "ready" | "error";

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
      const themeMod = await import("shiki/themes/github-dark-default.mjs");
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
  backgroundColor: "transparent",
};

export default function ShikiCodeBlock({
  lang,
  code,
}: ShikiCodeBlockProps) {
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
        let out: string;
        try {
          out = highlighter.codeToHtml(code, { lang, theme: THEME_NAME });
        } catch {
          out = highlighter.codeToHtml(code, { lang: "text", theme: THEME_NAME });
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
        /* clipboard rejected */
      }
    })();
  }, [code]);

  return (
    <div className="shiki-block">
      <div className="shiki-block__header">
        <span
          className="shiki-block__lang"
          title={lang || "text"}
        >
          {lang || "text"}
        </span>
        <button
          type="button"
          className="shiki-block__copy"
          onClick={onCopy}
          aria-label={copied ? "已复制代码" : "复制代码"}
          title={copied ? "已复制" : "复制代码"}
        >
          {copied ? <Check size={13} /> : <Clipboard size={13} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {status === "ready" && html ? (
        <div
          className="shiki-block__html"
          style={PRE_STYLE}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre>{code}</pre>
      )}
    </div>
  );
}
