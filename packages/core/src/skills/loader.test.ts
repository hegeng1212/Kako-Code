import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverSkills,
  filterSkillsForAgent,
  formatSkillsIndex,
  parseSkillMd,
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

describe("formatSkillsIndex", () => {
  it("lists skills in Claude Code-style Skill tool catalog", () => {
    const text = formatSkillsIndex([
      {
        name: "brainstorming",
        description: "Use before creative work",
        path: "/x",
        skillMdPath: "/x/SKILL.md",
      },
    ]);
    expect(text).toContain("The following skills are available for use with the Skill tool:");
    expect(text).toContain("- brainstorming: Use before creative work");
    expect(text).not.toContain("<system-reminder>");
  });
});
