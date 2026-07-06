import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  exitWorktreeHandler,
  exitWorktreeToolDefinition,
  parseExitWorktreeInput,
} from "./exit-worktree.js";
import { createGitWorktree, listWorktreeRemovalBlockers } from "./worktree.js";
import { toolContext, withTempDir } from "./test-helpers.js";

const execFileAsync = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["-c", "core.hooksPath=/dev/null", "init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@kako.dev"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Kako Test"], { cwd: dir });
  await execFileAsync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

function worktreeContext(
  cwd: string,
  session: {
    repoRoot: string;
    originalCwd: string;
    worktreePath: string;
    created: boolean;
    branch: string;
    name?: string;
  },
) {
  let active = session;
  return toolContext(cwd, {
    getWorktreeSession: () => active,
    setWorktreeSession: (next) => {
      active = next;
    },
    setCwd: () => {},
  });
}

describe("ExitWorktree tool definition", () => {
  it("matches Claude Code schema and description", () => {
    expect(exitWorktreeToolDefinition.inputSchema.required).toEqual(["action"]);
    expect(exitWorktreeToolDefinition.inputSchema.properties?.discard_changes).toBeDefined();
    expect(exitWorktreeToolDefinition.description).toContain("Scope");
    expect(exitWorktreeToolDefinition.description).toContain("discard_changes");
    expect(exitWorktreeToolDefinition.description).toContain("no-op");
  });
});

describe("parseExitWorktreeInput", () => {
  it("requires action", () => {
    expect(() => parseExitWorktreeInput({})).toThrow(/requires action/);
    expect(parseExitWorktreeInput({ action: "keep" })).toEqual({
      action: "keep",
      discardChanges: false,
    });
    expect(parseExitWorktreeInput({ action: "remove", discard_changes: true })).toEqual({
      action: "remove",
      discardChanges: true,
    });
  });
});

describe("exitWorktreeHandler", () => {
  it("no-ops outside a worktree session", async () => {
    const out = await exitWorktreeHandler(
      { action: "keep" },
      toolContext("/tmp", {
        getWorktreeSession: () => undefined,
        setWorktreeSession: () => {},
        setCwd: () => {},
      }),
    );
    expect(out).toContain("No worktree session is active");
  });

  it("refuses remove with uncommitted changes unless discard_changes", async () => {
    await withTempDir(async (dir) => {
      await initGitRepo(dir);
      const { worktreePath, branch } = await createGitWorktree({
        repoRoot: dir,
        name: "dirty",
      });
      await writeFile(join(worktreePath, "dirty.txt"), "x", "utf-8");

      const session = {
        repoRoot: dir,
        originalCwd: dir,
        worktreePath,
        created: true,
        branch,
        name: "dirty",
      };
      const ctx = worktreeContext(worktreePath, session);

      await expect(exitWorktreeHandler({ action: "remove" }, ctx)).rejects.toThrow(
        /Refusing to remove worktree/,
      );
      expect(ctx.getWorktreeSession?.()).toBeDefined();
    });
  });

  it("removes worktree when discard_changes is true", async () => {
    await withTempDir(async (dir) => {
      await initGitRepo(dir);
      const { worktreePath, branch } = await createGitWorktree({
        repoRoot: dir,
        name: "gone",
      });
      await writeFile(join(worktreePath, "dirty.txt"), "x", "utf-8");

      const session = {
        repoRoot: dir,
        originalCwd: dir,
        worktreePath,
        created: true,
        branch,
        name: "gone",
      };
      const ctx = worktreeContext(worktreePath, session);

      const out = await exitWorktreeHandler({ action: "remove", discard_changes: true }, ctx);
      expect(String(out)).toContain("removed it");
      expect(ctx.getWorktreeSession?.()).toBeUndefined();
    });
  });
});

describe("listWorktreeRemovalBlockers", () => {
  it("detects uncommitted files", async () => {
    await withTempDir(async (dir) => {
      await initGitRepo(dir);
      const { worktreePath } = await createGitWorktree({ repoRoot: dir, name: "check" });
      await writeFile(join(worktreePath, "new.txt"), "hello", "utf-8");
      const blockers = await listWorktreeRemovalBlockers(worktreePath);
      expect(blockers.join("\n")).toContain("Uncommitted changes");
    });
  });
});
