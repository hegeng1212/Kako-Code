import { describe, expect, it } from "vitest";
import {
  collectUserTextFromMessages,
  formatCurrentMonthYear,
  inferTimeZoneFromUserText,
} from "./user-timezone.js";

describe("inferTimeZoneFromUserText", () => {
  const london = "Europe/London";

  it("uses Asia/Shanghai for Chinese user text", () => {
    expect(inferTimeZoneFromUserText("帮我搜索最新新闻", london)).toBe("Asia/Shanghai");
  });

  it("uses Asia/Tokyo for Japanese script", () => {
    expect(inferTimeZoneFromUserText("最新ニュースを検索", london)).toBe("Asia/Tokyo");
  });

  it("uses Asia/Seoul for Korean script", () => {
    expect(inferTimeZoneFromUserText("최신 뉴스 검색", london)).toBe("Asia/Seoul");
  });

  it("uses system timezone for English user text", () => {
    expect(inferTimeZoneFromUserText("search latest news", london)).toBe(london);
  });

  it("falls back to system timezone for empty text", () => {
    expect(inferTimeZoneFromUserText("", london)).toBe(london);
  });
});

describe("collectUserTextFromMessages", () => {
  it("collects only user role text", () => {
    const text = collectUserTextFromMessages([
      { role: "assistant", content: "Hello" },
      { role: "user", content: "帮我查一下" },
      { role: "user", content: [{ type: "text", text: "今天的天气" }] },
    ]);
    expect(text).toContain("帮我查一下");
    expect(text).toContain("今天的天气");
    expect(text).not.toContain("Hello");
  });
});

describe("formatCurrentMonthYear", () => {
  it("formats month/year in the given timezone", () => {
    const value = formatCurrentMonthYear(
      "Asia/Shanghai",
      "en-US",
      new Date("2026-07-07T04:00:00.000Z"),
    );
    expect(value).toBe("July 2026");
  });
});
