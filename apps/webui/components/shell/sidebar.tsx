import Link from "next/link";

export function Sidebar() {
  return (
    <aside className="w-[280px] shrink-0 border-r border-zinc-200 bg-white flex flex-col">
      <div className="p-3 space-y-2">
        <button
          type="button"
          disabled
          className="w-full text-left rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 cursor-not-allowed"
        >
          + New Chat
        </button>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400">
          Search…
        </div>
      </div>

      <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-zinc-500">
        Projects
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 text-sm text-zinc-500">
        <div className="px-2 py-3 italic">No devices yet.</div>
      </div>

      <div className="border-t border-zinc-200 p-3">
        <Link
          href="/settings"
          className="block rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          ⚙ Settings
        </Link>
      </div>
    </aside>
  );
}
