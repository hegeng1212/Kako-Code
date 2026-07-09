import type { ToolDefinition, ToolHandler } from "@kako/shared";
import type { SessionTask, TaskGetResult } from "../../tasks/types.js";
import { parseTaskGetInput, requireTask } from "../../tasks/task-store.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_TASK_GET_DESCRIPTION,
  CLAUDE_TASK_GET_TASK_ID_DESCRIPTION,
} from "../claude-tool-text.js";

export const TASK_GET_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_TASK_GET_DESCRIPTION);

export const taskGetToolDefinition: ToolDefinition = {
  name: "TaskGet",
  description: TASK_GET_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      taskId: {
        type: "string",
        description: CLAUDE_TASK_GET_TASK_ID_DESCRIPTION,
      },
    },
    required: ["taskId"],
  },
};

export function toTaskGetResult(task: SessionTask): TaskGetResult {
  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    status: task.status,
    blocks: task.blocks ?? [],
    blockedBy: task.blockedBy ?? [],
    ...(task.activeForm ? { activeForm: task.activeForm } : {}),
    ...(task.metadata ? { metadata: task.metadata } : {}),
  };
}

export function formatTaskGetResult(task: TaskGetResult): string {
  return JSON.stringify(task, null, 2);
}

export const taskGetHandler: ToolHandler = async (input, context) => {
  const taskId = parseTaskGetInput(input);
  const task = requireTask(context.sessionId, taskId);
  return formatTaskGetResult(toTaskGetResult(task));
};
