import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { deleteCronJob } from "../../cron/job-store.js";
import type { CronDeleteResult } from "../../cron/types.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_CRON_DELETE_DESCRIPTION } from "../claude-tool-text.js";

export const CRON_DELETE_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_CRON_DELETE_DESCRIPTION);

export const cronDeleteToolDefinition: ToolDefinition = {
  name: "CronDelete",
  description: CRON_DELETE_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: {
        type: "string",
        description: "Job ID returned by CronCreate.",
      },
    },
    required: ["id"],
  },
};

export function parseCronDeleteInput(raw: Record<string, unknown>): string {
  const id = String(raw.id ?? raw.jobId ?? "").trim();
  if (!id) {
    throw new Error("CronDelete requires id");
  }
  return id;
}

export function formatCronDeleteResult(result: CronDeleteResult): string {
  return JSON.stringify(result, null, 2);
}

export const cronDeleteHandler: ToolHandler = async (input, context) => {
  const jobId = parseCronDeleteInput(input);
  const deleted = await deleteCronJob(context.sessionId, jobId);
  return formatCronDeleteResult({ jobId, deleted });
};
