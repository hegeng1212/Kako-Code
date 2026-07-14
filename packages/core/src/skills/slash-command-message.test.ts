import { describe, expect, it } from "vitest";
import {
  buildDynamicWorkflowSlashMessage,
  buildInitSlashContentBlocks,
  buildSlashCommandTags,
  INIT_SLASH_CORE_PROMPT,
  parseBareInitCommand,
  resolveSkillSlashUserContent,
} from "./slash-command-message.js";
import { getSystemSkillEntry } from "./system-skills.js";

describe("buildSlashCommandTags", () => {
  it("includes command tags with optional args", () => {
    expect(buildSlashCommandTags("deep-research", "母婴报告")).toContain(
      "<command-message>deep-research</command-message>",
    );
    expect(buildSlashCommandTags("deep-research", "母婴报告")).toContain(
      "<command-name>/deep-research</command-name>",
    );
    expect(buildSlashCommandTags("deep-research", "母婴报告")).toContain(
      "<command-args>母婴报告</command-args>",
    );
  });
});

describe("parseBareInitCommand", () => {
  it("matches bare init without a leading slash", () => {
    expect(parseBareInitCommand("init")).toEqual({ args: "", displayText: "init" });
    expect(parseBareInitCommand("init focus on tests")).toEqual({
      args: "focus on tests",
      displayText: "init focus on tests",
    });
    expect(parseBareInitCommand("/init")).toBeNull();
    expect(parseBareInitCommand("initialize")).toBeNull();
  });
});

describe("buildInitSlashContentBlocks", () => {
  it("uses command tags and KAKO init core prompt blocks", () => {
    const blocks = buildInitSlashContentBlocks("");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe("text");
    expect(blocks[0]?.text).toContain("<command-message>init</command-message>");
    expect(blocks[0]?.text).toContain("<command-name>/init</command-name>");
    expect(blocks[1]?.text).toBe(INIT_SLASH_CORE_PROMPT);
    expect(blocks[1]?.text).toContain("KAKO.md");
    expect(blocks[1]?.text).not.toContain("CLAUDE.md");
  });

  it("includes command args in the tag block when provided", () => {
    const blocks = buildInitSlashContentBlocks("focus on tests");
    expect(blocks[0]?.text).toContain("<command-args>focus on tests</command-args>");
    expect(blocks[1]?.text).toBe(INIT_SLASH_CORE_PROMPT);
  });
});

describe("resolveSkillSlashUserContent", () => {
  it("loads directory skills for handler skill", async () => {
    const content = await resolveSkillSlashUserContent(
      "deep-research",
      "topic",
      "dynamic-workflow",
      process.cwd(),
    );
    expect(content.mode).toBe("text");
  });
});

describe("buildDynamicWorkflowSlashMessage", () => {
  it("matches Claude Code invoke line when args are provided", async () => {
    const entry = getSystemSkillEntry("deep-research");
    expect(entry).toBeDefined();
    const message = await buildDynamicWorkflowSlashMessage(entry!, "test query");
    expect(message).toContain("<command-message>deep-research</command-message>");
    expect(message).toContain('Invoke: Workflow({ name: "deep-research", args: "test query" })');
    expect(message).toContain("Phases:");
    expect(message).toContain("Scope:");
    expect(message).not.toContain("After invoking Workflow");
    expect(message).not.toContain("<task-notification>");
  });

  it("matches Claude Code invoke line when args are empty", async () => {
    const entry = getSystemSkillEntry("deep-research");
    expect(entry).toBeDefined();
    const message = await buildDynamicWorkflowSlashMessage(entry!, "");
    expect(message).toContain('Invoke: Workflow({ name: "deep-research" })');
    expect(message).not.toContain('args: "deep-research"');
    expect(message).not.toContain("Do NOT invoke Workflow");
    expect(message).toContain("BEFORE invoking");
  });
});
