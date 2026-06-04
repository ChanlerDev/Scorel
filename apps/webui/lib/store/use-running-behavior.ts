"use client";

import { useSyncExternalStore } from "react";

import {
  __resetSharedRunningBehaviorStoreForTests,
  __setSharedRunningBehaviorStoreForTests,
  getSharedRunningBehaviorStore,
  type RunningBehaviorStore,
} from "./index";
import {
  DEFAULT_RUNNING_BEHAVIOR,
  type RunningMessageBehavior,
} from "./running-behavior";

export function useRunningBehavior(): {
  behavior: RunningMessageBehavior;
  store: RunningBehaviorStore;
} {
  const store = getSharedRunningBehaviorStore();
  const behavior = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(),
    () => DEFAULT_RUNNING_BEHAVIOR,
  );
  return { behavior, store };
}

export function __resetRunningBehaviorStoreForTests(): void {
  __resetSharedRunningBehaviorStoreForTests();
}

export function __setRunningBehaviorStoreForTests(store: RunningBehaviorStore): void {
  __setSharedRunningBehaviorStoreForTests(store);
}
