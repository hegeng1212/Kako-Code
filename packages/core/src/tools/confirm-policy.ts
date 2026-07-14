import type { PermissionMode, ToolCall, ToolDefinition } from "@kako/shared";
import type { McpApprovalMode } from "@kako/shared";
import { classifyBashCommand } from "../security/bash-policy.js";
import type { SecurityPolicy } from "../security/policy-store.js";
import { bashApprovalMode } from "../security/risk-evaluator.js";

const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

/** Session task list + background task control — orchestration, not pre-approval gated. */
const TASK_TOOLS_NO_CONFIRM = new Set([
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "TaskStop",
  "TaskOutput",
]);

export function toolCallNeedsUserConfirm(
  toolCall: ToolCall,
  definition: ToolDefinition,
  mode: PermissionMode,
  policy?: SecurityPolicy,
  mcpApproval?: McpApprovalMode,
): boolean {
  /** Spawning a subagent is orchestration; child tool policy gates side effects. */
  if (toolCall.name === "Agent") return false;

  if (TASK_TOOLS_NO_CONFIRM.has(toolCall.name)) return false;

  if (mcpApproval === "never") return false;
  if (mcpApproval === "deny") return false;
  if (!definition.requiresConfirmation && !definition.security?.sideEffect) {
    if (!(toolCall.name.startsWith("mcp/") && mcpApproval === "onRequest")) {
      return false;
    }
  }
  if (mode === "bypassPermissions") return false;

  if (mode === "acceptEdits" && WRITE_TOOLS.has(toolCall.name)) {
    return false;
  }

  if (toolCall.name === "Bash" && policy) {
    const tier = classifyBashCommand(String(toolCall.input.command ?? ""));
    const approval = bashApprovalMode(policy, tier);
    return approval !== "never";
  }

  if (toolCall.name === "Bash") {
    const tier = classifyBashCommand(String(toolCall.input.command ?? ""));
    return tier !== "safe";
  }

  if (definition.security?.sideEffect) return true;

  return Boolean(definition.requiresConfirmation);
}
