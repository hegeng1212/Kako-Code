import type { ToolDefinition, ToolHandler } from "@kako/shared";
import type { CronCreateResult } from "../../cron/types.js";
import {
  createCronJob,
  parseCronCreateInput,
  persistCronJob,
} from "../../cron/job-store.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_CRON_CREATE_DESCRIPTION,
  CLAUDE_CRON_CREATE_DURABLE_DESCRIPTION,
} from "../claude-tool-text.js";

export const CRON_CREATE_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_CRON_CREATE_DESCRIPTION);

export const cronCreateToolDefinition: ToolDefinition = {
  name: "CronCreate",
  description: CRON_CREATE_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      cron: {
        type: "string",
        description:
          'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once).',
      },
      durable: {
        type: "boolean",
        description: adaptClaudeCodeToolText(CLAUDE_CRON_CREATE_DURABLE_DESCRIPTION),
      },
      prompt: {
        type: "string",
        description: "The prompt to enqueue at each fire time.",
      },
      recurring: {
        type: "boolean",
        description:
          'true (default) = fire on every cron match until deleted or auto-expired after 7 days. false = fire once at the next match, then auto-delete. Use false for "remind me at X" one-shot requests with pinned minute/hour/dom/month.',
      },
    },
    required: ["cron", "prompt"],
  },
};

export function formatCronCreateResult(result: CronCreateResult): string {
  return JSON.stringify(result, null, 2);
}

export const cronCreateHandler: ToolHandler = async (input, context) => {
  const parsed = parseCronCreateInput(input);
  const job = createCronJob(context.sessionId, parsed);
  await persistCronJob(job);

  const result: CronCreateResult = {
    jobId: job.id,
    cron: job.cron,
    prompt: job.prompt,
    recurring: job.recurring,
    durable: job.durable,
    expiresAt: job.expiresAt,
  };
  return formatCronCreateResult(result);
};
