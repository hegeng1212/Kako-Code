import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatCurrentMonthYear, resolveWebSearchTimeZone } from "../../locale/user-timezone.js";
import { resetProxyCacheForTests } from "../../net/proxy-fetch.js";
import * as searchStore from "../../config/search-store.js";
import {
  filterSearchResults,
  formatWebSearchResponse,
  hostnameMatchesDomain,
  parseBingHtml,
  parseWebSearchInput,
  runWebSearchWithRegistry,
} from "../../web/web-search.js";
import { webSearchHandler, webSearchToolDefinition, buildWebSearchDescription } from "./web-search.js";

describe("WebSearch tool definition", () => {
  it("exposes Claude-compatible schema fields", () => {
    const props = webSearchToolDefinition.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(
      ["allowed_domains", "blocked_domains", "query"].sort(),
    );
    expect(webSearchToolDefinition.inputSchema.required).toEqual(["query"]);
    expect(webSearchToolDefinition.inputSchema.additionalProperties).toBe(false);
  });

  it("matches Claude Code description", () => {
    expect(webSearchToolDefinition.description).toContain("Search the web");
    expect(webSearchToolDefinition.description).toContain("US-only");
    expect(webSearchToolDefinition.description).toContain("allowed_domains");
    expect(webSearchToolDefinition.description).toContain("Sources:");
  });

  it("uses user language timezone for current month hint", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T20:00:00.000Z"));

    const zhTz = resolveWebSearchTimeZone("帮我搜索", "Europe/London");
    const enTz = resolveWebSearchTimeZone("search news", "Europe/London");
    expect(zhTz).toBe("Asia/Shanghai");
    expect(enTz).toBe("Europe/London");
    expect(formatCurrentMonthYear(zhTz, "en-US")).toBe("February 2026");
    expect(formatCurrentMonthYear(enTz, "en-US")).toBe("January 2026");
    expect(buildWebSearchDescription("帮我搜索")).toContain("February 2026");

    vi.useRealTimers();
  });
});

describe("parseWebSearchInput", () => {
  it("parses query and domain filters", () => {
    expect(
      parseWebSearchInput({
        query: "kako agent",
        allowed_domains: ["github.com"],
        blocked_domains: ["spam.test"],
      }),
    ).toEqual({
      query: "kako agent",
      allowedDomains: ["github.com"],
      blockedDomains: ["spam.test"],
    });
  });

  it("requires query length >= 2", () => {
    expect(() => parseWebSearchInput({ query: "a" })).toThrow(/at least 2/);
  });
});

describe("filterSearchResults", () => {
  const sample = [
    { title: "GitHub", url: "https://github.com/org/repo" },
    { title: "Docs", url: "https://docs.example.com/page" },
    { title: "Spam", url: "https://spam.test/bad" },
  ];

  it("filters blocked and allowed domains", () => {
    expect(
      filterSearchResults(sample, ["github.com", "docs.example.com"], ["spam.test"]),
    ).toEqual([
      { title: "GitHub", url: "https://github.com/org/repo" },
      { title: "Docs", url: "https://docs.example.com/page" },
    ]);
  });
});

describe("hostnameMatchesDomain", () => {
  it("matches subdomains", () => {
    expect(hostnameMatchesDomain("docs.github.com", "github.com")).toBe(true);
    expect(hostnameMatchesDomain("evil-github.com", "github.com")).toBe(false);
  });
});

describe("parseBingHtml", () => {
  it("extracts organic results from Bing HTML", () => {
    const html = `
      <li class="b_algo">
        <a class="tilk" href="https://www.weather.com.cn/weather/101010100.shtml">
        <h2 class=""><a href="https://www.weather.com.cn/weather/101010100.shtml">北京天气预报</a></h2>
        <div class="b_caption"><p class="b_lineclamp2">9 小时之前 · 北京今日天气</p></div>
      </li>`;
    expect(parseBingHtml(html)).toEqual([
      {
        title: "北京天气预报",
        url: "https://www.weather.com.cn/weather/101010100.shtml",
        snippet: "9 小时之前 · 北京今日天气",
      },
    ]);
  });
});

describe("runWebSearchWithRegistry", () => {
  const prevNoProxy = process.env.KAKO_NO_PROXY;

  beforeEach(() => {
    process.env.KAKO_NO_PROXY = "1";
    resetProxyCacheForTests();
  });

  afterEach(() => {
    if (prevNoProxy === undefined) delete process.env.KAKO_NO_PROXY;
    else process.env.KAKO_NO_PROXY = prevNoProxy;
    resetProxyCacheForTests();
    vi.unstubAllGlobals();
  });

  it("uses Brave when configured first in registry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "Result A",
                  url: "https://example.com/a",
                  description: "Snippet A",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const output = await runWebSearchWithRegistry({ query: "example search" }, [
      { id: "brave", enabled: true, apiKey: "test-brave" },
    ]);
    expect(output).toContain("Result A");
    expect(output).toContain("https://example.com/a");
    const fetchMock = vi.mocked(fetch);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api.search.brave.com");
  });

  it("uses Bing for Chinese queries when enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          `<li class="b_algo"><a href="https://weather.example/beijing"><h2><a href="https://weather.example/beijing">北京天气</a></h2><p class="b_lineclamp2">晴 30C</p></li>`,
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      ),
    );

    const output = await runWebSearchWithRegistry({ query: "北京天气" }, [
      { id: "bing", enabled: true },
    ]);
    expect(output).toContain("北京天气");
    expect(output).toContain("https://weather.example/beijing");
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("cn.bing.com");
  });
});

describe("formatWebSearchResponse", () => {
  it("formats result blocks", () => {
    const text = formatWebSearchResponse({
      query: "test",
      region: "US",
      results: [{ title: "A", url: "https://a.test", snippet: "one" }],
    });
    expect(text).toContain("## Result 1");
    expect(text).toContain("Title: A");
    expect(text).toContain("URL: https://a.test");
  });
});

describe("webSearchHandler", () => {
  const prevNoProxy = process.env.KAKO_NO_PROXY;

  afterEach(() => {
    if (prevNoProxy === undefined) delete process.env.KAKO_NO_PROXY;
    else process.env.KAKO_NO_PROXY = prevNoProxy;
    resetProxyCacheForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns formatted blocks", async () => {
    process.env.KAKO_NO_PROXY = "1";
    vi.spyOn(searchStore, "loadSearchRegistry").mockResolvedValue({
      version: 1,
      providers: [{ id: "brave", enabled: true, apiKey: "test-brave" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            web: {
              results: [{ title: "Hit", url: "https://hit.test" }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const out = await webSearchHandler({ query: "hello world" });
    expect(String(out)).toContain("Hit");
    expect(String(out)).toContain("https://hit.test");
  });
});
