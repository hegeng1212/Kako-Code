import { describe, expect, it } from "vitest";
import { getCachedWebSearch, resetWebSearchCache, setCachedWebSearch, webSearchCacheKey } from "./search-cache.js";

describe("web search cache", () => {
  it("stores and retrieves by session + query", () => {
    resetWebSearchCache();
    const input = { query: "market size 2026" };
    expect(getCachedWebSearch("s1", input)).toBeUndefined();
    setCachedWebSearch("s1", input, "results block");
    expect(getCachedWebSearch("s1", input)).toBe("results block");
    expect(getCachedWebSearch("s2", input)).toBeUndefined();
  });

  it("normalizes query case in cache key", () => {
    resetWebSearchCache();
    const a = { query: "Foo Bar" };
    const b = { query: "foo bar" };
    expect(webSearchCacheKey(a)).toBe(webSearchCacheKey(b));
  });

  it("isolates domain filters in cache key", () => {
    const base = { query: "test" };
    const filtered = { query: "test", allowedDomains: ["example.com"] };
    expect(webSearchCacheKey(base)).not.toBe(webSearchCacheKey(filtered));
  });
});
