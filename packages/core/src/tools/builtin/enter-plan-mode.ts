import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_ENTER_PLAN_MODE_DESCRIPTION } from "../claude-tool-text.js";
import { enterPlanModeSession } from "./plan-mode-enter.js";

export const ENTER_PLAN_MODE_DESCRIPTION = adaptClaudeCodeToolText(
  CLAUDE_ENTER_PLAN_MODE_DESCRIPTION,
);

export const enterPlanModeToolDefinition: ToolDefinition = {
  name: "EnterPlanMode",
  description: ENTER_PLAN_MODE_DESCRIPTION,
  // Entering plan mode is a UX mode switch (like /plan). Real approval is ExitPlanMode.
  requiresConfirmation: false,
  inputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {},
  },
};

export const enterPlanModeHandler: ToolHandler = async (_input, context) => {
  const setPermissionMode = context.setPermissionMode;
  const getPermissionMode = context.getPermissionMode;
  if (!setPermissionMode || !getPermissionMode) {
    throw new Error("EnterPlanMode is not available in this environment");
  }

  const { entered, planPath } = await enterPlanModeSession({
    sessionId: context.sessionId,
    currentMode: getPermissionMode(),
    setPermissionMode: (mode, path) => {
      context.setPlanFilePath?.(path);
      setPermissionMode(mode);
    },
  });

  if (!entered) {
    return `Already in plan mode. Plan file: ${planPath}`;
  }

  return [
    "Entered plan mode.",
    `Plan file: ${planPath}`,
    "Write your complete implementation plan to this file with Write before calling ExitPlanMode.",
    "Bash is disabled. Read/search tools and AskUserQuestion remain available.",
  ].join(" ");
};
