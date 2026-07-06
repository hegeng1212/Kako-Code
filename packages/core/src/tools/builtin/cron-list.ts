import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { listCronJobs } from "../../cron/job-store.js";
import type { CronJob, CronListResult } from "../../cron/types.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_CRON_LIST_DESCRIPTION } from "../claude-tool-text.js";

export const CRON_LIST_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_CRON_LIST_DESCRIPTION);

export const cronListToolDefinition: ToolDefinition = {
  name: "CronList",
  description: CRON_LIST_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
};

export function formatCronListResult(jobs: CronJob[]): string {
  const result: CronListResult = {
    jobs: jobs.map(({ id, cron, prompt, recurring, durable, createdAt, expiresAt }) => ({
      id,
      cron,
      prompt,
      recurring,
      durable,
      createdAt,
      expiresAt,
    })),
  };
  return JSON.stringify(result, null, 2);
}

export const cronListHandler: ToolHandler = async (_input, context) => {
  const jobs = listCronJobs(context.sessionId);
  return formatCronListResult(jobs);
};
