import { describe, expect, it } from "vitest";
import {
  appendSkillAuthoringLanguageGuidance,
  formatSkillAuthoringLocaleHint,
  inferUserAuthoringLanguage,
  SKILL_MCP_PARAM_DOC_RULES,
} from "./skill-authoring.js";

describe("inferUserAuthoringLanguage", () => {
  it("detects Chinese from user messages", () => {
    expect(inferUserAuthoringLanguage("帮我做一个宝宝生长记录技能")).toBe("zh");
  });

  it("detects English from user messages", () => {
    expect(inferUserAuthoringLanguage("Create a baby growth tracking skill")).toBe("en");
  });

  it("uses user role only in message arrays", () => {
    expect(
      inferUserAuthoringLanguage([
        { role: "assistant", content: "Hello" },
        { role: "user", content: "记录宝宝身高体重" },
      ]),
    ).toBe("zh");
  });
});

describe("formatSkillAuthoringLocaleHint", () => {
  it("asks for Chinese body text when user writes Chinese", () => {
    expect(formatSkillAuthoringLocaleHint("宝宝生长")).toContain("Chinese");
  });
});

describe("appendSkillAuthoringLanguageGuidance", () => {
  it("includes language rules and locale hint", () => {
    const text = appendSkillAuthoringLanguageGuidance("Base instructions", "宝宝技能");
    expect(text).toContain("Language rules");
    expect(text).toContain("Chinese");
  });

  it("includes MCP param documentation rules", () => {
    const text = appendSkillAuthoringLanguageGuidance("Base", "宝宝技能");
    expect(text).toContain(SKILL_MCP_PARAM_DOC_RULES);
    expect(text).toContain("必填");
  });
});
