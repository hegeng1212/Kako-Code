import { describe, expect, it } from "vitest";
import { agentToolDefinition } from "./builtin/agent-tool.js";
import { bashToolDefinition } from "./builtin/bash.js";
import { taskUpdateToolDefinition } from "./builtin/task-update.js";
import { writeToolDefinition } from "./builtin/write.js";
import { toolCallNeedsUserConfirm } from "./confirm-policy.js";

describe("toolCallNeedsUserConfirm", () => {
  it("never requires confirm for Agent in any permission mode", () => {
    const call = {
      id: "1",
      name: "Agent",
      input: { description: "Explore code", prompt: "Find handlers" },
    };
    for (const mode of ["default", "plan", "acceptEdits", "bypassPermissions"] as const) {
      expect(toolCallNeedsUserConfirm(call, agentToolDefinition, mode)).toBe(false);
    }
  });

  it("never requires confirm for Task tools in any permission mode", () => {
    const call = {
      id: "1",
      name: "TaskUpdate",
      input: { taskId: "task-1", status: "completed" },
    };
    for (const mode of ["default", "plan", "acceptEdits", "bypassPermissions"] as const) {
      expect(toolCallNeedsUserConfirm(call, taskUpdateToolDefinition, mode)).toBe(false);
    }
  });

  it("requires confirm for Write in default mode", () => {
    expect(
      toolCallNeedsUserConfirm(
        { id: "1", name: "Write", input: { file_path: "/tmp/a.py", content: "x" } },
        writeToolDefinition,
        "default",
      ),
    ).toBe(true);
  });

  it("skips confirm for low-risk Bash", () => {
    expect(
      toolCallNeedsUserConfirm(
        { id: "1", name: "Bash", input: { command: "ls -la" } },
        bashToolDefinition,
        "default",
      ),
    ).toBe(false);
  });

  it("requires confirm for high-risk Bash", () => {
    expect(
      toolCallNeedsUserConfirm(
        { id: "1", name: "Bash", input: { command: "python add.py" } },
        bashToolDefinition,
        "default",
      ),
    ).toBe(true);
  });

  it("skips confirm when MCP policy is never", () => {
    expect(
      toolCallNeedsUserConfirm(
        { id: "1", name: "mcp/demo/tool", input: {} },
        {
          name: "mcp/demo/tool",
          description: "demo",
          inputSchema: { type: "object" },
          security: { sideEffect: true },
          requiresConfirmation: true,
        },
        "default",
        undefined,
        "never",
      ),
    ).toBe(false);
  });

  it("skips write confirm in acceptEdits mode", () => {
    expect(
      toolCallNeedsUserConfirm(
        { id: "1", name: "Write", input: { file_path: "/tmp/a.py", content: "x" } },
        writeToolDefinition,
        "acceptEdits",
      ),
    ).toBe(false);
  });
});
