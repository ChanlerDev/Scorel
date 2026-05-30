import "./globals.css";
import { Sidebar } from "../components/shell/sidebar";
import { Topbar } from "../components/shell/topbar";

export const metadata = {
  title: "Scorel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen flex flex-col bg-zinc-50 text-zinc-900">
        <Topbar />
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
