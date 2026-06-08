import type { ComponentType } from "react";

import type {
  ToolCallContentBlock,
  ToolResultContentBlock,
} from "@scorel/protocol";

export type ToolBlockProps = {
  call: ToolCallContentBlock;
  result?: ToolResultContentBlock;
  pending: boolean;
};

export type ToolBlockComponent = ComponentType<ToolBlockProps>;

const registry = new Map<string, ToolBlockComponent>();
let fallback: ToolBlockComponent | null = null;

export function registerToolBlock(toolName: string, component: ToolBlockComponent): void {
  registry.set(toolName, component);
}

export function setToolBlockFallback(component: ToolBlockComponent): void {
  fallback = component;
}

export function lookupToolBlock(toolName: string): ToolBlockComponent {
  const hit = registry.get(toolName);
  if (hit) return hit;
  if (!fallback) {
    throw new Error("Tool block fallback is not registered");
  }
  return fallback;
}
