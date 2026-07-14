import { describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "../registry.js";
import {
  BUILTIN_TOOLS,
  CLAUDE_CODE_BUILTIN_TOOL_NAMES,
  DEFAULT_BUILTIN_TOOL_NAMES,
  defaultBuiltinToolNamesForCapability,
  missingBuiltinToolNames,
  registerBuiltinTools,
  resolveAllToolNames,
  resolveAllowedToolNames,
} from "./registry.js";
import { agentToolDefinition } from "./agent-tool.js";

describe("builtin tool registry", () => {
  function registryWithBuiltins(): ToolRegistry {
    const registry = new ToolRegistry({
      cwd: "/tmp",
      sessionId: "sess-1",
      agentId: "agent-main",
    });
    registerBuiltinTools(registry);
    return registry;
  }

  it("registers all default built-in tools", () => {
    const registry = registryWithBuiltins();
    expect(registry.getDefinitions().map((d) => d.name)).toEqual(DEFAULT_BUILTIN_TOOL_NAMES);
    expect(DEFAULT_BUILTIN_TOOL_NAMES).toEqual([
      "Read",
      "Grep",
      "Glob",
      "Write",
      "Edit",
      "NotebookEdit",
      "Bash",
      "Monitor",
      "TaskOutput",
      "TaskStop",
      "AskUserQuestion",
      "EnterPlanMode",
      "ExitPlanMode",
      "EnterWorktree",
      "ExitWorktree",
      "CronCreate",
      "CronDelete",
      "CronList",
      "DesignSync",
      "ScheduleWakeup",
      "TaskCreate",
      "TaskGet",
      "TaskList",
      "TaskUpdate",
      "PushNotification",
      "WebFetch",
      "WebSearch",
      "Skill",
      "Workflow",
    ]);
  });

  it("includes every Claude Code built-in except Agent in DEFAULT_BUILTIN_TOOL_NAMES", () => {
    const withoutAgent = CLAUDE_CODE_BUILTIN_TOOL_NAMES.filter((name) => name !== "Agent");
    for (const name of withoutAgent) {
      expect(DEFAULT_BUILTIN_TOOL_NAMES, `missing ${name}`).toContain(name);
    }
  });

  it("registers Agent alongside built-ins for main-agent LLM tool surface", () => {
    const registry = registryWithBuiltins();
    registry.register(agentToolDefinition, async () => "ok");
    const names = resolveAllToolNames(registry);
    for (const name of CLAUDE_CODE_BUILTIN_TOOL_NAMES) {
      expect(names, `missing Claude built-in ${name}`).toContain(name);
    }
  });

  it("exposes LLM tool schemas for allowed names", () => {
    const registry = registryWithBuiltins();
    const llmTools = registry.toLLMTools(["Read", "Bash"]);
    expect(llmTools.map((t) => t.name)).toEqual(["Read", "Bash"]);
    expect(llmTools[0]?.inputSchema).toMatchObject({ type: "object" });
  });

  it("localizes WebSearch month hint from user messages", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T20:00:00.000Z"));

    const registry = registryWithBuiltins();
    const zhTool = registry.toLLMTools(["WebSearch"], {
      messages: [{ role: "user", content: "帮我搜索" }],
    })[0];
    const enTool = registry.toLLMTools(["WebSearch"], {
      messages: [{ role: "user", content: "search news" }],
    })[0];
    expect(zhTool?.description).toContain("February 2026");
    expect(enTool?.description).toMatch(/The current month is \w+ \d{4}/);

    vi.useRealTimers();
  });

  it("defaults to all built-ins when agent tools omitted", () => {
    const registry = registryWithBuiltins();
    expect(resolveAllowedToolNames(undefined, registry)).toEqual(
      defaultBuiltinToolNamesForCapability("WorkspaceWrite"),
    );
  });

  it("resolveAllToolNames returns every registered tool including MCP", () => {
    const registry = registryWithBuiltins();
    registry.register(
      {
        name: "mcp/demo/tool",
        description: "demo",
        inputSchema: { type: "object", properties: {} },
      },
      async () => "ok",
    );
    expect(resolveAllToolNames(registry)).toEqual([
      ...DEFAULT_BUILTIN_TOOL_NAMES,
      "mcp/demo/tool",
    ]);
  });

  it("resolveAllowedToolNames filters to agent yaml list only", () => {
    const registry = registryWithBuiltins();
    registry.register(
      {
        name: "mcp/demo/tool",
        description: "demo",
        inputSchema: { type: "object", properties: {} },
      },
      async () => "ok",
    );
    expect(resolveAllowedToolNames(["Read"], registry)).toEqual(["Read"]);
    expect(resolveAllowedToolNames(["Read", "mcp/demo/tool"], registry)).toEqual([
      "Read",
      "mcp/demo/tool",
    ]);
  });

  it("resolveAllowedToolNames supports tools wildcard", () => {
    const registry = registryWithBuiltins();
    registry.setCapability("FullAccess");
    const all = resolveAllowedToolNames(["*"], registry);
    expect(all).toContain("Read");
    expect(all).toContain("Bash");
    expect(all).not.toContain("Agent");
    expect(
      resolveAllowedToolNames(["*"], registry, {
        disallowedTools: ["Write"],
        excludeAgent: true,
      }),
    ).not.toContain("Write");
  });

  it("reports unimplemented built-ins requested by agent config", () => {
    expect(missingBuiltinToolNames(["Read", "Edit", "Grep"])).toEqual([]);
  });

  it("every built-in has definition and handler", () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.definition.name).toBeTruthy();
      expect(typeof tool.handler).toBe("function");
    }
  });
});
