import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_ENTER_PLAN_MODE_DESCRIPTION } from "../claude-tool-text.js";
import { ensurePlanFile } from "./plan-mode-shared.js";

export const ENTER_PLAN_MODE_DESCRIPTION = adaptClaudeCodeToolText(
  CLAUDE_ENTER_PLAN_MODE_DESCRIPTION,
);

export const enterPlanModeToolDefinition: ToolDefinition = {
  name: "EnterPlanMode",
  description: ENTER_PLAN_MODE_DESCRIPTION,
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
};

export const enterPlanModeHandler: ToolHandler = async (_input, context) => {
  if (!context.setPermissionMode || !context.getPermissionMode) {
    throw new Error("EnterPlanMode is not available in this environment");
  }
  if (context.getPermissionMode() === "plan") {
    const existing = context.getPlanFilePath?.();
    return existing
      ? `Already in plan mode. Plan file: ${existing}`
      : "Already in plan mode. Write, Edit (plan file only), and Bash remain restricted until ExitPlanMode.";
  }

  const planPath = await ensurePlanFile(context.sessionId);
  context.setPlanFilePath?.(planPath);
  context.setPermissionMode("plan");

  return [
    "Entered plan mode.",
    `Plan file: ${planPath}`,
    "Write your complete implementation plan to this file with Write before calling ExitPlanMode.",
    "Bash is disabled. Read/search tools and AskUserQuestion remain available.",
  ].join(" ");
};
