import { asClientId, type ClientId } from "@scorel/protocol";

import { BrowserStore } from "./browser-store";

export const WEBUI_CLIENT_ID_KEY = "clientId";

export class WebUiClientIdentityStore {
  readonly #store: BrowserStore;

  constructor(store: BrowserStore) {
    this.#store = store;
  }

  getOrCreate(): ClientId {
    const existing = this.#store.get<string>(WEBUI_CLIENT_ID_KEY);
    if (existing) {
      return asClientId(existing);
    }
    const value = asClientId(`webui_${createId()}`);
    this.#store.set(WEBUI_CLIENT_ID_KEY, value);
    return value;
  }
}

const createId = (): string =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`;
