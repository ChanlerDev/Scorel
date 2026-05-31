"use client";

import Link from "next/link";
import { useDevices } from "../lib/store/use-devices";

export default function HomePage() {
  const { devices } = useDevices();

  if (devices.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-muted">
          Add a device in Settings to get started.
        </p>
        <Link
          href="/settings"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface-raised hover:bg-accent-hover"
        >
          Open Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 text-sm text-muted">
      Select a device from the sidebar to get started.
    </div>
  );
}
