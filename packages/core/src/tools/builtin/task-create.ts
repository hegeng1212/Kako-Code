import type { ToolDefinition, ToolHandler } from "@kako/shared";
import type { TaskCreateResult } from "../../tasks/types.js";
import { createTask, parseTaskCreateInput } from "../../tasks/task-store.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_TASK_CREATE_ACTIVE_FORM_DESCRIPTION,
  CLAUDE_TASK_CREATE_DESCRIPTION,
  CLAUDE_TASK_CREATE_DESCRIPTION_FIELD_DESCRIPTION,
  CLAUDE_TASK_CREATE_METADATA_DESCRIPTION,
  CLAUDE_TASK_CREATE_SUBJECT_DESCRIPTION,
} from "../claude-tool-text.js";

export const TASK_CREATE_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_TASK_CREATE_DESCRIPTION);

export const taskCreateToolDefinition: ToolDefinition = {
  name: "TaskCreate",
  description: TASK_CREATE_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      subject: {
        type: "string",
        description: CLAUDE_TASK_CREATE_SUBJECT_DESCRIPTION,
      },
      description: {
        type: "string",
        description: CLAUDE_TASK_CREATE_DESCRIPTION_FIELD_DESCRIPTION,
      },
      activeForm: {
        type: "string",
        description: CLAUDE_TASK_CREATE_ACTIVE_FORM_DESCRIPTION,
      },
      metadata: {
        type: "object",
        description: CLAUDE_TASK_CREATE_METADATA_DESCRIPTION,
        additionalProperties: true,
        propertyNames: { type: "string" },
      },
    },
    required: ["subject", "description"],
  },
};

export function formatTaskCreateResult(task: TaskCreateResult): string {
  return JSON.stringify(task, null, 2);
}

export function toTaskCreateResult(task: {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
}): TaskCreateResult {
  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    status: "pending",
    ...(task.activeForm ? { activeForm: task.activeForm } : {}),
    ...(task.metadata ? { metadata: task.metadata } : {}),
  };
}

export const taskCreateHandler: ToolHandler = async (input, context) => {
  const parsed = parseTaskCreateInput(input);
  const task = createTask(context.sessionId, parsed);
  return formatTaskCreateResult(toTaskCreateResult(task));
};
