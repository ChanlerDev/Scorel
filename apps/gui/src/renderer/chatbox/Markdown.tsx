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

const ShikiCodeBlock = lazy(() => import("./ShikiCodeBlock.js"));

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

const components: Components = {
  code(props) {
    const { className, children, node: _node, ...rest } = props as ComponentProps<"code"> & {
      node?: unknown;
    };
    const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : String(children ?? "");
    const match = /language-([\w-]+)/.exec(className ?? "");
    const looksInline = !match && !text.includes("\n");
    if (looksInline) {
      return <code {...rest}>{children}</code>;
    }
    return (
      <Suspense
        fallback={
          <pre>
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
    return <>{children}</>;
  },
  a({ children, href, ...rest }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
        {children}
      </a>
    );
  },
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [[rehypeSanitize, sanitizeSchema]] as const;

export type MarkdownProps = {
  text: string;
};

export const Markdown = memo(function Markdown({ text }: MarkdownProps) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins as never}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
