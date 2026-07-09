import { describe, expect, it } from "vitest";
import { collectSkillDirEntries, skillDirPrefixFromMdPath } from "./archive.js";

describe("skillDirPrefixFromMdPath", () => {
  it("returns empty prefix for root SKILL.md", () => {
    expect(skillDirPrefixFromMdPath("SKILL.md")).toBe("");
  });

  it("returns directory prefix for nested SKILL.md", () => {
    expect(skillDirPrefixFromMdPath("skills/brainstorming/SKILL.md")).toBe("skills/brainstorming");
  });
});

describe("collectSkillDirEntries", () => {
  const enc = (text: string) => new TextEncoder().encode(text);

  it("collects all files under a skill directory", () => {
    const entries = {
      "skills/brainstorming/SKILL.md": enc("# skill"),
      "skills/brainstorming/scripts/run.sh": enc("#!/bin/sh"),
      "skills/brainstorming/spec.md": enc("spec"),
      "skills/other/SKILL.md": enc("other"),
    };
    const files = collectSkillDirEntries(entries, "skills/brainstorming");
    expect(Object.keys(files).sort()).toEqual([
      "SKILL.md",
      "scripts/run.sh",
      "spec.md",
    ]);
    expect(new TextDecoder().decode(files["scripts/run.sh"]!)).toBe("#!/bin/sh");
  });

  it("collects entire archive for root skill", () => {
    const entries = {
      "SKILL.md": enc("# root"),
      "templates/slide.html": enc("<html></html>"),
      "scripts/build.mjs": enc("export {}"),
    };
    const files = collectSkillDirEntries(entries, "");
    expect(Object.keys(files).sort()).toEqual([
      "SKILL.md",
      "scripts/build.mjs",
      "templates/slide.html",
    ]);
  });
});
