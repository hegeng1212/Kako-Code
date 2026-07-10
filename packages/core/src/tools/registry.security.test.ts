import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getConfigDir } from "../config/paths.js";
import { ToolRegistry } from "../tools/registry.js";
import { registerBuiltinTools } from "./builtin/registry.js";
import { withTempDir } from "./builtin/test-helpers.js";

describe("ToolRegistry security gate", () => {
  it("allows stdio MCP tools under WorkspaceWrite capability", async () => {
    await withTempDir(async (dir) => {
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-mcp",
        agentId: "agent-1",
        capability: "WorkspaceWrite",
      });
      registry.register(
        {
          name: "mcp/babytree/bbt_pregnancy.find_baby",
          description: "demo",
          inputSchema: { type: "object" },
          security: { capability: ["mcp"] },
        },
        async () => "ok",
      );

      const result = await registry.execute({
        id: "tu-mcp",
        name: "mcp/babytree/bbt_pregnancy.find_baby",
        input: {},
      });
      expect(result.status).toBe("success");
      expect(result.error).toBeUndefined();
    });
  });

  it("denies ReadOnly capability from using Bash", async () => {
    await withTempDir(async (dir) => {
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-1",
        agentId: "agent-1",
        capability: "ReadOnly",
      });
      registry.register(
        {
          name: "Bash",
          description: "x",
          inputSchema: { type: "object" },
          security: { capability: ["exec"] },
        },
        async () => "ok",
      );

      const result = await registry.execute({
        id: "tu-1",
        name: "Bash",
        input: { command: "echo hi" },
      });
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/does not allow/i);
      expect(result.audit?.capability).toBe("ReadOnly");
    });
  });

  it("skips confirm for Read inside workspace", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "hello.py");
      await writeFile(file, 'print("hi")\n', "utf-8");
      const confirm = vi.fn(async () => true);
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-3",
        agentId: "agent-1",
        confirm,
      });
      registerBuiltinTools(registry);

      const result = await registry.execute({
        id: "tu-3",
        name: "Read",
        input: { file_path: file },
      });

      expect(confirm).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.audit?.approvalResult).toBe("skipped");
    });
  });

  it("skips confirm for AskUserQuestion", async () => {
    await withTempDir(async (dir) => {
      const confirm = vi.fn(async () => ({ allowed: true }));
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-4",
        agentId: "agent-1",
        confirm,
        askUserQuestion: async () => ({
          answers: { "Which library should we use?": "date-fns" },
        }),
      });
      registerBuiltinTools(registry);

      const result = await registry.execute({
        id: "tu-4",
        name: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "Which library should we use?",
              header: "Library",
              multiSelect: false,
              options: [
                { label: "date-fns", description: "Tree-shakeable" },
                { label: "dayjs", description: "Small API" },
              ],
            },
          ],
        },
      });

      expect(confirm).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.audit?.approvalResult).toBe("skipped");
    });
  });

  it("skips confirm for Skill", async () => {
    await withTempDir(async (dir) => {
      const confirm = vi.fn(async () => ({ allowed: true }));
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-5",
        agentId: "agent-1",
        confirm,
        allowedSkills: ["demo"],
      });
      registerBuiltinTools(registry);

      const result = await registry.execute({
        id: "tu-5",
        name: "Skill",
        input: { skill: "demo" },
      });

      expect(confirm).not.toHaveBeenCalled();
      expect(result.audit?.approvalResult).toBe("skipped");
    });
  });

  it("skips confirm for EnterWorktree", async () => {
    await withTempDir(async (dir) => {
      const confirm = vi.fn(async () => ({ allowed: true }));
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-6",
        agentId: "agent-1",
        confirm,
      });
      registerBuiltinTools(registry);

      const result = await registry.execute({
        id: "tu-6",
        name: "EnterWorktree",
        input: { name: "feature-a" },
      });

      expect(confirm).not.toHaveBeenCalled();
      expect(result.audit?.approvalResult).toBe("skipped");
    });
  });

  it("denies Read of default denied config paths", async () => {
    await withTempDir(async (dir) => {
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-2",
        agentId: "agent-1",
      });
      registerBuiltinTools(registry);

      const secretFile = join(getConfigDir(), "providers.json");
      const result = await registry.execute({
        id: "tu-2",
        name: "Read",
        input: { file_path: secretFile },
      });
      expect(result.status).toBe("error");
      expect(result.error).toMatch(/sensitive configuration/i);
    });
  });
});
