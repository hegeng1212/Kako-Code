import { describe, expect, it } from "vitest";
import { buildDoubaoPayload, parseDoubaoResults } from "./doubao.js";

describe("buildDoubaoPayload", () => {
  it("builds web search payload with defaults", () => {
    expect(
      buildDoubaoPayload("北京天气", {
        id: "doubao",
        enabled: true,
        apiKey: "k",
      }),
    ).toEqual({
      Query: "北京天气",
      SearchType: "web",
      Count: 10,
      NeedSummary: true,
    });
  });

  it("includes auth filter when authLevel is 1", () => {
    expect(
      buildDoubaoPayload("news", {
        id: "doubao",
        enabled: true,
        apiKey: "k",
        authLevel: 1,
      }).Filter,
    ).toEqual({ AuthInfoLevel: 1 });
  });
});

describe("parseDoubaoResults", () => {
  it("parses top-level Results array", () => {
    expect(
      parseDoubaoResults({
        Results: [
          { Title: "A", Url: "https://a.test", Snippet: "one" },
        ],
      }),
    ).toEqual([{ title: "A", url: "https://a.test", snippet: "one" }]);
  });

  it("parses Custom API Result.WebResults envelope", () => {
    expect(
      parseDoubaoResults({
        ResponseMetadata: { RequestId: "req-1" },
        Result: {
          ResultCount: 1,
          WebResults: [
            { Title: "母婴报告", Url: "https://example.com/report", Snippet: "summary" },
          ],
        },
      }),
    ).toEqual([
      { title: "母婴报告", url: "https://example.com/report", snippet: "summary" },
    ]);
  });
});
