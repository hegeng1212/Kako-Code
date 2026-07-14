import { describe, expect, it } from "vitest";
import type { ProviderRegistry } from "@kako/shared";
import { resolveModelContextWindow } from "./context-window.js";
import {
  applyEstimateRatio,
  updateTokenEstimateRatio,
} from "./tokens.js";

describe("resolveModelContextWindow", () => {
  it("prefers per-model override", () => {
    const registry = {
      version: 1,
      active: { providerId: "p", model: "m" },
      providers: [
        {
          id: "p",
          name: "P",
          protocol: "openai-compatible" as const,
          baseUrl: "http://x",
          models: ["m"],
          enabled: true,
          contextWindow: 64_000,
          modelContextWindows: { m: 32_000 },
        },
      ],
    } satisfies ProviderRegistry;
    expect(resolveModelContextWindow(registry, "m")).toBe(32_000);
  });

  it("falls back to provider contextWindow then default", () => {
    const registry = {
      version: 1,
      active: { providerId: "p", model: "m" },
      providers: [
        {
          id: "p",
          name: "P",
          protocol: "openai-compatible" as const,
          baseUrl: "http://x",
          models: ["m"],
          enabled: true,
          contextWindow: 64_000,
        },
      ],
    } satisfies ProviderRegistry;
    expect(resolveModelContextWindow(registry, "m")).toBe(64_000);
    expect(
      resolveModelContextWindow(
        { ...registry, providers: [{ ...registry.providers[0]!, contextWindow: undefined }] },
        "unknown",
      ),
    ).toBe(128_000);
  });
});

describe("token estimate ratio", () => {
  it("moves toward actual/estimated and clamps", () => {
    const next = updateTokenEstimateRatio(1, 1000, 2000);
    expect(next).toBeGreaterThan(1);
    expect(next).toBeLessThanOrEqual(2);
    expect(updateTokenEstimateRatio(1, 1000, 10_000)).toBe(2);
    expect(updateTokenEstimateRatio(1, 1000, 100)).toBeGreaterThanOrEqual(0.5);
    expect(applyEstimateRatio(1000, 1.5)).toBe(1500);
  });
});
