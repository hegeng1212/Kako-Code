import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWebFetchCache } from "../web/fetch-cache.js";
import { resetWebSearchCache } from "../web/search-cache.js";
import { createWorkflowWebFetchHandler, createWorkflowWebSearchHandler } from "./workflow-tools.js";
import { fetchWithTimeout } from "../net/fetch-with-timeout.js";

vi.mock("../net/fetch-with-timeout.js", () => ({
  fetchWithTimeout: vi.fn((url: string, init?: RequestInit) => globalThis.fetch(url, init)),
}));

vi.mock("../web/web-search.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../web/web-search.js")>();
  return {
    ...actual,
    runWebSearch: vi.fn().mockResolvedValue("Search results for cached query"),
  };
});

describe("workflow tool handlers", () => {
  afterEach(() => {
    resetWebFetchCache();
    resetWebSearchCache();
    vi.unstubAllGlobals();
    vi.mocked(fetchWithTimeout).mockImplementation((url: string, init?: RequestInit) =>
      globalThis.fetch(url, init),
    );
  });

  it("WebFetch handler returns markdown not LLM summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body><p>Workflow markdown body</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    const out = await createWorkflowWebFetchHandler()({
      url: "https://example.com/doc",
      prompt: "extract claims",
    });
    expect(String(out)).toContain("Workflow markdown body");
  });

  it("WebSearch handler caches identical queries per session", async () => {
    const { runWebSearch } = await import("../web/web-search.js");
    const handler = createWorkflowWebSearchHandler("wf-session-1");

    const first = await handler({ query: "duplicate query test" });
    const second = await handler({ query: "duplicate query test" });

    expect(first).toBe(second);
    expect(runWebSearch).toHaveBeenCalledTimes(1);
  });
});
