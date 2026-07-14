import { describe, expect, it } from "vitest";
import {
  SYSTEM_SKILL_REGISTRY,
  getSystemSkillEntry,
  isSlashOnlySystemSkill,
  isSystemSkill,
  loadSlashOnlyCatalogSkills,
  mergeSkillsForAgent,
  skillNamesForToolAllowlist,
} from "./system-skills.js";

describe("system skills", () => {
  it("registers plan, workflows, deep-research, and init", () => {
    expect(SYSTEM_SKILL_REGISTRY.map((entry) => entry.name)).toEqual([
      "plan",
      "workflows",
      "deep-research",
      "init",
    ]);
  });

  it("marks plan and workflows as slash-only", () => {
    expect(isSlashOnlySystemSkill("plan")).toBe(true);
    expect(isSlashOnlySystemSkill("workflows")).toBe(true);
    expect(isSlashOnlySystemSkill("init")).toBe(false);
    expect(getSystemSkillEntry("init")?.handler).toBe("skill");
  });

  it("loads slash-only catalog from registry without skill files", async () => {
    const skills = await loadSlashOnlyCatalogSkills();
    expect(skills.map((skill) => skill.name)).toEqual(["plan", "workflows"]);
    expect(skills.every((skill) => skill.description.trim().length > 0)).toBe(true);
    expect(skills.every((skill) => skill.instructions === "" && skill.skillMdPath === "")).toBe(
      true,
    );
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

  it("includes init in agent skill merge", () => {
    const merged = mergeSkillsForAgent(
      [],
      [],
      [
        {
          name: "init",
          description: "Initialize a new KAKO.md file with codebase documentation",
          path: "/init",
          skillMdPath: "/init/SKILL.md",
          instructions: "",
        },
      ],
    );
    expect(merged.map((skill) => skill.name)).toEqual(["init"]);
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
