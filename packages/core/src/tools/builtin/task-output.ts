import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { listBackgroundTasks } from "../../background/task-store.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_TASK_OUTPUT_BLOCK_DESCRIPTION,
  CLAUDE_TASK_OUTPUT_DESCRIPTION,
  CLAUDE_TASK_OUTPUT_TASK_ID_DESCRIPTION,
  CLAUDE_TASK_OUTPUT_TIMEOUT_DESCRIPTION,
} from "../claude-tool-text.js";

export const TASK_OUTPUT_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_TASK_OUTPUT_DESCRIPTION);

export const taskOutputToolDefinition: ToolDefinition = {
  name: "TaskOutput",
  description: TASK_OUTPUT_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      task_id: {
        type: "string",
        description: CLAUDE_TASK_OUTPUT_TASK_ID_DESCRIPTION,
      },
      block: {
        type: "boolean",
        default: true,
        description: CLAUDE_TASK_OUTPUT_BLOCK_DESCRIPTION,
      },
      timeout: {
        type: "number",
        default: 30_000,
        minimum: 0,
        maximum: 600_000,
        description: CLAUDE_TASK_OUTPUT_TIMEOUT_DESCRIPTION,
      },
    },
    required: ["task_id", "block", "timeout"],
  },
};

export interface TaskOutputInput {
  taskId: string;
  block: boolean;
  timeoutMs: number;
}

export function parseTaskOutputInput(raw: Record<string, unknown>): TaskOutputInput {
  const taskId = String(raw.task_id ?? raw.shell_id ?? "").trim();
  if (!taskId) {
    throw new Error("TaskOutput requires task_id");
  }
  const block = raw.block !== false;
  const timeoutN = Number(raw.timeout ?? 30_000);
  const timeoutMs =
    Number.isFinite(timeoutN) && timeoutN >= 0
      ? Math.min(Math.floor(timeoutN), 600_000)
      : 30_000;
  return { taskId, block, timeoutMs };
}

function formatRunningTasks(sessionId: string): string {
  const running = listBackgroundTasks(sessionId).filter((task) => !task.stopped);
  if (!running.length) return "";
  const lines = running.map((task) => `- ${task.id} (${task.kind})`).join("\n");
  return `\n\nRunning background tasks:\n${lines}`;
}

export const taskOutputHandler: ToolHandler = async (input, context) => {
  const { taskId, block, timeoutMs } = parseTaskOutputInput(input);
  const tasks = listBackgroundTasks(context.sessionId);
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(
      `Task not found: ${taskId}${formatRunningTasks(context.sessionId)}`,
    );
  }

  if (!block) {
    return JSON.stringify({
      status: task.stopped ? "stopped" : "running",
      task_id: taskId,
      kind: task.kind,
      output: "",
    });
  }

  const deadline = Date.now() + timeoutMs;
  while (!task.stopped && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return JSON.stringify({
    status: task.stopped ? "stopped" : "running",
    task_id: taskId,
    kind: task.kind,
    output: "",
    note: task.stopped
      ? "Task stopped. Read the task output file path from the <task-notification> if provided."
      : `Task still running after ${timeoutMs}ms. Use block=false or Read the output file path from the notification.`,
  });
};
