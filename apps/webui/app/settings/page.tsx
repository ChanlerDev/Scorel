"use client";

import { useState } from "react";
import { DeviceForm } from "../../components/settings/device-form";
import { DeviceList } from "../../components/settings/device-list";
import { useDevices } from "../../lib/store/use-devices";

export default function SettingsPage() {
  const { store } = useDevices();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Devices</h1>
        {!adding ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAdding(true);
            }}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            + Add Device
          </button>
        ) : null}
      </header>

      {adding ? (
        <DeviceForm
          submitLabel="Save"
          onCancel={() => {
            setError(null);
            setAdding(false);
          }}
          onSubmit={(values) => {
            try {
              store.create(values);
              setError(null);
              setAdding(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "failed to create device");
            }
          }}
        />
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <DeviceList />
    </div>
  );
}
