import type { ProviderRegistry } from "@kako/shared";
import { resolveContextWindow } from "./tokens.js";

/**
 * Resolve context window tokens for a model from the provider registry.
 * Prefer per-model map, then provider default, else 128_000.
 */
export function resolveModelContextWindow(
  registry: ProviderRegistry,
  modelId: string,
): number {
  const model = modelId.trim();
  for (const provider of registry.providers) {
    if (!provider.enabled) continue;
    const perModel = provider.modelContextWindows?.[model];
    if (typeof perModel === "number" && perModel > 0) {
      return resolveContextWindow(perModel);
    }
    const inList = provider.models.includes(model) || provider.defaultModel === model;
    if (inList && typeof provider.contextWindow === "number" && provider.contextWindow > 0) {
      return resolveContextWindow(provider.contextWindow);
    }
  }
  // Active provider fallback even if model not listed.
  const active = registry.providers.find((p) => p.id === registry.active.providerId);
  if (active) {
    const perModel = active.modelContextWindows?.[model];
    if (typeof perModel === "number" && perModel > 0) {
      return resolveContextWindow(perModel);
    }
    if (typeof active.contextWindow === "number" && active.contextWindow > 0) {
      return resolveContextWindow(active.contextWindow);
    }
  }
  return resolveContextWindow(undefined);
}
