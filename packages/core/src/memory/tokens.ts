import type { MemoryInjectCaps } from "@kako/shared";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";

/** Rough token estimate: ~4 chars per token (provider-agnostic budget contract). */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(
  messages: Array<{ content?: string; role?: string; toolName?: string }>,
): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTextTokens(m.content ?? "");
    total += estimateTextTokens(m.toolName ?? "");
    total += 4; // role / framing overhead
  }
  return total;
}

export function softCompactThreshold(
  contextWindow: number,
  caps: MemoryInjectCaps = DEFAULT_MEMORY_INJECT_CAPS,
): number {
  const usable = Math.max(1, contextWindow - caps.compactReserveTokens);
  return Math.floor(usable * caps.softCompactRatio);
}

export function resolveContextWindow(modelContextWindow?: number): number {
  return modelContextWindow && modelContextWindow > 0 ? modelContextWindow : 128_000;
}

const RATIO_MIN = 0.5;
const RATIO_MAX = 2.0;

/** EMA blend of actual/estimated input tokens; clamped to [0.5, 2.0]. */
export function updateTokenEstimateRatio(
  previous: number | undefined,
  estimated: number,
  actualInputTokens: number,
): number {
  const prev = previous && previous > 0 ? previous : 1;
  if (estimated <= 0 || actualInputTokens <= 0) return prev;
  const sample = actualInputTokens / estimated;
  const next = prev * 0.7 + sample * 0.3;
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, next));
}

export function applyEstimateRatio(estimate: number, ratio: number | undefined): number {
  const r = ratio && ratio > 0 ? ratio : 1;
  return Math.max(0, Math.floor(estimate * r));
}
