"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { DeviceForm } from "../../../../components/settings/device-form";
import { useDevices } from "../../../../lib/store/use-devices";

export default function SettingsDevicePage() {
  const params = useParams<{ deviceId: string }>();
  const router = useRouter();
  const { devices, store } = useDevices();
  const [error, setError] = useState<string | null>(null);

  const deviceId = params.deviceId;
  const device = devices.find((d) => d.id === deviceId);

  if (!device) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
        <p className="text-sm text-muted">Device not found.</p>
        <Link href="/settings" className="text-sm text-accent underline hover:text-accent-hover">
          Back to Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-lg text-text">Edit Device</h1>
        <button
          type="button"
          onClick={() => {
            if (typeof window === "undefined") return;
            const ok = window.confirm(`Delete device "${device.name}"?`);
            if (!ok) return;
            store.remove(device.id);
            router.push("/settings");
          }}
          className="rounded-md border border-status-err px-3 py-1.5 text-sm text-status-err hover:bg-accent-soft"
        >
          Delete
        </button>
      </header>

      {error ? (
        <div className="rounded-md border border-status-err bg-surface-raised px-3 py-2 text-sm text-status-err">
          {error}
        </div>
      ) : null}

      <DeviceForm
        submitLabel="Save"
        initial={{ name: device.name, link: device.link, token: device.token }}
        onCancel={() => router.push("/settings")}
        onSubmit={(values) => {
          try {
            store.update(device.id, values);
            setError(null);
            router.push("/settings");
          } catch (err) {
            setError(err instanceof Error ? err.message : "failed to update device");
          }
        }}
      />
    </div>
  );
}
