import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

/**
 * Codex-style design tokens (S0040). Every utility maps to a CSS variable
 * defined in `app/globals.css`, so swapping the palette is a one-file
 * change. Components write semantic classes (`bg-surface`, `text-muted`,
 * `border-subtle`, `text-accent`) instead of literal `zinc-*` / `red-*`.
 *
 * Tailwind 4 resolves `var(--…)` natively in the color pipeline — no
 * `rgb(var(--x) / <alpha-value>)` trick required.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        "surface-raised": "var(--color-surface-raised)",
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
        subtle: "var(--color-border)",
        faint: "var(--color-text-faint)",
        muted: "var(--color-text-muted)",
        text: "var(--color-text)",
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          soft: "var(--color-accent-soft)",
        },
        status: {
          ok: "var(--color-status-ok)",
          warn: "var(--color-status-warn)",
          err: "var(--color-status-err)",
          idle: "var(--color-status-idle)",
        },
      },
      textColor: {
        DEFAULT: "var(--color-text)",
        muted: "var(--color-text-muted)",
        faint: "var(--color-text-faint)",
        accent: "var(--color-accent)",
      },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-body)",
        mono: "var(--font-mono)",
      },
      fontSize: {
        xs: ["var(--text-xs)", "var(--leading-xs)"],
        sm: ["var(--text-sm)", "var(--leading-sm)"],
        base: ["var(--text-base)", "var(--leading-base)"],
        md: ["var(--text-md)", "var(--leading-md)"],
        lg: ["var(--text-lg)", "var(--leading-lg)"],
        xl: ["var(--text-xl)", "var(--leading-xl)"],
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        8: "var(--space-8)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        focus: "var(--shadow-focus)",
      },
    },
  },
  plugins: [typography],
};

export default config;
