import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../tools/registry.js";
import {
  registerBuiltinTools,
  resolveAllToolNames,
  resolveAllowedToolNames,
  defaultBuiltinToolNamesForCapability,
} from "../tools/builtin/registry.js";

const baseContext = {
  agentId: "agent-main",
  sessionId: "sess-1",
  cwd: "/tmp",
};

describe("tool exposure policy", () => {
  it("top-level agent uses all registered tools on every LLM call", () => {
    const registry = new ToolRegistry(baseContext);
    registerBuiltinTools(registry);
    registry.register(
      {
        name: "mcp/demo/tool",
        description: "demo",
        inputSchema: { type: "object", properties: {} },
      },
      async () => "ok",
    );

    const allowed = resolveAllToolNames(registry);
    expect(allowed).toContain("AskUserQuestion");
    expect(allowed).toContain("EnterPlanMode");
    expect(allowed).toContain("ExitPlanMode");
    expect(allowed).toContain("CronCreate");
    expect(allowed).toContain("mcp/demo/tool");
  });

  it("sub-agent uses only tools listed in its agent yaml", () => {
    const registry = new ToolRegistry(baseContext);
    registerBuiltinTools(registry);
    registry.register(
      {
        name: "mcp/demo/tool",
        description: "demo",
        inputSchema: { type: "object", properties: {} },
      },
      async () => "ok",
    );

    const allowed = resolveAllowedToolNames(["Read", "Glob", "Grep"], registry);
    expect(allowed).toEqual(["Read"]);
    expect(allowed).not.toContain("AskUserQuestion");
    expect(allowed).not.toContain("CronCreate");
    expect(allowed).not.toContain("mcp/demo/tool");
  });

  it("sub-agent with omitted tools falls back to default built-ins", () => {
    const registry = new ToolRegistry(baseContext);
    registerBuiltinTools(registry);
    expect(resolveAllowedToolNames(undefined, registry)).toEqual(
      defaultBuiltinToolNamesForCapability("WorkspaceWrite"),
    );
  });
});
