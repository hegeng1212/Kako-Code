import type { ToolDefinition, ToolHandler, WorktreeSessionInfo } from "@kako/shared";
import { resolve } from "node:path";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_ENTER_WORKTREE_DESCRIPTION,
  CLAUDE_ENTER_WORKTREE_NAME_DESCRIPTION,
  CLAUDE_ENTER_WORKTREE_PATH_DESCRIPTION,
} from "../claude-tool-text.js";
import { resolvePath } from "./path.js";
import {
  createGitWorktree,
  generateWorktreeName,
  gitRepoRoot,
  isGitRepository,
  listRegisteredWorktrees,
  worktreePathIsRegistered,
  type WorktreeSessionState,
} from "./worktree.js";

export const ENTER_WORKTREE_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_ENTER_WORKTREE_DESCRIPTION);

export const enterWorktreeToolDefinition: ToolDefinition = {
  name: "EnterWorktree",
  description: ENTER_WORKTREE_DESCRIPTION,
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: {
        type: "string",
        description: CLAUDE_ENTER_WORKTREE_NAME_DESCRIPTION,
      },
      path: {
        type: "string",
        description: CLAUDE_ENTER_WORKTREE_PATH_DESCRIPTION,
      },
    },
  },
};

export interface EnterWorktreeInput {
  name?: string;
  path?: string;
}

export function parseEnterWorktreeInput(input: Record<string, unknown>): EnterWorktreeInput {
  const name = typeof input.name === "string" ? input.name.trim() : undefined;
  const path = typeof input.path === "string" ? input.path.trim() : undefined;
  if (name && path) {
    throw new Error("EnterWorktree: `name` and `path` are mutually exclusive");
  }
  return { name: name || undefined, path: path || undefined };
}

export const enterWorktreeHandler: ToolHandler = async (input, context) => {
  if (!context.setCwd || !context.setWorktreeSession || !context.getWorktreeSession) {
    throw new Error("EnterWorktree is not available in this environment");
  }

  const parsed = parseEnterWorktreeInput(input);
  const hasGit = await isGitRepository(context.cwd);
  if (!hasGit) {
    throw new Error("EnterWorktree requires a git repository");
  }

  const repoRoot = await gitRepoRoot(context.cwd);

  if (parsed.path) {
    const worktreePath = resolve(resolvePath(parsed.path, context.cwd));
    const entries = await listRegisteredWorktrees(repoRoot);
    if (!worktreePathIsRegistered(entries, worktreePath)) {
      throw new Error(
        `Path is not a registered worktree for this repository: ${worktreePath}`,
      );
    }
    const entry = entries.find((e) => resolve(e.path) === worktreePath);
    const prior = context.getWorktreeSession();
    const originalCwd = prior?.originalCwd ?? context.cwd;
    const state: WorktreeSessionInfo = {
      repoRoot,
      originalCwd,
      worktreePath,
      created: false,
      branch: entry?.branch ?? "unknown",
    };
    context.setWorktreeSession(state);
    context.setCwd(worktreePath);
    return [
      "Entered existing worktree.",
      `Worktree path: ${worktreePath}`,
      `Branch: ${state.branch}`,
      `Original directory: ${originalCwd}`,
      "Use ExitWorktree with action keep to return. This worktree will not be removed automatically.",
    ].join("\n");
  }

  if (context.getWorktreeSession()) {
    throw new Error(
      "Already in a worktree session — use `path` to switch worktrees or ExitWorktree before creating a new one",
    );
  }

  const name = parsed.name || generateWorktreeName();
  const { worktreePath, branch } = await createGitWorktree({ repoRoot, name });
  const state: WorktreeSessionState = {
    repoRoot,
    originalCwd: context.cwd,
    worktreePath,
    created: true,
    branch,
    name,
  };
  context.setWorktreeSession(state);
  context.setCwd(worktreePath);

  return [
    "Created and entered worktree.",
    `Name: ${name}`,
    `Worktree path: ${worktreePath}`,
    `Branch: ${branch}`,
    `Original directory: ${state.originalCwd}`,
    "Use ExitWorktree to leave (keep or remove).",
  ].join("\n");
};
