import type { ToolDefinition, ToolHandler } from "@kako/shared";
import type { SessionTask, TaskListResult, TaskListSummary } from "../../tasks/types.js";
import { listTasksSortedById, openBlockedByIds } from "../../tasks/task-store.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_TASK_LIST_DESCRIPTION } from "../claude-tool-text.js";

export const TASK_LIST_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_TASK_LIST_DESCRIPTION);

export const taskListToolDefinition: ToolDefinition = {
  name: "TaskList",
  description: TASK_LIST_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
};

export function toTaskListSummary(sessionId: string, task: SessionTask): TaskListSummary {
  return {
    id: task.id,
    subject: task.subject,
    status: task.status,
    owner: task.owner ?? "",
    blockedBy: openBlockedByIds(sessionId, task),
  };
}

export function formatTaskListResult(tasks: TaskListSummary[]): string {
  const result: TaskListResult = { tasks };
  return JSON.stringify(result, null, 2);
}

export const taskListHandler: ToolHandler = async (_input, context) => {
  const tasks = listTasksSortedById(context.sessionId).map((task) =>
    toTaskListSummary(context.sessionId, task),
  );
  return formatTaskListResult(tasks);
};
