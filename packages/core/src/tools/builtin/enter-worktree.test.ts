import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { ToolRegistry } from "../registry.js";
import {
  enterWorktreeHandler,
  enterWorktreeToolDefinition,
  parseEnterWorktreeInput,
} from "./enter-worktree.js";
import {
  CLAUDE_ENTER_WORKTREE_NAME_DESCRIPTION,
  CLAUDE_ENTER_WORKTREE_PATH_DESCRIPTION,
} from "../claude-tool-text.js";
import { exitWorktreeHandler } from "./exit-worktree.js";
import { registerBuiltinTools } from "./registry.js";
import { withTempDir } from "./test-helpers.js";

const execFileAsync = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["-c", "core.hooksPath=/dev/null", "init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@kako.dev"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Kako Test"], { cwd: dir });
  await execFileAsync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

function registryWithWorktree(cwd: string): ToolRegistry {
  const registry = new ToolRegistry({
    cwd,
    sessionId: "sess-wt",
    agentId: "agent-main",
  });
  registerBuiltinTools(registry);
  return registry;
}

describe("parseEnterWorktreeInput", () => {
  it("matches Claude Code description and schema adapted for Kako", () => {
    expect(enterWorktreeToolDefinition.description).toContain("KAKO.md");
    expect(enterWorktreeToolDefinition.description).toContain(".kako/worktrees/");
    expect(enterWorktreeToolDefinition.description).toContain("worktree.baseRef");
    expect(enterWorktreeToolDefinition.description).not.toContain("CLAUDE.md");
    expect(enterWorktreeToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(enterWorktreeToolDefinition.inputSchema.required).toBeUndefined();
    expect(enterWorktreeToolDefinition.inputSchema.properties?.name).toMatchObject({
      type: "string",
      description: CLAUDE_ENTER_WORKTREE_NAME_DESCRIPTION,
    });
    expect(enterWorktreeToolDefinition.inputSchema.properties?.path).toMatchObject({
      type: "string",
      description: CLAUDE_ENTER_WORKTREE_PATH_DESCRIPTION,
    });
  });

  it("rejects name and path together", () => {
    expect(() => parseEnterWorktreeInput({ name: "a", path: "/tmp" })).toThrow(
      /mutually exclusive/,
    );
  });
});

describe("EnterWorktree / ExitWorktree", () => {
  it("creates and exits a worktree session", async () => {
    await withTempDir(async (dir) => {
      await initGitRepo(dir);
      const registry = registryWithWorktree(dir);

      const create = await registry.execute({
        id: "tu-enter",
        name: "EnterWorktree",
        input: { name: "feature-a" },
      });
      expect(create.status).toBe("success");
      expect(String(create.output)).toContain("Created and entered worktree");
      expect(registry.getCwd()).not.toBe(dir);
      expect(registry.getWorktreeSession()?.created).toBe(true);

      const wtPath = registry.getCwd();
      const bash = await registry.execute({
        id: "tu-bash",
        name: "Bash",
        input: { command: "pwd" },
      });
      expect(String(bash.output).trim()).toBe(wtPath);

      const exit = await registry.execute({
        id: "tu-exit",
        name: "ExitWorktree",
        input: { action: "remove" },
      });
      expect(exit.status).toBe("success");
      expect(registry.getCwd()).toBe(dir);
      expect(registry.getWorktreeSession()).toBeUndefined();
    });
  });

  it("enters an existing worktree by path", async () => {
    await withTempDir(async (dir) => {
      await initGitRepo(dir);
      const registry = registryWithWorktree(dir);

      await registry.execute({
        id: "tu-enter",
        name: "EnterWorktree",
        input: { name: "existing" },
      });
      const wtPath = registry.getCwd();

      await registry.execute({
        id: "tu-exit",
        name: "ExitWorktree",
        input: { action: "keep" },
      });

      const enterPath = await registry.execute({
        id: "tu-path",
        name: "EnterWorktree",
        input: { path: wtPath },
      });
      expect(enterPath.status).toBe("success");
      expect(registry.getCwd()).toBe(wtPath);
      expect(registry.getWorktreeSession()?.created).toBe(false);
    });
  });

  it("rejects creating a new worktree while already in one", async () => {
    await withTempDir(async (dir) => {
      await initGitRepo(dir);
      const registry = registryWithWorktree(dir);
      await registry.execute({
        id: "tu-enter",
        name: "EnterWorktree",
        input: { name: "first" },
      });
      const second = await registry.execute({
        id: "tu-second",
        name: "EnterWorktree",
        input: { name: "second" },
      });
      expect(second.status).toBe("error");
      expect(second.error).toContain("Already in a worktree session");
    });
  });
});

describe("enterWorktreeHandler direct", () => {
  it("requires harness callbacks", async () => {
    await expect(enterWorktreeHandler({}, { cwd: "/tmp", agentId: "a", sessionId: "s", toolUseId: "t" })).rejects.toThrow(
      /not available/,
    );
  });
});
