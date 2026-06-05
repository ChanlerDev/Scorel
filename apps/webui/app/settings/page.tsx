"use client";

import { useState } from "react";
import { DeviceForm } from "../../components/settings/device-form";
import { DeviceList } from "../../components/settings/device-list";
import { RelayPairingPanel } from "../../components/settings/relay-pairing-panel";
import { useRunningBehavior } from "../../lib/store/use-running-behavior";
import type { RunningMessageBehavior } from "../../lib/store/running-behavior";
import { useDevices } from "../../lib/store/use-devices";

export default function SettingsPage() {
  const { store } = useDevices();
  const { behavior, store: behaviorStore } = useRunningBehavior();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text">Devices</h1>
        {!adding ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAdding(true);
            }}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-hover"
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
        <div className="rounded-md border border-status-err bg-surface-raised px-3 py-2 text-sm text-status-err">
          {error}
        </div>
      ) : null}

      <DeviceList />
      <RelayPairingPanel store={store} />

      <section className="space-y-3 border-t border-subtle pt-6">
        <div>
          <h2 className="text-md font-semibold text-text">Running behavior</h2>
          <p className="mt-1 text-sm text-muted">
            Command+Enter sends with this behavior while a run is active. Command+Shift+Enter sends the opposite.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-subtle bg-bg p-1">
          {runningBehaviorOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                option.value === behavior
                  ? "rounded px-3 py-1.5 text-sm font-medium text-bg bg-accent"
                  : "rounded px-3 py-1.5 text-sm font-medium text-muted hover:text-text"
              }
              onClick={() => behaviorStore.set(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

const runningBehaviorOptions: Array<{ value: RunningMessageBehavior; label: string }> = [
  { value: "follow_up", label: "Follow up" },
  { value: "steer", label: "Steer" },
];
