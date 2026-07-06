import type { ToolDefinition, ToolHandler } from "@kako/shared";
import type { ToolRegistry } from "../registry.js";
import { bashHandler, bashToolDefinition } from "./bash.js";
import { monitorHandler, monitorToolDefinition } from "./monitor.js";
import {
  askUserQuestionHandler,
  askUserQuestionToolDefinition,
} from "./ask-user-question.js";
import { cronCreateHandler, cronCreateToolDefinition } from "./cron-create.js";
import { cronDeleteHandler, cronDeleteToolDefinition } from "./cron-delete.js";
import { cronListHandler, cronListToolDefinition } from "./cron-list.js";
import { skillHandler, skillToolDefinition } from "./skill.js";
import { readHandler, readToolDefinition } from "./read.js";
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
  { definition: writeToolDefinition, handler: writeHandler },
  { definition: editToolDefinition, handler: editHandler },
  { definition: notebookEditToolDefinition, handler: notebookEditHandler },
  { definition: bashToolDefinition, handler: bashHandler },
  { definition: monitorToolDefinition, handler: monitorHandler },
  { definition: askUserQuestionToolDefinition, handler: askUserQuestionHandler },
  { definition: enterPlanModeToolDefinition, handler: enterPlanModeHandler },
  { definition: exitPlanModeToolDefinition, handler: exitPlanModeHandler },
  { definition: enterWorktreeToolDefinition, handler: enterWorktreeHandler },
  { definition: exitWorktreeToolDefinition, handler: exitWorktreeHandler },
  { definition: cronCreateToolDefinition, handler: cronCreateHandler },
  { definition: cronDeleteToolDefinition, handler: cronDeleteHandler },
  { definition: cronListToolDefinition, handler: cronListHandler },
  { definition: skillToolDefinition, handler: skillHandler },
  // Glob, Grep, WebFetch, Agent, Memory — add when defined
];

/** Names of all built-in tools with implementations. */
export const DEFAULT_BUILTIN_TOOL_NAMES = BUILTIN_TOOLS.map((t) => t.definition.name);

const builtinNameSet = () => new Set(DEFAULT_BUILTIN_TOOL_NAMES);

/** Register every built-in tool implementation on the registry. */
export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const tool of BUILTIN_TOOLS) {
    registry.register(tool.definition, tool.handler);
  }
}

/**
 * All tool names registered on this registry (built-ins + connected MCP + Agent when wired).
 * Used for the top-level session agent so every LLM request exposes the full tool surface.
 */
export function resolveAllToolNames(registry: ToolRegistry): string[] {
  return registry.getDefinitions().map((d) => d.name);
}

/**
 * Resolve which tool names to pass to the model for a sub-agent.
 * `tools: ["*"]` means all registered tools minus `disallowedTools`.
 */
export function resolveAllowedToolNames(
  agentTools: string[] | undefined,
  registry: ToolRegistry,
  options?: { disallowedTools?: string[]; excludeAgent?: boolean },
): string[] {
  const available = registry.getDefinitions().map((d) => d.name);
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
