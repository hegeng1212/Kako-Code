import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_EXIT_WORKTREE_DESCRIPTION } from "../claude-tool-text.js";
import { listWorktreeRemovalBlockers, removeGitWorktree } from "./worktree.js";

export const EXIT_WORKTREE_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_EXIT_WORKTREE_DESCRIPTION);

export const exitWorktreeToolDefinition: ToolDefinition = {
  name: "ExitWorktree",
  description: EXIT_WORKTREE_DESCRIPTION,
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: ["keep", "remove"],
        description: '"keep" leaves the worktree and branch on disk; "remove" deletes both.',
      },
      discard_changes: {
        type: "boolean",
        description:
          'Required true when action is "remove" and the worktree has uncommitted files or unmerged commits. The tool will refuse and list them otherwise.',
      },
    },
    required: ["action"],
  },
};

export interface ExitWorktreeInput {
  action: "keep" | "remove";
  discardChanges: boolean;
}

export function parseExitWorktreeInput(input: Record<string, unknown>): ExitWorktreeInput {
  const action = typeof input.action === "string" ? input.action.trim() : "";
  if (action !== "keep" && action !== "remove") {
    throw new Error('ExitWorktree requires action "keep" or "remove"');
  }
  return {
    action,
    discardChanges: input.discard_changes === true,
  };
}

export const exitWorktreeHandler: ToolHandler = async (input, context) => {
  if (!context.setCwd || !context.setWorktreeSession || !context.getWorktreeSession) {
    throw new Error("ExitWorktree is not available in this environment");
  }

  const session = context.getWorktreeSession();
  if (!session) {
    return "No worktree session is active — no change made.";
  }

  const parsed = parseExitWorktreeInput(input);

  if (parsed.action === "remove" && session.created && !parsed.discardChanges) {
    const blockers = await listWorktreeRemovalBlockers(session.worktreePath);
    if (blockers.length > 0) {
      throw new Error(
        [
          "Refusing to remove worktree with pending changes. Re-invoke with discard_changes: true after user confirmation.",
          "",
          ...blockers,
        ].join("\n"),
      );
    }
  }

  context.setCwd(session.originalCwd);
  context.setWorktreeSession(undefined);

  if (parsed.action === "remove" && session.created) {
    await removeGitWorktree(session.repoRoot, session.worktreePath);
    return [
      "Exited worktree and removed it.",
      `Restored directory: ${session.originalCwd}`,
      `Removed: ${session.worktreePath}`,
    ].join("\n");
  }

  const lines = [
    "Exited worktree (kept on disk).",
    `Restored directory: ${session.originalCwd}`,
    `Worktree path: ${session.worktreePath}`,
  ];
  if (parsed.action === "remove" && !session.created) {
    lines.push("(Worktree was entered via path — not removed.)");
  }
  return lines.join("\n");
};
