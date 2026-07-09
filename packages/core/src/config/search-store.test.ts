import { describe, expect, it } from "vitest";
import { isSearchProviderReady, normalizeSearchRegistry, searchProviderReadyError } from "./search-store.js";

describe("normalizeSearchRegistry", () => {
  it("orders providers by preset list and merges env keys", () => {
    const prev = process.env.BRAVE_SEARCH_API_KEY;
    process.env.BRAVE_SEARCH_API_KEY = "env-brave-key";

    const normalized = normalizeSearchRegistry({
      version: 1,
      providers: [
        { id: "bing", enabled: false },
        { id: "doubao", enabled: true, apiKey: "dk" },
      ],
    });

    expect(normalized.providers.map((p) => p.id)).toEqual([
      "doubao",
      "brave",
      "serpapi",
      "bing",
      "duckduckgo",
    ]);
    expect(normalized.providers.find((p) => p.id === "brave")?.apiKey).toBe("env-brave-key");
    expect(normalized.providers.find((p) => p.id === "doubao")?.apiKey).toBe("dk");

    if (prev === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = prev;
  });

  it("treats Bing and DuckDuckGo as ready without API key when enabled", () => {
    expect(isSearchProviderReady({ id: "bing", enabled: true })).toBe(true);
    expect(isSearchProviderReady({ id: "duckduckgo", enabled: true })).toBe(true);
    expect(searchProviderReadyError({ id: "bing", enabled: true })).toBeNull();
    expect(searchProviderReadyError({ id: "brave", enabled: true })).toMatch(/API Key/);
  });
});
