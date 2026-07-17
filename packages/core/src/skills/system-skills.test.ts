import { describe, expect, it } from "vitest";
import {
  SYSTEM_SKILL_REGISTRY,
  getSystemSkillEntry,
  isDefaultSkillWithHandler,
  isSlashOnlySystemSkill,
  isSystemSkill,
  loadSlashOnlyCatalogSkills,
  loadSystemSkills,
  mergeSkillsForAgent,
  skillNamesForToolAllowlist,
} from "./system-skills.js";

describe("system skills", () => {
  it("registers plan, auto, manual, workflows, deep-research, and init", () => {
    expect(SYSTEM_SKILL_REGISTRY.map((entry) => entry.name)).toEqual([
      "plan",
      "auto",
      "manual",
      "workflows",
      "deep-research",
      "init",
    ]);
  });

  it("marks plan as slash-only; workflows is agent-readable", () => {
    expect(isSlashOnlySystemSkill("plan")).toBe(true);
    expect(isSlashOnlySystemSkill("workflows")).toBe(false);
    expect(isSlashOnlySystemSkill("init")).toBe(false);
    expect(getSystemSkillEntry("init")?.handler).toBe("skill");
  });

  it("default skills with handlers are distinct from file-only user skills", () => {
    expect(isDefaultSkillWithHandler("deep-research")).toBe(true);
    expect(isDefaultSkillWithHandler("init")).toBe(true);
    expect(isDefaultSkillWithHandler("workflows")).toBe(true);
    expect(isDefaultSkillWithHandler("plan")).toBe(false);
    expect(isDefaultSkillWithHandler("code-review")).toBe(false);
  });

  it("loads slash catalog with plan, auto, manual, and workflows", async () => {
    const skills = await loadSlashOnlyCatalogSkills();
    expect(skills.map((skill) => skill.name)).toEqual([
      "plan",
      "auto",
      "manual",
      "workflows",
    ]);
    expect(skills.every((skill) => skill.description.trim().length > 0)).toBe(true);
    expect(skills.every((skill) => skill.instructions === "" && skill.skillMdPath === "")).toBe(
      true,
    );
  });

  it("lists /clear in slash autocomplete menu", async () => {
    const { listSlashInvokableSkills } = await import("./system-skills.js");
    const skills = await listSlashInvokableSkills(process.cwd());
    expect(skills.some((s) => s.name === "clear")).toBe(true);
    expect(skills.find((s) => s.name === "clear")?.description).toMatch(/context/i);
  });

  it("loads workflows as agent-readable with no SKILL.md (no context pivot)", async () => {
    const skills = await loadSystemSkills();
    const workflows = skills.find((skill) => skill.name === "workflows");
    expect(workflows).toBeDefined();
    expect(workflows!.skillMdPath).toBe("");
    expect(workflows!.instructions).toBe("");
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

  it("never merges slash-only skills into agent skill lists", () => {
    const merged = mergeSkillsForAgent(
      [],
      [],
      [
        {
          name: "plan",
          description: "slash only",
          path: "",
          skillMdPath: "",
          instructions: "",
        },
        {
          name: "init",
          description: "Init",
          path: "/init",
          skillMdPath: "/init/SKILL.md",
          instructions: "",
        },
      ],
    );
    expect(merged.map((s) => s.name)).toEqual(["init"]);
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
