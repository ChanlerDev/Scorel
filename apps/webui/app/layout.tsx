// Self-hosted monospace font (S0040 → S0044). Imported once at the root so
// every route inherits the same font CSS without a Google Fonts network
// call at runtime. The body sans stack stays system-only, so the first
// paint never waits on a font fetch. Newsreader (display serif) was
// removed in S0044 — the new ChatGPT-philosophy palette is sans-only.
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import "./globals.css";
import { Sidebar } from "../components/shell/sidebar";

export const metadata = {
  title: "Scorel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen flex bg-bg text-text font-sans">
        <Sidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </body>
    </html>
  );
}
