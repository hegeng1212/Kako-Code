import { getSessionMemoryDir } from "../config/paths.js";

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

export function agentFinishedTimelineLine(record: AgentTaskRecord): string {
  const desc = record.description;
  if (record.status === "error") {
    return `Agent "${desc}" failed`;
  }
  if (record.status === "stopped") {
    return `Agent "${desc}" stopped`;
  }
  return `Agent "${desc}" finished`;
}

export function agentCompletedSummary(record: AgentTaskRecord): string {
  const elapsed = formatDuration(
    (record.completedAt ? new Date(record.completedAt).getTime() : Date.now()) -
      new Date(record.startedAt).getTime(),
  );
  const line = agentFinishedTimelineLine(record);
  return `${line} · ${elapsed}`;
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
  childSessionId?: string;
}): string {
  const transcriptPath = input.childSessionId
    ? `${getSessionMemoryDir(input.childSessionId)}/transcript.jsonl`
    : "(child session pending)";
  return [
    "Async agent launched successfully.",
    `agentId: ${input.taskId}`,
    `Subagent: ${input.subagentName}`,
    "The agent is working in the background. You will receive a notification when it completes.",
    `transcript: ${transcriptPath}`,
    "Do not Read or tail this file via shell — you will be notified when the agent completes.",
  ].join("\n");
}
