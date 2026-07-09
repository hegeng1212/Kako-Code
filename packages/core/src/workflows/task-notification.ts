import { getSessionReportsDir } from "../config/paths.js";
import type { WorkflowRunRecord } from "./store.js";

export interface WorkflowTaskNotification {
  taskId: string;
  runId: string;
  status: "completed" | "error" | "stopped";
  summary: string;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface BuildTaskNotificationOptions {
  sessionId: string;
  cwd?: string;
}

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${sec}s`;
}

export function workflowCompletedSummary(record: WorkflowRunRecord): string {
  const elapsed = formatDuration(
    (record.completedAt ? new Date(record.completedAt).getTime() : Date.now()) -
      new Date(record.startedAt).getTime(),
  );
  if (record.status === "error") {
    return `Dynamic workflow "${record.description}" failed · ${elapsed}`;
  }
  if (record.status === "stopped") {
    return `Dynamic workflow "${record.description}" stopped · ${elapsed}`;
  }
  return `Dynamic workflow "${record.description}" completed · ${elapsed}`;
}

export function toWorkflowTaskNotification(record: WorkflowRunRecord): WorkflowTaskNotification {
  const durationMs =
    (record.completedAt ? new Date(record.completedAt).getTime() : Date.now()) -
    new Date(record.startedAt).getTime();
  const status =
    record.status === "error"
      ? "error"
      : record.status === "stopped"
        ? "stopped"
        : "completed";
  return {
    taskId: record.taskId,
    runId: record.runId,
    status,
    summary: workflowCompletedSummary(record),
    result: record.result,
    error: record.error,
    durationMs,
  };
}

function buildCompletionInstructions(record: WorkflowRunRecord, reportSaveDir: string): string {
  if (record.status === "completed") {
    return [
      "The dynamic workflow finished in the background.",
      "Do NOT paste the raw <result> JSON, agent transcripts, or /workflows progress logs into the chat — the UI already shows a one-line completion event.",
      "For research/report workflows:",
      "1. Write a polished, user-facing report in the chat (executive summary first, then structured sections with citations).",
      `2. Save the same report as a markdown file under ${reportSaveDir} using Write. Pick a filename that matches the report title (slugified, .md). Create the directory if needed.`,
      "3. Mention the saved path briefly at the end.",
      "Keep the chat reply concise — no internal workflow mechanics.",
    ].join(" ");
  }
  if (record.status === "stopped") {
    return "The workflow was stopped. Acknowledge briefly; do not dump internal logs or raw JSON.";
  }
  return "The workflow failed. Explain the error briefly from <error>; do not paste raw <result> JSON or agent transcripts.";
}

export function buildTaskNotificationMessage(
  record: WorkflowRunRecord,
  opts: BuildTaskNotificationOptions,
): string {
  const notification = toWorkflowTaskNotification(record);
  const reportSaveDir = getSessionReportsDir(opts.sessionId);
  const lines = [
    "<task-notification>",
    `<task-id>${notification.taskId}</task-id>`,
    `<run-id>${notification.runId}</run-id>`,
    `<session-id>${opts.sessionId}</session-id>`,
    `<workflow-name>${record.name}</workflow-name>`,
    `<status>${notification.status}</status>`,
    `<summary>${notification.summary}</summary>`,
    `<report-save-dir>${reportSaveDir}</report-save-dir>`,
    `<transcript-dir>${record.transcriptDir}</transcript-dir>`,
  ];
  if (opts.cwd) {
    lines.push(`<cwd>${opts.cwd}</cwd>`);
  }
  if (notification.error) {
    lines.push(`<error>${notification.error}</error>`);
  }
  if (notification.result !== undefined) {
    lines.push(`<result>${JSON.stringify(notification.result)}</result>`);
  }
  lines.push(`<instructions>${buildCompletionInstructions(record, reportSaveDir)}</instructions>`);
  lines.push("</task-notification>");
  return lines.join("\n");
}
