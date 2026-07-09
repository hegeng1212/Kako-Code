import { describe, expect, it } from "vitest";
import {
  SYSTEM_SKILL_REGISTRY,
  expandAllowedSkillNames,
  isSystemSkill,
  mergeSkillsForAgent,
} from "./system-skills.js";

describe("system skills", () => {
  it("registers workflows, deep-research, and init", () => {
    expect(SYSTEM_SKILL_REGISTRY.map((entry) => entry.name)).toEqual([
      "workflows",
      "deep-research",
      "init",
    ]);
  });

  it("identifies system skills", () => {
    expect(isSystemSkill("init")).toBe(true);
    expect(isSystemSkill("brainstorming")).toBe(false);
  });

  it("expands allowed skill names for the agent", () => {
    expect(expandAllowedSkillNames(["brainstorming"])).toEqual([
      "brainstorming",
      "deep-research",
      "init",
    ]);
    expect(expandAllowedSkillNames(["brainstorming"])).not.toContain("workflows");
  });

  it("merges system skills into the agent skill index", () => {
    const merged = mergeSkillsForAgent(
      [
        {
          name: "brainstorming",
          description: "Brainstorm",
          path: "/brainstorming",
          skillMdPath: "/brainstorming/SKILL.md",
          instructions: "",
        },
      ],
      ["brainstorming"],
      [
        {
          name: "init",
          description: "Init KAKO.md",
          path: "/init",
          skillMdPath: "/init/SKILL.md",
          instructions: "",
        },
      ],
    );
    expect(merged.map((skill) => skill.name)).toEqual(["brainstorming", "init"]);
  });
});
