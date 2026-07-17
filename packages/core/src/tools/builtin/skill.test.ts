import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "../registry.js";
import {
  assertSkillAllowed,
  buildDynamicWorkflowSkillActivatedMessages,
  buildInitSkillActivatedMessages,
  buildSkillActivatedMessages,
  formatActiveSkillReminder,
  formatSkillActivationResult,
  formatSkillToolResult,
  launchDynamicWorkflowFromSkill,
  parseSkillInput,
  skillHandler,
  skillToolDefinition,
} from "./skill.js";
import { getSystemSkillEntry } from "../../skills/system-skills.js";
import { toolContext, withTempDir } from "./test-helpers.js";

vi.mock("../../workflows/runner.js", () => ({
  launchWorkflow: vi.fn(async () => ({
    taskId: "wskill1",
    runId: "wf_skill1",
    scriptPath: "/tmp/deep-research.js",
    transcriptDir: "/tmp/transcript",
    summary: "Deep research harness",
    record: {
      taskId: "wskill1",
      runId: "wf_skill1",
      name: "deep-research",
      description: "Deep research harness",
      status: "running",
      scriptPath: "/tmp/deep-research.js",
      transcriptDir: "/tmp/transcript",
      startedAt: new Date().toISOString(),
      agentsTotal: 0,
      agentsDone: 0,
      agentsFailed: 0,
    },
  })),
  formatWorkflowToolResult: vi.fn(
    (launch: { runId: string }) =>
      `Workflow launched in background.\nRun ID: ${launch.runId}`,
  ),
}));

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

  it("returns Launching skill ack for dynamic-workflow skills", async () => {
    await withTempDir(async (cwd) => {
      const result = await skillHandler(
        { skill: "deep-research", args: "Option A research topic" },
        toolContext(cwd, { sessionId: "sess-skill", allowedSkills: ["deep-research"] }),
      );
      expect(result).toBe("Launching skill: deep-research");
    });
  });

  it("launchDynamicWorkflowFromSkill starts Workflow and returns tool follow-through", async () => {
    await withTempDir(async (cwd) => {
      const follow = await launchDynamicWorkflowFromSkill({
        skillName: "deep-research",
        skillArgs: "Option A research topic",
        skillOutput: "Launching skill: deep-research",
        sessionId: "sess-skill",
        cwd,
      });
      expect(follow).not.toBeNull();
      expect(follow!.skillOutput).toBe("Launching skill: deep-research");
      expect(follow!.workflowToolCall.name).toBe("Workflow");
      expect(follow!.workflowToolCall.input).toEqual({
        name: "deep-research",
        args: "Option A research topic",
      });
      expect(follow!.workflowOutput).toContain("Workflow launched in background.");
      expect(follow!.workflowOutput).toContain("wf_skill1");
    });
  });

  it("launchDynamicWorkflowFromSkill requires args", async () => {
    await withTempDir(async (cwd) => {
      const follow = await launchDynamicWorkflowFromSkill({
        skillName: "deep-research",
        skillOutput: "Launching skill: deep-research",
        sessionId: "sess-skill",
        cwd,
      });
      expect(follow).toBeNull();
    });
  });

  it("returns this session workflow status for Skill(workflows)", async () => {
    await withTempDir(async (cwd) => {
      const result = await skillHandler(
        { skill: "workflows" },
        toolContext(cwd, { sessionId: "sess-wf", allowedSkills: ["workflows"] }),
      );
      expect(result).toBe("No workflows in this session.");
    });
  });

  it("rejects plan as slash-only", async () => {
    await withTempDir(async (cwd) => {
      await expect(
        skillHandler({ skill: "plan" }, toolContext(cwd, { allowedSkills: ["plan"] })),
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

  it("uses Launching skill ack for dynamic-workflow names", () => {
    expect(formatSkillActivationResult("deep-research", "/any")).toBe(
      "Launching skill: deep-research",
    );
  });
});

describe("buildDynamicWorkflowSkillActivatedMessages", () => {
  it("re-injects Invoke: Workflow guide with refined args", async () => {
    const entry = getSystemSkillEntry("deep-research");
    expect(entry).toBeDefined();
    const messages = await buildDynamicWorkflowSkillActivatedMessages({
      systemPromptBase: "You are helpful.",
      transcript: [{ role: "user", content: "/deep-research Option A" }],
      entry: entry!,
      skillArgs: "Option A refined research question",
      now: new Date("2026-07-17T12:00:00"),
    });
    expect(messages[0]?.role).toBe("system");
    const last = String(messages[messages.length - 1]?.content ?? "");
    expect(last).toContain("Re-invocation of /deep-research");
    expect(last).toContain('Invoke: Workflow({ name: "deep-research"');
    expect(last).toContain("Option A refined research question");
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
