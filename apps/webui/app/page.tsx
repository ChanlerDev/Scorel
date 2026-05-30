"use client";

import Link from "next/link";
import { useDevices } from "../lib/store/use-devices";

export default function HomePage() {
  const { devices } = useDevices();

  if (devices.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-zinc-600">
          Add a device in Settings to get started.
        </p>
        <Link
          href="/settings"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Open Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 text-sm text-zinc-600">
      Select a device from the sidebar to get started.
    </div>
  );
}
