import { describe, expect, it } from "vitest";
import {
  buildSessionTitleMessages,
  parseSessionTitleResponse,
  SESSION_TITLE_SYSTEM_PROMPT,
} from "./title.js";

describe("buildSessionTitleMessages", () => {
  it("wraps user input in session tags", () => {
    const messages = buildSessionTitleMessages("帮我设计一个AI客服产品");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe(SESSION_TITLE_SYSTEM_PROMPT);
    expect(messages[1]?.content).toContain("<session>");
    expect(messages[1]?.content).toContain("帮我设计一个AI客服产品");
    expect(messages[1]?.content).toContain("Write the title in the language");
  });
});

describe("parseSessionTitleResponse", () => {
  it("parses plain JSON", () => {
    expect(parseSessionTitleResponse('{"title": "Design AI customer service"}')).toBe(
      "Design AI customer service",
    );
  });

  it("parses fenced JSON", () => {
    expect(
      parseSessionTitleResponse('```json\n{"title": "设计 AI 客服产品"}\n```'),
    ).toBe("设计 AI 客服产品");
  });

  it("returns null for invalid payloads", () => {
    expect(parseSessionTitleResponse("not json")).toBeNull();
    expect(parseSessionTitleResponse('{"title": ""}')).toBeNull();
    expect(parseSessionTitleResponse('{"title": "I can\'t access that URL"}')).toBe(
      "I can't access that URL",
    );
  });
});
