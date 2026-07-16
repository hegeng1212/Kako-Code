import type { ToolDefinition } from "@kako/shared";

/** Always serial within one agent timeline — even if metadata marks readonly. */
export const FORCE_SERIAL_TOOL_NAMES = new Set([
  "Write",
  "Edit",
  "Bash",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "TaskCreate",
  "TaskUpdate",
  "TaskStop",
  "Skill",
]);

/** Immediate-return async launchers (plus Agent spawn). */
export const ASYNC_LAUNCHER_TOOL_NAMES = new Set(["Agent", "Workflow"]);

export function isToolParallelizable(
  name: string,
  definition?: Pick<ToolDefinition, "security"> | null,
): boolean {
  if (FORCE_SERIAL_TOOL_NAMES.has(name)) return false;
  if (ASYNC_LAUNCHER_TOOL_NAMES.has(name)) return true;
  return definition?.security?.readonly === true;
}

export function partitionToolCallClusters(
  toolCalls: Array<{ name: string }>,
  resolveDef: (name: string) => Pick<ToolDefinition, "security"> | undefined,
): Array<{ parallel: boolean; indices: number[] }> {
  const parts: Array<{ parallel: boolean; indices: number[] }> = [];
  let i = 0;
  while (i < toolCalls.length) {
    const name = toolCalls[i]!.name;
    const parallel = isToolParallelizable(name, resolveDef(name));
    if (!parallel) {
      parts.push({ parallel: false, indices: [i] });
      i += 1;
      continue;
    }
    const indices = [i];
    i += 1;
    while (i < toolCalls.length) {
      const n = toolCalls[i]!.name;
      if (!isToolParallelizable(n, resolveDef(n))) break;
      indices.push(i);
      i += 1;
    }
    parts.push({ parallel: true, indices });
  }
  return parts;
}
