import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMessages, resolveEnvironmentInfo } from "../agent/context.js";
import { agentToolDefinition } from "../tools/builtin/agent-tool.js";
import {
  CLAUDE_CODE_BUILTIN_TOOL_NAMES,
  registerBuiltinTools,
  resolveAllToolNames,
} from "../tools/builtin/registry.js";
import { ToolRegistry } from "../tools/registry.js";
import { discoverSkillsForAgent, partitionSkillsForCatalog } from "./loader.js";

const USER_LIST = `Agent
AskUserQuestion
Bash
CronCreate
CronDelete
CronList
DesignSync
Edit
EnterPlanMode
EnterWorktree
ExitPlanMode
ExitWorktree
Monitor
NotebookEdit
PushNotification
Read
ScheduleWakeup
Skill
TaskCreate
TaskGet
TaskList
TaskOutput
TaskStop
TaskUpdate
WebFetch
WebSearch
Workflow
Write`.split("\n");

describe("production parity snapshot", () => {
  const cwd = join(homedir(), "Documents/work/coding/github/kako");

  it("built-in tools match user-provided Claude list (28)", () => {
    expect([...CLAUDE_CODE_BUILTIN_TOOL_NAMES].sort()).toEqual([...USER_LIST].sort());
    const registry = new ToolRegistry({ cwd, sessionId: "verify", agentId: "agent-main" });
    registerBuiltinTools(registry);
    registry.register(agentToolDefinition, async () => "ok");
    const names = resolveAllToolNames(registry);
    for (const name of USER_LIST) {
      expect(names, `missing ${name}`).toContain(name);
    }
  });

  it("injects default + enabled user skills into system prompt catalog", async () => {
    const partition = await partitionSkillsForCatalog(cwd);
    const manifest = JSON.parse(
      readFileSync(join(homedir(), ".kako/config/installed-skills.json"), "utf8"),
    ) as { skills: Array<{ name: string; enabled?: boolean }> };
    const enabledNames = new Set(
      manifest.skills.filter((s) => s.enabled !== false).map((s) => s.name),
    );
    const defaultNames = new Set(partition.defaults.map((s) => s.name));
    const catalogNames = new Set([
      ...partition.defaults.map((s) => s.name),
      ...partition.user.map((s) => s.name),
    ]);

    for (const name of enabledNames) {
      if (!defaultNames.has(name)) {
        expect(partition.user.map((s) => s.name), `enabled user skill ${name}`).toContain(name);
      }
    }
    expect(partition.user.some((s) => s.name === "baby-growth-record")).toBe(true);
    expect(defaultNames.has("deep-research")).toBe(true);
    expect(defaultNames.has("init")).toBe(true);

    const discovered = await discoverSkillsForAgent(cwd);
    expect(discovered.some((skill) => skill.name === "init")).toBe(true);
    for (const skill of discovered) {
      expect(catalogNames.has(skill.name)).toBe(true);
    }

    const messages = await buildMessages({
      definition: { name: "main", description: "t", model: "", systemPrompt: "You are Kako." },
      transcript: [],
      environment: await resolveEnvironmentInfo(cwd, "test"),
      availableSkills: partition,
    });
    const system = String(messages[0]?.content ?? "");
    expect(system).toContain("The following skills are available for use with the Skill tool:");
    expect(system).toContain("- baby-growth-record:");
    expect(system).toContain("- deep-research:");
    expect(system).toContain("- init:");
    expect(system).toContain("Initialize a new KAKO.md file with codebase documentation");
    if (partition.defaults.length && partition.user.length) {
      const firstUser = partition.user[0]!.name;
      const lastDefault = partition.defaults[partition.defaults.length - 1]!.name;
      expect(system.indexOf(`- ${lastDefault}:`)).toBeLessThan(system.indexOf(`- ${firstUser}:`));
    }
  });
});
