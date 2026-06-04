import { BrowserStore } from "./browser-store";

export type RunningMessageBehavior = "follow_up" | "steer";

export const RUNNING_BEHAVIOR_KEY = "settings.running-message-behavior";
export const DEFAULT_RUNNING_BEHAVIOR: RunningMessageBehavior = "follow_up";

export class RunningBehaviorStore {
  readonly #store: BrowserStore;
  #snapshot: RunningMessageBehavior | null = null;

  constructor(store: BrowserStore) {
    this.#store = store;
  }

  get(): RunningMessageBehavior {
    if (this.#snapshot === null) {
      this.#snapshot = normalize(this.#store.get<unknown>(RUNNING_BEHAVIOR_KEY));
    }
    return this.#snapshot;
  }

  set(value: RunningMessageBehavior): void {
    this.#snapshot = normalize(value);
    this.#store.set(RUNNING_BEHAVIOR_KEY, this.#snapshot);
  }

  subscribe(listener: () => void): () => void {
    return this.#store.subscribe(RUNNING_BEHAVIOR_KEY, () => {
      this.#snapshot = null;
      listener();
    });
  }
}

export const oppositeRunningBehavior = (
  value: RunningMessageBehavior,
): RunningMessageBehavior => (value === "follow_up" ? "steer" : "follow_up");

const normalize = (value: unknown): RunningMessageBehavior =>
  value === "steer" || value === "follow_up" ? value : DEFAULT_RUNNING_BEHAVIOR;
