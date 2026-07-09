import type { ToolDefinition, ToolHandler } from "@kako/shared";
import type { TaskDeleteResult } from "../../tasks/types.js";
import { parseTaskUpdateInput, updateTask } from "../../tasks/task-store.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_TASK_UPDATE_ACTIVE_FORM_DESCRIPTION,
  CLAUDE_TASK_UPDATE_ADD_BLOCKED_BY_DESCRIPTION,
  CLAUDE_TASK_UPDATE_ADD_BLOCKS_DESCRIPTION,
  CLAUDE_TASK_UPDATE_DESCRIPTION,
  CLAUDE_TASK_UPDATE_DESCRIPTION_FIELD_DESCRIPTION,
  CLAUDE_TASK_UPDATE_METADATA_DESCRIPTION,
  CLAUDE_TASK_UPDATE_OWNER_DESCRIPTION,
  CLAUDE_TASK_UPDATE_STATUS_DESCRIPTION,
  CLAUDE_TASK_UPDATE_SUBJECT_DESCRIPTION,
  CLAUDE_TASK_UPDATE_TASK_ID_DESCRIPTION,
} from "../claude-tool-text.js";
import { formatTaskGetResult, toTaskGetResult } from "./task-get.js";

export const TASK_UPDATE_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_TASK_UPDATE_DESCRIPTION);

export const taskUpdateToolDefinition: ToolDefinition = {
  name: "TaskUpdate",
  description: TASK_UPDATE_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      taskId: {
        type: "string",
        description: CLAUDE_TASK_UPDATE_TASK_ID_DESCRIPTION,
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "deleted"],
        description: CLAUDE_TASK_UPDATE_STATUS_DESCRIPTION,
      },
      subject: {
        type: "string",
        description: CLAUDE_TASK_UPDATE_SUBJECT_DESCRIPTION,
      },
      description: {
        type: "string",
        description: CLAUDE_TASK_UPDATE_DESCRIPTION_FIELD_DESCRIPTION,
      },
      activeForm: {
        type: "string",
        description: CLAUDE_TASK_UPDATE_ACTIVE_FORM_DESCRIPTION,
      },
      owner: {
        type: "string",
        description: CLAUDE_TASK_UPDATE_OWNER_DESCRIPTION,
      },
      metadata: {
        type: "object",
        description: CLAUDE_TASK_UPDATE_METADATA_DESCRIPTION,
        additionalProperties: true,
        propertyNames: { type: "string" },
      },
      addBlocks: {
        type: "array",
        items: { type: "string" },
        description: CLAUDE_TASK_UPDATE_ADD_BLOCKS_DESCRIPTION,
      },
      addBlockedBy: {
        type: "array",
        items: { type: "string" },
        description: CLAUDE_TASK_UPDATE_ADD_BLOCKED_BY_DESCRIPTION,
      },
    },
    required: ["taskId"],
  },
};

export function formatTaskUpdateResult(result: ReturnType<typeof toTaskGetResult> | TaskDeleteResult): string {
  return JSON.stringify(result, null, 2);
}

export const taskUpdateHandler: ToolHandler = async (input, context) => {
  const parsed = parseTaskUpdateInput(input);
  const result = updateTask(context.sessionId, parsed);
  if ("deleted" in result) {
    return formatTaskUpdateResult(result);
  }
  return formatTaskUpdateResult(toTaskGetResult(result));
};
