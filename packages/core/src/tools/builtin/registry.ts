import type { SessionCapability, ToolDefinition, ToolHandler } from "@kako/shared";
import type { ToolRegistry } from "../registry.js";
import { isToolAllowedForCapability } from "../../security/capability.js";
import { BUILTIN_SECURITY_METADATA } from "../../security/tool-metadata.js";
import { applySecurityMetadata } from "../../security/tool-metadata.js";
import { bashHandler, bashToolDefinition } from "./bash.js";
import { monitorHandler, monitorToolDefinition } from "./monitor.js";
import { taskStopHandler, taskStopToolDefinition } from "./task-stop.js";
import {
  askUserQuestionHandler,
  askUserQuestionToolDefinition,
} from "./ask-user-question.js";
import { cronCreateHandler, cronCreateToolDefinition } from "./cron-create.js";
import { cronDeleteHandler, cronDeleteToolDefinition } from "./cron-delete.js";
import { cronListHandler, cronListToolDefinition } from "./cron-list.js";
import {
  scheduleWakeupHandler,
  scheduleWakeupToolDefinition,
} from "./schedule-wakeup.js";
import { taskCreateHandler, taskCreateToolDefinition } from "./task-create.js";
import { taskGetHandler, taskGetToolDefinition } from "./task-get.js";
import { taskListHandler, taskListToolDefinition } from "./task-list.js";
import { taskUpdateHandler, taskUpdateToolDefinition } from "./task-update.js";
import { webFetchHandler, webFetchToolDefinition } from "./web-fetch.js";
import { webSearchHandler, webSearchToolDefinition } from "./web-search.js";
import { skillHandler, skillToolDefinition } from "./skill.js";
import { workflowHandler, workflowToolDefinition } from "./workflow.js";
import { readHandler, readToolDefinition } from "./read.js";
import { grepHandler, grepToolDefinition } from "./grep.js";
import { globHandler, globToolDefinition } from "./glob.js";
import { writeHandler, writeToolDefinition } from "./write.js";
import { editHandler, editToolDefinition } from "./edit.js";
import { notebookEditHandler, notebookEditToolDefinition } from "./notebook-edit.js";
import {
  enterPlanModeHandler,
  enterPlanModeToolDefinition,
} from "./enter-plan-mode.js";
import {
  exitPlanModeHandler,
  exitPlanModeToolDefinition,
} from "./exit-plan-mode.js";
import {
  enterWorktreeHandler,
  enterWorktreeToolDefinition,
} from "./enter-worktree.js";
import {
  exitWorktreeHandler,
  exitWorktreeToolDefinition,
} from "./exit-worktree.js";
import { designSyncHandler, designSyncToolDefinition } from "./design-sync.js";
import { pushNotificationHandler, pushNotificationToolDefinition } from "./push-notification.js";
import { taskOutputHandler, taskOutputToolDefinition } from "./task-output.js";
import { CLAUDE_CODE_BUILTIN_TOOL_NAMES } from "../claude-tool-text.js";

export { CLAUDE_CODE_BUILTIN_TOOL_NAMES };

/** One built-in tool: schema for the model + runtime handler. */
export interface BuiltinTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * System default tools registered for every agent turn.
 * Append new entries here when tool definitions are finalized.
 */
export const BUILTIN_TOOLS: BuiltinTool[] = [
  { definition: readToolDefinition, handler: readHandler },
  { definition: grepToolDefinition, handler: grepHandler },
  { definition: globToolDefinition, handler: globHandler },
  { definition: writeToolDefinition, handler: writeHandler },
  { definition: editToolDefinition, handler: editHandler },
  { definition: notebookEditToolDefinition, handler: notebookEditHandler },
  { definition: bashToolDefinition, handler: bashHandler },
  { definition: monitorToolDefinition, handler: monitorHandler },
  { definition: taskOutputToolDefinition, handler: taskOutputHandler },
  { definition: taskStopToolDefinition, handler: taskStopHandler },
  { definition: askUserQuestionToolDefinition, handler: askUserQuestionHandler },
  { definition: enterPlanModeToolDefinition, handler: enterPlanModeHandler },
  { definition: exitPlanModeToolDefinition, handler: exitPlanModeHandler },
  { definition: enterWorktreeToolDefinition, handler: enterWorktreeHandler },
  { definition: exitWorktreeToolDefinition, handler: exitWorktreeHandler },
  { definition: cronCreateToolDefinition, handler: cronCreateHandler },
  { definition: cronDeleteToolDefinition, handler: cronDeleteHandler },
  { definition: cronListToolDefinition, handler: cronListHandler },
  { definition: designSyncToolDefinition, handler: designSyncHandler },
  { definition: scheduleWakeupToolDefinition, handler: scheduleWakeupHandler },
  { definition: taskCreateToolDefinition, handler: taskCreateHandler },
  { definition: taskGetToolDefinition, handler: taskGetHandler },
  { definition: taskListToolDefinition, handler: taskListHandler },
  { definition: taskUpdateToolDefinition, handler: taskUpdateHandler },
  { definition: pushNotificationToolDefinition, handler: pushNotificationHandler },
  { definition: webFetchToolDefinition, handler: webFetchHandler },
  { definition: webSearchToolDefinition, handler: webSearchHandler },
  { definition: skillToolDefinition, handler: skillHandler },
  { definition: workflowToolDefinition, handler: workflowHandler },
  // Agent is registered in createToolRegistry (needs runtime spawn host).
];

/** Names of all built-in tools with implementations. */
export const DEFAULT_BUILTIN_TOOL_NAMES = BUILTIN_TOOLS.map((t) => t.definition.name);

const builtinNameSet = () => new Set(DEFAULT_BUILTIN_TOOL_NAMES);

/** Register every built-in tool implementation on the registry. */
export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const tool of BUILTIN_TOOLS) {
    registry.register(applySecurityMetadata(tool.definition), tool.handler);
  }
}

/**
 * All tool names registered on this registry (built-ins + connected MCP + Agent when wired).
 * Used for the top-level session agent so every LLM request exposes the full tool surface.
 */
export function resolveAllToolNames(registry: ToolRegistry): string[] {
  return registry.getDefinitions().map((d) => d.name);
}

/** Built-in names allowed for a session capability (default: WorkspaceWrite). */
export function defaultBuiltinToolNamesForCapability(
  capability: SessionCapability = "WorkspaceWrite",
): string[] {
  return DEFAULT_BUILTIN_TOOL_NAMES.filter((name) =>
    isToolAllowedForCapability(
      {
        name,
        description: "",
        inputSchema: { type: "object" },
        security: BUILTIN_SECURITY_METADATA[name],
      },
      capability,
    ),
  );
}

/**
 * Resolve which tool names to pass to the model for a sub-agent.
 * `tools: ["*"]` means all registered tools minus `disallowedTools`.
 */
export function resolveAllowedToolNames(
  agentTools: string[] | undefined,
  registry: ToolRegistry,
  options?: { disallowedTools?: string[]; excludeAgent?: boolean; capability?: SessionCapability },
): string[] {
  const capability = options?.capability ?? registry.getCapability();
  const available = registry
    .getDefinitions()
    .filter((d) => isToolAllowedForCapability(d, capability))
    .map((d) => d.name);
  const disallowed = new Set(options?.disallowedTools ?? []);

  if (agentTools?.includes("*")) {
    return available.filter(
      (name) => !disallowed.has(name) && !(options?.excludeAgent && name === "Agent"),
    );
  }

  const requested = agentTools ?? DEFAULT_BUILTIN_TOOL_NAMES;
  const allowed = new Set(available);
  return requested.filter(
    (name) =>
      allowed.has(name) && !disallowed.has(name) && !(options?.excludeAgent && name === "Agent"),
  );
}

/** Lookup a built-in tool module by name (for tests and tooling). */
export function getBuiltinTool(name: string): BuiltinTool | undefined {
  return BUILTIN_TOOLS.find((t) => t.definition.name === name);
}

/** True when the agent requested a built-in that is not implemented yet. */
export function missingBuiltinToolNames(agentTools: string[] | undefined): string[] {
  const requested = agentTools ?? DEFAULT_BUILTIN_TOOL_NAMES;
  const implemented = builtinNameSet();
  return requested.filter((name) => !name.startsWith("mcp/") && !implemented.has(name));
}
