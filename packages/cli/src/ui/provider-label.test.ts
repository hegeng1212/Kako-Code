import { describe, expect, it } from "vitest";
import type { ProviderProfile } from "@kako/shared";
import { getProviderModelLabel } from "@kako/shared";

const baseProfile: ProviderProfile = {
  id: "doubao",
  name: "火山引擎豆包",
  protocol: "openai-compatible",
  baseUrl: "https://example.com",
  apiKey: "key",
  models: ["ep-20260604144645-4hlh5"],
  defaultModel: "ep-20260604144645-4hlh5",
  enabled: true,
};

describe("getProviderModelLabel", () => {
  it("shows alias when set", () => {
    expect(
      getProviderModelLabel(
        { ...baseProfile, modelAlias: "豆包 Pro" },
        "ep-20260604144645-4hlh5",
      ),
    ).toBe("豆包 Pro");
  });

  it("shows active endpoint when alias is missing", () => {
    expect(
      getProviderModelLabel(baseProfile, "ep-20260604144645-4hlh5"),
    ).toBe("ep-20260604144645-4hlh5");
  });

  it("never includes provider name", () => {
    const label = getProviderModelLabel(baseProfile, "ep-20260604144645-4hlh5");
    expect(label).not.toContain("火山引擎");
    expect(label).not.toContain("豆包 ·");
  });
});
