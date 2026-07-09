export type AgentTaskStatus = "completed" | "error" | "stopped";

export interface AgentTaskRecord {
  taskId: string;
  subagentName: string;
  description: string;
  status: AgentTaskStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
}

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${sec}s`;
}

export function agentCompletedSummary(record: AgentTaskRecord): string {
  const elapsed = formatDuration(
    (record.completedAt ? new Date(record.completedAt).getTime() : Date.now()) -
      new Date(record.startedAt).getTime(),
  );
  if (record.status === "error") {
    return `Background agent "${record.description}" failed · ${elapsed}`;
  }
  if (record.status === "stopped") {
    return `Background agent "${record.description}" stopped · ${elapsed}`;
  }
  return `Background agent "${record.description}" completed · ${elapsed}`;
}

export function buildAgentTaskNotificationMessage(record: AgentTaskRecord): string {
  const summary = agentCompletedSummary(record);
  const lines = [
    "<task-notification>",
    `<task-id>${record.taskId}</task-id>`,
    `<kind>agent</kind>`,
    `<subagent>${record.subagentName}</subagent>`,
    `<status>${record.status}</status>`,
    `<summary>${summary}</summary>`,
  ];
  if (record.error) {
    lines.push(`<error>${record.error}</error>`);
  }
  if (record.result) {
    lines.push(`<result>${record.result}</result>`);
  }
  lines.push("</task-notification>");
  return lines.join("\n");
}

export function formatBackgroundAgentLaunchResult(input: {
  taskId: string;
  description: string;
  subagentName: string;
}): string {
  return [
    "Agent launched in background.",
    `Task ID: ${input.taskId}`,
    `Subagent: ${input.subagentName}`,
    `Description: ${input.description}`,
    "",
    "You will be notified when it completes. Use TaskStop to cancel early.",
  ].join("\n");
}
