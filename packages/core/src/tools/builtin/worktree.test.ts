import { describe, expect, it } from "vitest";
import {
  parseWorktreeListPorcelain,
  validateWorktreeName,
} from "./worktree.js";

describe("worktree helpers", () => {
  it("parses git worktree list porcelain", () => {
    const output = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/.kako/worktrees/feature",
      "HEAD def456",
      "branch refs/heads/kako-worktree/feature",
    ].join("\n");
    const entries = parseWorktreeListPorcelain(output);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.path).toBe("/repo/.kako/worktrees/feature");
    expect(entries[1]?.branch).toBe("refs/heads/kako-worktree/feature");
  });

  it("validates worktree names", () => {
    expect(() => validateWorktreeName("")).toThrow();
    expect(() => validateWorktreeName("bad name")).toThrow();
    expect(() => validateWorktreeName("ok/name-1")).not.toThrow();
  });
});
