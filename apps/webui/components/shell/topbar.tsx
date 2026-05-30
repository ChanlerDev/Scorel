import Link from "next/link";

export function Topbar() {
  return (
    <header className="h-12 shrink-0 border-b border-zinc-200 bg-white flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-zinc-900">Scorel</span>
        <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-400">
          disconnected
        </span>
      </div>
      <Link
        href="/settings"
        className="text-sm text-zinc-600 hover:text-zinc-900"
      >
        Settings
      </Link>
    </header>
  );
}
