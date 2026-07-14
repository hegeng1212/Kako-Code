import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import {
  assertSkillAllowed,
  buildInitSkillActivatedMessages,
  buildSkillActivatedMessages,
  formatActiveSkillReminder,
  formatSkillActivationResult,
  formatSkillToolResult,
  parseSkillInput,
  skillHandler,
  skillToolDefinition,
} from "./skill.js";
import { toolContext, withTempDir } from "./test-helpers.js";

async function seedSkill(cwd: string, name: string, body: string): Promise<void> {
  const skillDir = join(cwd, ".kako", "skills", name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill\n---\n\n${body}`,
    "utf-8",
  );
}

describe("Skill tool definition", () => {
  it("matches Claude-compatible schema", () => {
    const props = skillToolDefinition.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(["args", "skill"].sort());
    expect(skillToolDefinition.inputSchema.required).toEqual(["skill"]);
    expect(skillToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(skillToolDefinition.description).toContain("slash command");
    expect(skillToolDefinition.description).toContain("BLOCKING REQUIREMENT");
    expect(skillToolDefinition.description).toContain("<command-name>");
    expect(skillToolDefinition.description).not.toContain("available_skills");
  });

  it("uses Claude Code parameter descriptions", () => {
    expect(skillToolDefinition.inputSchema.properties?.skill?.description).toContain(
      "available-skills",
    );
    expect(skillToolDefinition.inputSchema.properties?.args?.description).toContain("Optional");
  });
});

describe("parseSkillInput", () => {
  it("accepts skill field", () => {
    expect(parseSkillInput({ skill: "demo" }).skill).toBe("demo");
  });

  it("accepts legacy command alias", () => {
    expect(parseSkillInput({ command: "demo" }).skill).toBe("demo");
  });

  it("parses optional args", () => {
    expect(parseSkillInput({ skill: "demo", args: "extra" }).args).toBe("extra");
  });

  it("rejects leading slash", () => {
    expect(() => parseSkillInput({ skill: "/brainstorming" })).toThrow(/leading slash/);
  });
});

describe("skillHandler", () => {
  it("returns activation log without inlining instructions", async () => {
    await withTempDir(async (cwd) => {
      await seedSkill(cwd, "demo-skill", "Follow these steps.");
      const out = await skillHandler(
        { skill: "demo-skill", args: "extra context" },
        toolContext(cwd, { allowedSkills: ["demo-skill"] }),
      );
      const text = String(out);
      expect(text).toContain('Skill "demo-skill" activated');
      expect(text).toContain("system-reminder");
      expect(text).not.toContain("extra context");
      expect(text).not.toContain("Follow these steps.");
      expect(text).not.toContain("<command-demo-skill>");
    });
  });

  it("rejects unknown skills", async () => {
    await withTempDir(async (cwd) => {
      await expect(
        skillHandler({ skill: "missing" }, toolContext(cwd, { allowedSkills: ["missing"] })),
      ).rejects.toThrow(/Unknown skill/);
    });
  });

  it("activates init skill for Claude-style pivot", async () => {
    await withTempDir(async (cwd) => {
      const result = await skillHandler({ skill: "init" }, toolContext(cwd, { allowedSkills: ["init"] }));
      expect(result).toBe("Launching skill: init");
    });
  });

  it("rejects slash-only skills", async () => {
    await withTempDir(async (cwd) => {
      await expect(
        skillHandler({ skill: "workflows" }, toolContext(cwd, { allowedSkills: ["workflows"] })),
      ).rejects.toThrow(/only available as a slash command/);
    });
  });

  it("rejects skills not bound to agent", async () => {
    await withTempDir(async (cwd) => {
      await seedSkill(cwd, "secret", "hidden");
      await expect(
        skillHandler({ skill: "secret" }, toolContext(cwd, { allowedSkills: ["other"] })),
      ).rejects.toThrow(/not available/);
    });
  });
});

describe("assertSkillAllowed adversarial", () => {
  it("blocks unlisted skill names", () => {
    expect(() => assertSkillAllowed("x", ["y"])).toThrow(/not available/);
  });
});

describe("buildInitSkillActivatedMessages", () => {
  it("injects init core prompt as a follow-up user message", () => {
    const messages = buildInitSkillActivatedMessages({
      systemPromptBase: "You are helpful.",
      transcript: [{ role: "user", content: "init" }],
      workspaceKakoMd: "Team uses Kako.",
      now: new Date("2026-07-13T12:00:00"),
    });
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    expect(String(messages[2]?.content)).toContain("create a KAKO.md file");
    expect(String(messages[2]?.content)).not.toContain("<command-message>");
  });
});

describe("formatSkillActivationResult", () => {
  it("notes harness loaded skill into system-reminder", () => {
    const text = formatSkillActivationResult("demo", "/path/demo/SKILL.md");
    expect(text).toContain("system-reminder");
    expect(text).toContain("/path/demo/SKILL.md");
  });
});

describe("formatActiveSkillReminder", () => {
  it("wraps full skill instructions", () => {
    const text = formatActiveSkillReminder("prd-writer", "# Write PRD\n\nStep 1.");
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("Active skill: **prd-writer**");
    expect(text).toContain("Write PRD");
  });
});

describe("buildSkillActivatedMessages", () => {
  it("places skill in system-reminder and wraps args as user message", () => {
    const now = new Date("2026-07-06T10:00:00");
    const messages = buildSkillActivatedMessages({
      systemPromptBase: "You are helpful.",
      transcript: [
        { role: "user", content: "帮我写 PRD" },
        { role: "assistant", content: "好的，我来选技能。" },
      ],
      skillName: "prd-writer",
      skillInstructions: "# PRD skill\n\nFollow this.",
      skillArgs: "设计一个AI客服产品",
      workspaceKakoMd: "Use formal Chinese.",
      now,
    });

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Active skill: **prd-writer**");
    expect(messages[0].content).toContain("PRD skill");
    expect(messages).toHaveLength(4);
    expect(messages[1]?.content).toContain("<system-reminder>");
    expect(messages[1]?.content).toContain("帮我写 PRD");
    expect(messages[3]?.content).toContain("设计一个AI客服产品");
    expect(messages[3]?.content).toContain("Use formal Chinese.");
  });
});

describe("formatSkillToolResult", () => {
  it("omits args section when empty", () => {
    expect(formatSkillToolResult("demo", "body")).not.toContain("Skill arguments");
  });
});

describe("Skill via ToolRegistry", () => {
  it("prevents activating the same skill twice in one turn", async () => {
    await withTempDir(async (cwd) => {
      await seedSkill(cwd, "repeat-skill", "Once only.");
      const registry = new ToolRegistry({
        cwd,
        sessionId: "sess-skill",
        agentId: "agent-main",
        allowedSkills: ["repeat-skill"],
      });
      registry.register(skillToolDefinition, skillHandler);

      const first = await registry.execute({
        id: "tu-1",
        name: "Skill",
        input: { skill: "repeat-skill" },
      });
      expect(first.status).toBe("success");

      const second = await registry.execute({
        id: "tu-2",
        name: "Skill",
        input: { skill: "repeat-skill" },
      });
      expect(second.status).toBe("error");
      expect(second.error).toContain("already active");
    });
  });
});
