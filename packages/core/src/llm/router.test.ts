import { describe, expect, it } from "vitest";
import type { ProviderRegistry } from "@kako/shared";
import { resolveModel } from "./router.js";

function registry(overrides: Partial<ProviderRegistry> = {}): ProviderRegistry {
  return {
    version: 1,
    active: { providerId: "volcengine", model: "doubao-seed-1-6-250615" },
    providers: [
      {
        id: "volcengine",
        name: "Volcengine",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        models: ["doubao-seed-1-6-250615"],
        defaultModel: "doubao-seed-1-6-250615",
        enabled: true,
      },
    ],
    ...overrides,
  };
}

describe("resolveModel", () => {
  it("returns active model when agent model is empty", async () => {
    expect(await resolveModel("", registry())).toBe("doubao-seed-1-6-250615");
    expect(await resolveModel(undefined, registry())).toBe("doubao-seed-1-6-250615");
  });

  it("falls back to active model for legacy anthropic/ prefix on another provider", async () => {
    expect(await resolveModel("anthropic/claude-sonnet-4", registry())).toBe(
      "doubao-seed-1-6-250615",
    );
  });

  it("uses model part when provider prefix matches active provider", async () => {
    const reg = registry({
      active: { providerId: "volcengine", model: "doubao-seed-1-6-250615" },
    });
    expect(await resolveModel("volcengine/doubao-seed-1-6-250615", reg)).toBe(
      "doubao-seed-1-6-250615",
    );
  });

  it("maps Agent tool aliases to the active provider model", async () => {
    expect(await resolveModel("sonnet", registry())).toBe("doubao-seed-1-6-250615");
    expect(await resolveModel("opus", registry())).toBe("doubao-seed-1-6-250615");
  });

  it("falls back when bare model is not listed on active provider", async () => {
    expect(await resolveModel("claude-sonnet-4", registry())).toBe("doubao-seed-1-6-250615");
  });

  it("keeps bare model when listed on active provider", async () => {
    expect(await resolveModel("doubao-seed-1-6-250615", registry())).toBe(
      "doubao-seed-1-6-250615",
    );
  });

  it("rejects agent model hints outside the enabled models list", async () => {
    const reg = registry({
      providers: [
        {
          id: "volcengine",
          name: "Volcengine",
          protocol: "openai-compatible",
          baseUrl: "https://example.com/v1",
          models: ["doubao-seed-1-6-250615", "doubao-lite"],
          defaultModel: "doubao-seed-1-6-250615",
          enabled: true,
        },
      ],
    });
    expect(await resolveModel("doubao-lite", reg)).toBe("doubao-lite");
    expect(await resolveModel("unknown-model", reg)).toBe("doubao-seed-1-6-250615");
  });
});
