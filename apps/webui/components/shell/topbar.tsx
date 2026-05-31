import Link from "next/link";

export function Topbar() {
  return (
    <header className="h-11 shrink-0 border-b border-subtle bg-surface flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <span className="font-display text-lg text-text">Scorel</span>
        <span className="rounded-full border border-subtle px-2 py-0.5 text-xs text-faint">
          disconnected
        </span>
      </div>
      <Link
        href="/settings"
        className="text-sm text-accent hover:text-accent-hover"
      >
        Settings
      </Link>
    </header>
  );
}
