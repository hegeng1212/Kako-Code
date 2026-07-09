import type { ToolDefinition, ToolHandler } from "@kako/shared";
import type { ScheduleWakeupResult } from "../../cron/wakeup-types.js";
import {
  parseScheduleWakeupInput,
  scheduleWakeup,
} from "../../cron/wakeup-store.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_SCHEDULE_WAKEUP_DELAY_DESCRIPTION,
  CLAUDE_SCHEDULE_WAKEUP_DESCRIPTION,
  CLAUDE_SCHEDULE_WAKEUP_PROMPT_DESCRIPTION,
  CLAUDE_SCHEDULE_WAKEUP_REASON_DESCRIPTION,
} from "../claude-tool-text.js";

export const SCHEDULE_WAKEUP_DESCRIPTION = adaptClaudeCodeToolText(
  CLAUDE_SCHEDULE_WAKEUP_DESCRIPTION,
);

export const scheduleWakeupToolDefinition: ToolDefinition = {
  name: "ScheduleWakeup",
  description: SCHEDULE_WAKEUP_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      delaySeconds: {
        type: "number",
        description: CLAUDE_SCHEDULE_WAKEUP_DELAY_DESCRIPTION,
      },
      prompt: {
        type: "string",
        description: adaptClaudeCodeToolText(CLAUDE_SCHEDULE_WAKEUP_PROMPT_DESCRIPTION),
      },
      reason: {
        type: "string",
        description: CLAUDE_SCHEDULE_WAKEUP_REASON_DESCRIPTION,
      },
    },
    required: ["delaySeconds", "reason", "prompt"],
  },
};

export function formatScheduleWakeupResult(result: ScheduleWakeupResult): string {
  return JSON.stringify(result, null, 2);
}

export const scheduleWakeupHandler: ToolHandler = async (input, context) => {
  const parsed = parseScheduleWakeupInput(input);
  const wakeup = scheduleWakeup(context.sessionId, parsed);

  const result: ScheduleWakeupResult = {
    wakeupId: wakeup.id,
    delaySeconds: wakeup.delaySeconds,
    fireAt: wakeup.fireAt,
    prompt: wakeup.prompt,
    reason: wakeup.reason,
  };
  return formatScheduleWakeupResult(result);
};
