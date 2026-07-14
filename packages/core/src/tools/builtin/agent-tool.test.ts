import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@kako/shared";
import {
  agentToolDefinition,
  assertSubAgentSpawnAllowed,
  createAgentHandler,
  formatSubAgentResult,
  normalizeSubagentType,
} from "./agent-tool.js";
import { ToolRegistry } from "../registry.js";
import { resolveAllowedToolNames, registerBuiltinTools } from "./registry.js";

const execContext: ToolExecutionContext = {
  agentId: "agent-main",
  sessionId: "sess-1",
  toolUseId: "tu-agent-1",
  cwd: "/tmp/project",
};

describe("Agent tool definition", () => {
  it("requires description and prompt", () => {
    expect(agentToolDefinition.inputSchema.required).toEqual(["description", "prompt"]);
    expect(agentToolDefinition.name).toBe("Agent");
  });

  it("matches Claude Code description and schema", () => {
    expect(agentToolDefinition.description).toContain("subagent_type parameter");
    expect(agentToolDefinition.description).toContain("## When to use");
    expect(agentToolDefinition.description).not.toContain("When NOT to use");
    expect(agentToolDefinition.inputSchema.additionalProperties).toBe(false);
    const props = agentToolDefinition.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.isolation?.enum).toEqual(["worktree", "remote"]);
    expect(props.model?.enum).toEqual(["sonnet", "opus", "haiku", "fable"]);
  });
});

describe("normalizeSubagentType", () => {
  it("maps aliases and defaults", () => {
    expect(normalizeSubagentType(undefined)).toBe("general-purpose");
    expect(normalizeSubagentType("Explore")).toBe("explore");
    expect(normalizeSubagentType("Plan")).toBe("plan");
    expect(normalizeSubagentType("general_purpose")).toBe("general-purpose");
    expect(normalizeSubagentType("custom-agent")).toBe("custom-agent");
  });
});

describe("assertSubAgentSpawnAllowed", () => {
  const allowed = ["explore", "plan", "general-purpose"];

  it("accepts allowed subagent types", () => {
    expect(assertSubAgentSpawnAllowed({ description: "x", prompt: "y" }, allowed)).toBe(
      "general-purpose",
    );
    expect(
      assertSubAgentSpawnAllowed(
        { description: "x", prompt: "y", subagent_type: "explore" },
        allowed,
      ),
    ).toBe("explore");
  });

  it("rejects disallowed subagent types", () => {
    expect(() =>
      assertSubAgentSpawnAllowed(
        { description: "x", prompt: "y", subagent_type: "admin" },
        allowed,
      ),
    ).toThrow(/not allowed/);
  });

  it("allows exploration delegations", () => {
    expect(
      assertSubAgentSpawnAllowed(
        { description: "Scan auth module", prompt: "Find where sessions are stored" },
        allowed,
      ),
    ).toBe("general-purpose");
  });

  it("allows background execution mode", () => {
    expect(
      assertSubAgentSpawnAllowed(
        { description: "x", prompt: "y", run_in_background: true },
        allowed,
      ),
    ).toBe("general-purpose");
  });

  it("rejects unsupported isolation modes early", () => {
    expect(() =>
      assertSubAgentSpawnAllowed(
        { description: "x", prompt: "y", isolation: "worktree" },
        allowed,
      ),
    ).toThrow(/worktree/);

    expect(() =>
      assertSubAgentSpawnAllowed(
        { description: "x", prompt: "y", isolation: "remote" },
        allowed,
      ),
    ).toThrow(/remote/);
  });
});

describe("createAgentHandler", () => {
  it("validates required fields before spawning", async () => {
    const spawnSubAgent = vi.fn();
    const handler = createAgentHandler({ spawnSubAgent });

    await expect(handler({ description: "", prompt: "x" }, execContext)).rejects.toThrow(
      /description/,
    );
    await expect(handler({ description: "x", prompt: "  " }, execContext)).rejects.toThrow(
      /prompt/,
    );
    expect(spawnSubAgent).not.toHaveBeenCalled();
  });

  it("delegates to host exactly once with normalized payload", async () => {
    const spawnSubAgent = vi.fn(async () => "sub result");
    const handler = createAgentHandler({ spawnSubAgent });

    const output = await handler(
      {
        description: "scan repo",
        prompt: "find auth module",
        subagent_type: "Explore",
      },
      execContext,
    );

    expect(output).toBe("sub result");
    expect(spawnSubAgent).toHaveBeenCalledTimes(1);
    expect(spawnSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "scan repo",
        prompt: "find auth module",
        subagent_type: "Explore",
      }),
      execContext,
    );
  });

  it("does not retry spawn when host throws", async () => {
    const spawnSubAgent = vi.fn(async () => {
      throw new Error("spawn failed");
    });
    const handler = createAgentHandler({ spawnSubAgent });

    await expect(
      handler({ description: "scan", prompt: "go" }, execContext),
    ).rejects.toThrow("spawn failed");
    expect(spawnSubAgent).toHaveBeenCalledTimes(1);
  });
});

describe("formatSubAgentResult", () => {
  it("wraps sub-agent final text for parent consumption", () => {
    const text = formatSubAgentResult("explore", "scan auth", "Found auth in src/auth.ts");
    expect(text).toContain('Agent "explore" completed: scan auth');
    expect(text).toContain("Found auth in src/auth.ts");
  });

  it("handles empty sub-agent response", () => {
    expect(formatSubAgentResult("plan", "design", "")).toContain("(no text response)");
  });
});

describe("Agent tool registration policy", () => {
  it("excludes Agent from sub-agent allowed tools even if yaml lists it", () => {
    const registry = new ToolRegistry({ ...execContext, capability: "FullAccess" });
    registerBuiltinTools(registry);
    registry.register(
      agentToolDefinition,
      createAgentHandler({ spawnSubAgent: async () => "ok" }),
    );

    const allowed = resolveAllowedToolNames(
      ["Read", "Write", "Bash", "Agent"],
      registry,
      { excludeAgent: true },
    );

    expect(allowed).toEqual(["Read", "Write", "Bash"]);
    expect(allowed).not.toContain("Agent");
  });

  it("omits Agent from LLM tools when parent has no subagents configured", () => {
    const registry = new ToolRegistry(execContext);
    registerBuiltinTools(registry);

    const allowed = resolveAllowedToolNames(["Read", "Agent"], registry);
    expect(allowed).toEqual(["Read"]);
  });
});

describe("Agent tool end-to-end via ToolRegistry", () => {
  it("returns host result as tool output for parent model turn", async () => {
    const spawnSubAgent = vi.fn(async () => formatSubAgentResult("explore", "scan", "summary"));
    const registry = new ToolRegistry(execContext);
    registry.register(agentToolDefinition, createAgentHandler({ spawnSubAgent }));

    const result = await registry.execute({
      id: "tu-1",
      name: "Agent",
      input: {
        description: "scan codebase",
        prompt: "locate session manager",
        subagent_type: "explore",
      },
    });

    expect(result.status).toBe("success");
    expect(String(result.output)).toContain("summary");
    expect(spawnSubAgent).toHaveBeenCalledTimes(1);
  });

  it("surfaces disallowed subagent errors as tool failure", async () => {
    const spawnSubAgent = vi.fn(async (input) => {
      assertSubAgentSpawnAllowed(input, ["explore"]);
      return "ok";
    });
    const registry = new ToolRegistry(execContext);
    registry.register(agentToolDefinition, createAgentHandler({ spawnSubAgent }));

    const result = await registry.execute({
      id: "tu-2",
      name: "Agent",
      input: { description: "bad", prompt: "go", subagent_type: "plan" },
    });

    expect(result.status).toBe("error");
    expect(String(result.error)).toMatch(/not allowed/);
    expect(spawnSubAgent).toHaveBeenCalledTimes(1);
  });
});
