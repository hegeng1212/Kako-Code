import { describe, expect, it } from "vitest";
import {
  SYSTEM_SKILL_REGISTRY,
  isSystemSkill,
  mergeSkillsForAgent,
  skillNamesForToolAllowlist,
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

  it("builds tool allowlist from discovered skills", () => {
    expect(
      skillNamesForToolAllowlist([
        {
          name: "brainstorming",
          description: "",
          path: "/brainstorming",
          skillMdPath: "/brainstorming/SKILL.md",
          instructions: "",
        },
        {
          name: "guizang-ppt",
          description: "",
          path: "/guizang-ppt",
          skillMdPath: "/guizang-ppt/SKILL.md",
          instructions: "",
        },
      ]),
    ).toEqual(["brainstorming", "guizang-ppt"]);
  });

  it("merges bundled, user, and system skills into the agent skill index", () => {
    const merged = mergeSkillsForAgent(
      [
        {
          name: "guizang-ppt",
          description: "Imported PPT skill",
          path: "/guizang-ppt",
          skillMdPath: "/guizang-ppt/SKILL.md",
          instructions: "",
        },
      ],
      [
        {
          name: "brainstorming",
          description: "Brainstorm",
          path: "/brainstorming",
          skillMdPath: "/brainstorming/SKILL.md",
          instructions: "",
        },
      ],
      [
        {
          name: "init",
          description: "Init KAKO.md",
          path: "/init",
          skillMdPath: "/init/SKILL.md",
          instructions: "",
        },
        {
          name: "deep-research",
          description: "Deep research harness",
          path: "/deep-research",
          skillMdPath: "/deep-research/SKILL.md",
          instructions: "",
        },
      ],
    );
    expect(merged.map((skill) => skill.name)).toEqual([
      "brainstorming",
      "deep-research",
      "guizang-ppt",
      "init",
    ]);
    expect(merged.find((skill) => skill.name === "deep-research")?.description).toBe(
      "Deep research harness",
    );
  });
});
