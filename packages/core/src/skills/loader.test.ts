import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverSkills,
  discoverSkillsForAgent,
  filterSkillsForAgent,
  formatSkillsIndex,
  parseSkillMd,
  skillIndexDescription,
  skillNameCandidates,
} from "./loader.js";
import { withTempDir } from "../tools/builtin/test-helpers.js";

describe("parseSkillMd", () => {
  it("parses frontmatter and body", () => {
    const skill = parseSkillMd(
      "---\nname: demo\ndescription: A demo skill\n---\n\n# Instructions\n\nStep 1",
      "/tmp/skills/demo/SKILL.md",
    );
    expect(skill.name).toBe("demo");
    expect(skill.description).toBe("A demo skill");
    expect(skill.instructions).toContain("Step 1");
  });
});

describe("skillNameCandidates", () => {
  it("maps plugin:skill to plugin/skill", () => {
    expect(skillNameCandidates("apps/web:deploy")).toEqual(["apps/web:deploy", "apps/web/deploy"]);
  });
});

describe("discoverSkills", () => {
  it("finds project-local skills", async () => {
    await withTempDir(async (cwd) => {
      const skillDir = join(cwd, ".kako", "skills", "local-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        "---\nname: local-skill\ndescription: Local\n---\n\nRun locally.",
        "utf-8",
      );
      const skills = await discoverSkills(cwd);
      expect(skills.some((s) => s.name === "local-skill")).toBe(true);
    });
  });

  it("excludes disabled manifest skills", async () => {
    await withTempDir(async (cwd) => {
      process.env.KAKO_HOME = join(cwd, ".kako-home");
      const skillDir = join(cwd, ".kako-home", "skills", "off-skill");
      await mkdir(join(cwd, ".kako-home", "config"), { recursive: true });
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        "---\nname: off-skill\ndescription: Off\n---\n\nHidden.",
        "utf-8",
      );
      const { saveSkillsManifest } = await import("./manifest.js");
      await saveSkillsManifest({
        skills: [
          {
            name: "off-skill",
            description: "Off",
            source: "local",
            installDir: skillDir,
            skillMdPath: join(skillDir, "SKILL.md"),
            installedAt: new Date().toISOString(),
            enabled: false,
          },
        ],
      });
      const skills = await discoverSkills(cwd);
      expect(skills.some((s) => s.name === "off-skill")).toBe(false);
    });
  });
});

describe("filterSkillsForAgent", () => {
  it("restricts to agent-bound skills", () => {
    const filtered = filterSkillsForAgent(
      [
        { name: "a", description: "", path: "/a", skillMdPath: "/a/SKILL.md", instructions: "" },
        { name: "b", description: "", path: "/b", skillMdPath: "/b/SKILL.md", instructions: "" },
      ],
      ["a"],
    );
    expect(filtered.map((s) => s.name)).toEqual(["a"]);
  });

  it("returns none when agent has no skills whitelist", () => {
    expect(filterSkillsForAgent([{ name: "a", description: "", path: "/a", skillMdPath: "/a/SKILL.md", instructions: "" }], undefined)).toEqual([]);
    expect(filterSkillsForAgent([{ name: "a", description: "", path: "/a", skillMdPath: "/a/SKILL.md", instructions: "" }], [])).toEqual([]);
  });
});

describe("discoverSkillsForAgent", () => {
  it("includes enabled user skills outside agents/main.yaml whitelist", async () => {
    await withTempDir(async (cwd) => {
      process.env.KAKO_HOME = join(cwd, ".kako-home");
      const skillDir = join(cwd, ".kako-home", "skills", "guizang-ppt");
      await mkdir(join(cwd, ".kako-home", "config"), { recursive: true });
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        "---\nname: guizang-ppt\ndescription: Build HTML slide decks\n---\n\nRun.",
        "utf-8",
      );
      const { saveSkillsManifest } = await import("./manifest.js");
      await saveSkillsManifest({
        skills: [
          {
            name: "guizang-ppt",
            description: "Build HTML slide decks",
            source: "github",
            installDir: skillDir,
            skillMdPath: join(skillDir, "SKILL.md"),
            installedAt: new Date().toISOString(),
            enabled: true,
          },
        ],
      });
      const skills = await discoverSkillsForAgent(cwd);
      expect(skills.some((skill) => skill.name === "guizang-ppt")).toBe(true);
    });
  });
});

describe("skillIndexDescription", () => {
  it("uses frontmatter description only, not SKILL.md body", () => {
    const text = skillIndexDescription({
      name: "deep-research",
      description:
        "Deep research harness — fan-out web searches. - When the user wants a deep, multi-source report.",
      path: "/deep-research",
      skillMdPath: "/deep-research/SKILL.md",
      instructions:
        "# Deep research\n\nUse when the user wants a deep report.\n\n## Workflow\n\nLong workflow steps that must not appear in the index.",
    });
    expect(text).toContain("Deep research harness");
    expect(text).toContain("When the user wants a deep, multi-source report");
    expect(text).not.toContain("Workflow");
    expect(text).not.toContain("Long workflow steps");
  });

  it("falls back when frontmatter description is empty", () => {
    expect(
      skillIndexDescription({
        name: "demo",
        description: "",
        path: "/demo",
        skillMdPath: "/demo/SKILL.md",
        instructions: "Use when the user asks for a slide deck.",
      }),
    ).toBe("Use when this skill matches the user's request.");
  });
});

describe("formatSkillsIndex", () => {
  it("lists skills in Claude Code-style Skill tool catalog", () => {
    const text = formatSkillsIndex([
      {
        name: "brainstorming",
        description:
          "Explores approaches and design before implementation — Follow this skill when the user wants to design or refine something and requirements are not yet concrete.",
        path: "/x",
        skillMdPath: "/x/SKILL.md",
      },
    ]);
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("The following skills are available for use with the Skill tool:");
    expect(text).toContain("- brainstorming: Explores approaches and design");
    expect(text).toContain("requirements are not yet concrete");
  });
});
