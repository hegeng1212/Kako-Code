import { describe, expect, it } from "vitest";
import {
  extractMainContent,
  htmlToMarkdown,
  removeBoilerplateBlocks,
} from "./html-to-markdown.js";

describe("htmlToMarkdown", () => {
  it("converts headings and links", () => {
    const md = htmlToMarkdown('<h1>Title</h1><p>Hello <a href="/x">link</a></p>');
    expect(md).toContain("# Title");
    expect(md).toContain("[link](/x)");
    expect(md).toContain("Hello");
  });

  it("strips nav/footer chrome", () => {
    const html =
      "<html><body>" +
      "<nav><a href='/home'>Home</a></nav>" +
      "<article><p>Main article body with enough text to matter for research.</p></article>" +
      "<footer>Copyright 2026</footer>" +
      "</body></html>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("Main article body");
    expect(md).not.toContain("Copyright 2026");
    expect(md).not.toContain("[Home]");
  });

  it("prefers article landmark content", () => {
    const html =
      "<div><p>Sidebar promo text repeated everywhere.</p></div>" +
      "<article><h1>Report</h1><p>" +
      "Detailed findings about market size and growth trends in the sector with supporting data points." +
      "</p></article>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("Detailed findings");
    expect(md).not.toContain("Sidebar promo");
  });
});

describe("removeBoilerplateBlocks", () => {
  it("removes nested aside blocks iteratively", () => {
    const html = "<aside><span>Ads</span></aside><p>Keep</p>";
    expect(removeBoilerplateBlocks(html)).toContain("Keep");
    expect(removeBoilerplateBlocks(html)).not.toContain("Ads");
  });
});

describe("extractMainContent", () => {
  it("returns full html when no substantial landmark exists", () => {
    const html = "<p>Short</p>";
    expect(extractMainContent(html)).toBe(html);
  });
});
