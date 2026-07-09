import { describe, expect, it } from "vitest";
import { decodeBingCkUrl, parseBingHtml } from "./web-search.js";

describe("decodeBingCkUrl", () => {
  it("decodes Bing redirect links", () => {
    const href =
      "https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9wYWdl&ntb=1";
    expect(decodeBingCkUrl(href)).toBe("https://example.com/page");
  });

  it("decodes HTML-escaped redirect links", () => {
    const href =
      "https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1aHR0cHM6Ly9mYXN0LmNvbS8&amp;ntb=1";
    expect(decodeBingCkUrl(href)).toBe("https://fast.com/");
  });
});

describe("parseBingHtml", () => {
  it("parses direct result links", () => {
    const html = `<li class="b_algo"><a href="https://weather.example/beijing"><h2><a href="https://weather.example/beijing">北京天气</a></h2><p class="b_lineclamp2">晴 30C</p></li>`;
    expect(parseBingHtml(html)).toEqual([
      {
        title: "北京天气",
        url: "https://weather.example/beijing",
        snippet: "晴 30C",
      },
    ]);
  });

  it("parses Bing redirect links returned via proxy", () => {
    const html = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1aHR0cHM6Ly9mYXN0LmNvbS8&amp;ntb=1">Internet Speed <strong>Test</strong> | Fast.com</a></h2></li>`;
    expect(parseBingHtml(html)).toEqual([
      {
        title: "Internet Speed Test | Fast.com",
        url: "https://fast.com/",
      },
    ]);
  });
});
