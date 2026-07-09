import type { ToolDefinition, ToolHandler } from "@kako/shared";
import type { TaskStopResult } from "../../background/types.js";
import { stopBackgroundTask } from "../../background/task-store.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_TASK_STOP_DESCRIPTION,
  CLAUDE_TASK_STOP_SHELL_ID_DESCRIPTION,
  CLAUDE_TASK_STOP_TASK_ID_DESCRIPTION,
} from "../claude-tool-text.js";

export const TASK_STOP_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_TASK_STOP_DESCRIPTION);

export const taskStopToolDefinition: ToolDefinition = {
  name: "TaskStop",
  description: TASK_STOP_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      task_id: {
        type: "string",
        description: CLAUDE_TASK_STOP_TASK_ID_DESCRIPTION,
      },
      shell_id: {
        type: "string",
        description: CLAUDE_TASK_STOP_SHELL_ID_DESCRIPTION,
      },
    },
  },
};

export function parseTaskStopInput(raw: Record<string, unknown>): string {
  const taskId = String(raw.task_id ?? raw.shell_id ?? "").trim();
  if (!taskId) {
    throw new Error("TaskStop requires task_id");
  }
  return taskId;
}

export function formatTaskStopResult(result: TaskStopResult): string {
  return JSON.stringify(result, null, 2);
}

export const taskStopHandler: ToolHandler = async (input, context) => {
  const taskId = parseTaskStopInput(input);
  const result = await stopBackgroundTask(context.sessionId, taskId);
  return formatTaskStopResult(result);
};
