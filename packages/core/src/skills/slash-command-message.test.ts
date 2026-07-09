import { describe, expect, it } from "vitest";
import {
  buildDynamicWorkflowSlashMessage,
  buildSlashCommandTags,
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
