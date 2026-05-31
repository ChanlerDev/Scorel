"use client";

/**
 * Single source of truth for any markdown-bearing content rendered in the
 * chatbox (user, assistant, thinking, and tool-block JSON fences). See
 * `docs/spec/ship/S0041-webui-markdown-and-tool-block.md`.
 *
 * Pipeline: `react-markdown` → `remark-gfm` → `rehype-sanitize` (schema below).
 *
 * SECURITY: this file MUST NOT import or enable `rehype-raw`. Doing so would
 * surface raw HTML from LLM output through the sanitizer and re-open the XSS
 * surface that the schema-based hast pipeline closes. The sanitizer schema
 * lives at module scope and is reviewed alongside this file.
 */

import {
  type ComponentProps,
  Suspense,
  lazy,
  memo,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from "rehype-sanitize";

// Shiki ships a few hundred KB of highlighter engine + grammars; lazy load it
// so the first paint of an empty / text-only chat does not pay the bundle
// cost. The component itself falls back to a plain <pre> via Suspense until
// the chunk resolves.
const ShikiCodeBlock = lazy(() => import("./shiki-code-block"));

// Schema-based hast sanitization. We start from the GitHub-style default and
// only widen it for attributes our custom components actually use:
//   - `code.className` so language tags survive into our renderer
//   - `span.className` so highlighted token classes from Shiki survive
//   - `a[target]` / `a[rel]` so we can force `_blank` + `noreferrer noopener`
// We also strip the `script` and `style` tag names defensively even though
// the default schema already excludes them — this catches the case where a
// future maintainer accidentally adds them back via a partial override.
const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...((defaultSchema.attributes && defaultSchema.attributes.code) ?? []),
      ["className"],
    ],
    span: [
      ...((defaultSchema.attributes && defaultSchema.attributes.span) ?? []),
      ["className"],
    ],
    a: [
      ...((defaultSchema.attributes && defaultSchema.attributes.a) ?? []),
      ["target"],
      ["rel"],
    ],
  },
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => t !== "script" && t !== "style",
  ),
};

// The `components` prop must be referentially stable across renders so that
// `memo` on the wrapper actually skips re-parses. Define once at module
// scope.
const components: Components = {
  code(props) {
    const { className, children, node, ...rest } = props as ComponentProps<"code"> & {
      node?: { tagName?: string; position?: unknown };
    };
    const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : String(children ?? "");
    const match = /language-([\w-]+)/.exec(className ?? "");
    // react-markdown v10 dropped the `inline` prop. We treat anything that
    // does not carry a `language-*` class AND does not contain a newline as
    // inline. Block code always gets a language class from remark — even
    // unfenced indented code lacks the class but we still treat it as block
    // when it contains a newline.
    const looksInline = !match && !text.includes("\n");
    if (looksInline) {
      return (
        <code
          className="rounded bg-surface-raised px-1 font-mono text-xs"
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <Suspense
        fallback={
          <pre className="overflow-x-auto rounded bg-surface-raised p-3 text-xs">
            <code>{text.replace(/\n$/, "")}</code>
          </pre>
        }
      >
        <ShikiCodeBlock
          lang={match?.[1] ?? "text"}
          code={text.replace(/\n$/, "")}
        />
      </Suspense>
    );
  },
  pre({ children }) {
    // remark already wraps fenced code in <pre><code>. We render the <pre>
    // shell only when react-markdown asks for it via the default pipeline;
    // ShikiCodeBlock is responsible for its own <pre>, so passing children
    // through unchanged is the safe default.
    return <>{children}</>;
  },
  a({ children, href, ...rest }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent underline-offset-2 hover:text-accent-hover hover:underline"
        {...rest}
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table className="border border-subtle text-sm">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className="border border-subtle px-2 py-1 text-left">{children}</th>;
  },
  td({ children }) {
    return <td className="border border-subtle px-2 py-1">{children}</td>;
  },
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [[rehypeSanitize, sanitizeSchema]] as const;

export type MarkdownViewProps = {
  text: string;
};

/**
 * Render a markdown string through the chatbox markdown pipeline. Memoized
 * on the `text` prop: when other turns in the transcript re-render, only the
 * one whose `text` actually changed re-parses.
 */
export const MarkdownView = memo(function MarkdownView({
  text,
}: MarkdownViewProps): JSX.Element {
  return (
    <div className="prose prose-sm max-w-none prose-tweak">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        // The cast is necessary because `rehypePlugins` carries the
        // `[plugin, options]` tuple shape and `Pluggable` widens both arms.
        rehypePlugins={rehypePlugins as never}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
