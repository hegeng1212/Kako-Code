import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_EXIT_PLAN_MODE_ALLOWED_PROMPTS_DESCRIPTION,
  CLAUDE_EXIT_PLAN_MODE_DESCRIPTION,
} from "../claude-tool-text.js";
import {
  formatAllowedPromptsNote,
  parseExitPlanModeInput,
  readPlanFile,
} from "./plan-mode-shared.js";

export const EXIT_PLAN_MODE_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_EXIT_PLAN_MODE_DESCRIPTION);

export const exitPlanModeToolDefinition: ToolDefinition = {
  name: "ExitPlanMode",
  description: EXIT_PLAN_MODE_DESCRIPTION,
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      allowedPrompts: {
        type: "array",
        description: CLAUDE_EXIT_PLAN_MODE_ALLOWED_PROMPTS_DESCRIPTION,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: {
              type: "string",
              description: 'Semantic description of the action, e.g. "run tests", "install dependencies"',
            },
            tool: {
              type: "string",
              enum: ["Bash"],
              description: "The tool this prompt applies to",
            },
          },
          required: ["tool", "prompt"],
        },
      },
    },
  },
};

export const exitPlanModeHandler: ToolHandler = async (input, context) => {
  if (!context.setPermissionMode || !context.getPermissionMode) {
    throw new Error("ExitPlanMode is not available in this environment");
  }
  if (context.getPermissionMode() !== "plan") {
    return "Not in plan mode — no change made.";
  }

  const { allowedPrompts } = parseExitPlanModeInput(input);
  const planPath = context.getPlanFilePath?.();
  const planText = planPath ? await readPlanFile(planPath) : "";

  const approvedMode = context.getApprovedPermissionMode?.() ?? "default";
  context.setPermissionMode(approvedMode);
  context.setPlanFilePath?.(undefined);

  const modeNote =
    approvedMode === "bypassPermissions"
      ? "User approved — auto mode is on. Start implementing now."
      : approvedMode === "acceptEdits"
        ? "User approved — accept edits is on. Start implementing now."
        : "User approved. Start implementing now.";

  const lines = [
    `Exited plan mode. ${modeNote}`,
    "Write, Edit, and Bash are enabled again.",
  ];

  if (planPath) {
    lines.push(`Plan file: ${planPath}`);
  }
  if (planText) {
    lines.push("", "Plan contents:", planText);
  } else {
    lines.push("", "(Plan file is empty — ensure the plan was written before exiting.)");
  }

  const promptsNote = formatAllowedPromptsNote(allowedPrompts);
  if (promptsNote) {
    lines.push("", promptsNote);
  }

  return lines.join("\n");
};
