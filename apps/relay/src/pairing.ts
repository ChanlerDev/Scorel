import { randomInt } from "node:crypto";

import type { ClientId } from "@scorel/protocol";

export type PairSession = {
  pairCode: string;
  clientId: ClientId;
  expiresAt: number;
};

export class RelayPairing {
  readonly #sessions = new Map<string, PairSession>();
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #createPairCode: () => string;

  constructor(options: { ttlMs?: number; now?: () => number; createPairCode?: () => string } = {}) {
    this.#ttlMs = options.ttlMs ?? 5 * 60_000;
    this.#now = options.now ?? Date.now;
    this.#createPairCode = options.createPairCode ?? defaultPairCode;
  }

  create(clientId: ClientId): PairSession {
    this.#pruneExpired();
    let pairCode = this.#createPairCode();
    while (this.#sessions.has(pairCode)) {
      pairCode = this.#createPairCode();
    }
    const session = { pairCode, clientId, expiresAt: this.#now() + this.#ttlMs };
    this.#sessions.set(pairCode, session);
    return session;
  }

  consume(pairCode: string): { ok: true; clientId: ClientId } | { ok: false; reason: "not_found" | "expired" } {
    const session = this.#sessions.get(pairCode);
    if (!session) {
      return { ok: false, reason: "not_found" };
    }
    this.#sessions.delete(pairCode);
    if (session.expiresAt <= this.#now()) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, clientId: session.clientId };
  }

  #pruneExpired(): void {
    const now = this.#now();
    for (const [pairCode, session] of this.#sessions) {
      if (session.expiresAt <= now) {
        this.#sessions.delete(pairCode);
      }
    }
  }
}

const defaultPairCode = (): string => `${randomInt(100_000, 1_000_000)}`;
