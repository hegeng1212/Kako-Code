import type { PermissionMode, ToolCall, ToolDefinition } from "@kako/shared";
import { isLowRiskBashCommand } from "./bash-risk.js";

const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

export function toolCallNeedsUserConfirm(
  toolCall: ToolCall,
  definition: ToolDefinition,
  mode: PermissionMode,
): boolean {
  if (!definition.requiresConfirmation) return false;
  if (mode === "bypassPermissions") return false;

  if (
    mode === "acceptEdits" &&
    WRITE_TOOLS.has(toolCall.name)
  ) {
    return false;
  }

  if (toolCall.name === "Bash") {
    const command = String(toolCall.input.command ?? "");
    return !isLowRiskBashCommand(command);
  }

  return true;
}
