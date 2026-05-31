"use client";

import { useMemo, useState } from "react";
import { validateLink } from "../../lib/domain/link";
import type { Device } from "../../lib/domain/devices";

export type DeviceFormValues = Pick<Device, "name" | "link" | "token">;

export type DeviceFormProps = {
  initial?: DeviceFormValues;
  onSubmit: (values: DeviceFormValues) => void;
  onCancel: () => void;
  submitLabel: string;
};

type FieldErrors = {
  name?: string;
  link?: string;
  token?: string;
};

function validate(values: DeviceFormValues): FieldErrors {
  const errors: FieldErrors = {};
  const trimmedName = values.name.trim();
  if (trimmedName.length === 0) {
    errors.name = "Name is required";
  } else if (trimmedName.length > 64) {
    errors.name = "Name must be at most 64 characters";
  }
  const linkResult = validateLink(values.link);
  if (!linkResult.ok) {
    errors.link = linkResult.reason;
  }
  if (values.token.length === 0) {
    errors.token = "Token is required";
  } else if (values.token.length > 4096) {
    errors.token = "Token must be at most 4096 characters";
  }
  return errors;
}

export function DeviceForm({ initial, onSubmit, onCancel, submitLabel }: DeviceFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [link, setLink] = useState(initial?.link ?? "");
  const [token, setToken] = useState(initial?.token ?? "");
  const [touched, setTouched] = useState<{ name: boolean; link: boolean; token: boolean }>({
    name: false,
    link: false,
    token: false,
  });

  const errors = useMemo(() => validate({ name, link, token }), [name, link, token]);
  const isValid = !errors.name && !errors.link && !errors.token;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setTouched({ name: true, link: true, token: true });
    if (!isValid) return;
    onSubmit({ name: name.trim(), link, token });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-md border border-subtle bg-surface-raised p-4"
    >
      <div className="space-y-1">
        <label htmlFor="device-name" className="block text-sm font-medium text-text">
          Name
        </label>
        <input
          id="device-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          className="w-full rounded-md border border-subtle bg-surface-raised px-3 py-2 text-sm text-text"
          aria-invalid={touched.name && !!errors.name}
          aria-describedby={errors.name ? "device-name-error" : undefined}
        />
        {touched.name && errors.name ? (
          <p id="device-name-error" className="text-xs text-status-err">
            {errors.name}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="device-link" className="block text-sm font-medium text-text">
          Link
        </label>
        <input
          id="device-link"
          type="text"
          value={link}
          placeholder="wss://host:9876"
          onChange={(e) => setLink(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, link: true }))}
          className="w-full rounded-md border border-subtle bg-surface-raised px-3 py-2 text-sm font-mono text-text"
          aria-invalid={touched.link && !!errors.link}
          aria-describedby={errors.link ? "device-link-error" : undefined}
        />
        {touched.link && errors.link ? (
          <p id="device-link-error" className="text-xs text-status-err">
            {errors.link}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="device-token" className="block text-sm font-medium text-text">
          Token
        </label>
        <input
          id="device-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, token: true }))}
          className="w-full rounded-md border border-subtle bg-surface-raised px-3 py-2 text-sm font-mono text-text"
          aria-invalid={touched.token && !!errors.token}
          aria-describedby={errors.token ? "device-token-error" : undefined}
        />
        {touched.token && errors.token ? (
          <p id="device-token-error" className="text-xs text-status-err">
            {errors.token}
          </p>
        ) : null}
        <p className="text-xs text-status-warn">
          Token is stored in cleartext in browser storage. Do not share screenshots of Settings.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!isValid}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-subtle bg-surface-raised px-3 py-1.5 text-sm text-muted hover:border-border-strong hover:text-text"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
