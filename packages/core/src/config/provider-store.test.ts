import { describe, expect, it } from "vitest";
import {
  checkProviderReadiness,
  getActiveProvider,
  getProviderEnabledModels,
  resolveEnabledModel,
} from "./provider-store.js";
import type { ProviderRegistry } from "@kako/shared";

describe("checkProviderReadiness", () => {
  it("fails when api key and model are missing", () => {
    const registry: ProviderRegistry = {
      version: 1,
      active: { providerId: "p1", model: "" },
      providers: [
        {
          id: "p1",
          name: "Test",
          protocol: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          models: [],
          enabled: true,
        },
      ],
    };
    const result = checkProviderReadiness(registry);
    expect(result.ready).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("passes when provider is enabled with key and model", () => {
    const registry: ProviderRegistry = {
      version: 1,
      active: { providerId: "p1", model: "gpt-4o" },
      providers: [
        {
          id: "p1",
          name: "Test",
          protocol: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          models: ["gpt-4o"],
          enabled: true,
        },
      ],
    };
    expect(checkProviderReadiness(registry).ready).toBe(true);
  });

  it("fails when active provider is disabled", () => {
    const registry: ProviderRegistry = {
      version: 1,
      active: { providerId: "p1", model: "gpt-4o" },
      providers: [
        {
          id: "p1",
          name: "Test",
          protocol: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          models: ["gpt-4o"],
          enabled: false,
        },
      ],
    };
    const result = checkProviderReadiness(registry);
    expect(result.ready).toBe(false);
    expect(result.issues.some((i: string) => i.includes("停用"))).toBe(true);
  });

  it("fails when active model is not in the enabled models list", () => {
    const registry: ProviderRegistry = {
      version: 1,
      active: { providerId: "p1", model: "gpt-4o-mini" },
      providers: [
        {
          id: "p1",
          name: "Test",
          protocol: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          models: ["gpt-4o"],
          enabled: true,
        },
      ],
    };
    const result = checkProviderReadiness(registry);
    expect(result.ready).toBe(false);
    expect(result.issues.some((i: string) => i.includes("启用的模型列表"))).toBe(true);
  });
});

describe("resolveEnabledModel", () => {
  const profile = {
    id: "p1",
    name: "Test",
    protocol: "openai-compatible" as const,
    baseUrl: "https://api.example.com/v1",
    models: ["gpt-4o", "gpt-4o-mini"],
    defaultModel: "gpt-4o",
    enabled: true,
  };

  it("returns preferred model when it is enabled", () => {
    expect(resolveEnabledModel(profile, "gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("falls back to default when preferred model is not enabled", () => {
    expect(resolveEnabledModel(profile, "claude-sonnet-4")).toBe("gpt-4o");
  });

  it("falls back to first enabled model when default is missing", () => {
    expect(
      resolveEnabledModel(
        { ...profile, defaultModel: "claude-sonnet-4" },
        "claude-sonnet-4",
      ),
    ).toBe("gpt-4o");
  });
});

describe("getActiveProvider", () => {
  it("normalizes stale active.model to an enabled model", () => {
    const registry: ProviderRegistry = {
      version: 1,
      active: { providerId: "p1", model: "claude-sonnet-4" },
      providers: [
        {
          id: "p1",
          name: "Test",
          protocol: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          models: ["doubao-seed-1-6-250615"],
          defaultModel: "doubao-seed-1-6-250615",
          enabled: true,
        },
      ],
    };
    expect(getActiveProvider(registry).model).toBe("doubao-seed-1-6-250615");
  });
});

describe("getProviderEnabledModels", () => {
  it("uses defaultModel when models list is empty", () => {
    expect(
      getProviderEnabledModels({
        id: "p1",
        name: "Test",
        protocol: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        models: [],
        defaultModel: "custom-endpoint",
        enabled: true,
      }),
    ).toEqual(["custom-endpoint"]);
  });
});
