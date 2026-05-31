// Self-hosted display + monospace fonts (S0040). Imported once at the
// root so every route inherits the same font CSS without a Google Fonts
// network call at runtime. The body sans stack stays system-only, so the
// first paint never waits on a font fetch.
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import "./globals.css";
import { Sidebar } from "../components/shell/sidebar";
import { Topbar } from "../components/shell/topbar";

export const metadata = {
  title: "Scorel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen flex flex-col bg-bg text-text font-sans">
        <Topbar />
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
