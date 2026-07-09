import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWebFetchCache } from "../../web/fetch-cache.js";
import { htmlToMarkdown } from "../../web/html-to-markdown.js";
import {
  fetchWebPage,
  normalizeWebFetchUrl,
  parseWebFetchInput,
  runWebFetch,
} from "../../web/web-fetch.js";
import { webFetchHandler, webFetchToolDefinition } from "./web-fetch.js";
import { fetchWithTimeout } from "../../net/fetch-with-timeout.js";

vi.mock("../../net/fetch-with-timeout.js", () => ({
  fetchWithTimeout: vi.fn((url: string, init?: RequestInit) => globalThis.fetch(url, init)),
}));

describe("WebFetch tool definition", () => {
  it("exposes Claude-compatible schema fields", () => {
    const props = webFetchToolDefinition.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(["prompt", "url"].sort());
    expect(webFetchToolDefinition.inputSchema.required).toEqual(["url", "prompt"]);
    expect(webFetchToolDefinition.inputSchema.additionalProperties).toBe(false);
  });

  it("matches Claude Code description", () => {
    expect(webFetchToolDefinition.description).toContain("converts the page to markdown");
    expect(webFetchToolDefinition.description).toContain("authenticated/private URLs");
    expect(webFetchToolDefinition.description).toContain("15 minutes");
    expect(webFetchToolDefinition.description).toContain("Cross-host redirects");
  });
});

describe("parseWebFetchInput", () => {
  it("requires url and prompt", () => {
    expect(parseWebFetchInput({ url: "https://example.com", prompt: "summary" })).toEqual({
      url: "https://example.com",
      prompt: "summary",
    });
    expect(() => parseWebFetchInput({ url: "https://example.com", prompt: "  " })).toThrow(/prompt/);
    expect(() => parseWebFetchInput({ url: "  ", prompt: "x" })).toThrow(/url/);
  });
});

describe("normalizeWebFetchUrl", () => {
  it("upgrades http to https", () => {
    expect(normalizeWebFetchUrl("http://example.com/path")).toBe("https://example.com/path");
  });
});

describe("htmlToMarkdown", () => {
  it("converts headings and links", () => {
    const md = htmlToMarkdown('<h1>Title</h1><p>Hello <a href="/x">link</a></p>');
    expect(md).toContain("# Title");
    expect(md).toContain("[link](/x)");
    expect(md).toContain("Hello");
  });
});

describe("fetchWebPage", () => {
  afterEach(() => {
    resetWebFetchCache();
    vi.unstubAllGlobals();
    vi.mocked(fetchWithTimeout).mockImplementation((url: string, init?: RequestInit) =>
      globalThis.fetch(url, init),
    );
  });

  it("returns cross-host redirect instead of following", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example/doc" },
        }),
      ),
    );

    const result = await fetchWebPage("https://example.com/start");
    expect(result).toEqual({
      type: "cross_host_redirect",
      originalUrl: "https://example.com/start",
      redirectUrl: "https://other.example/doc",
    });
  });

  it("surfaces HTTP timeout as a clear error", async () => {
    vi.mocked(fetchWithTimeout).mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    await expect(fetchWebPage("https://slow.example/page")).rejects.toThrow(/timed out after 20s/);
  });

  it("caches successful fetches for 15 minutes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body><p>Cached page</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    const first = await fetchWebPage("https://example.com/page");
    const second = await fetchWebPage("https://example.com/page");
    expect(first.type).toBe("content");
    expect(second.type).toBe("content");
    if (first.type === "content" && second.type === "content") {
      expect(first.fromCache).toBe(false);
      expect(second.fromCache).toBe(true);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("runWebFetch", () => {
  afterEach(() => {
    resetWebFetchCache();
    vi.unstubAllGlobals();
    vi.mocked(fetchWithTimeout).mockImplementation((url: string, init?: RequestInit) =>
      globalThis.fetch(url, init),
    );
  });

  it("answers prompt with injected router", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body><p>Kako is an agent runtime.</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    const answer = await runWebFetch(
      { url: "https://example.com", prompt: "What is this page about?" },
      {
        complete: vi.fn().mockResolvedValue({
          content: "It describes Kako.",
          finishReason: "stop",
        }),
        stream: async function* () {},
      },
    );

    expect(answer).toBe("It describes Kako.");
  });
});

describe("webFetchHandler", () => {
  afterEach(() => {
    resetWebFetchCache();
    vi.unstubAllGlobals();
    vi.mocked(fetchWithTimeout).mockImplementation((url: string, init?: RequestInit) =>
      globalThis.fetch(url, init),
    );
  });

  it("returns redirect guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/doc" },
        }),
      ),
    );

    const out = await webFetchHandler({
      url: "https://example.com",
      prompt: "summarize",
    });
    expect(String(out)).toContain("Cross-host redirect");
    expect(String(out)).toContain("https://cdn.example.com/doc");
  });
});
