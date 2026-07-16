import type { TranscriptMessage } from "@kako/shared";
import type { WorkflowRunRecord, WorkflowRunStatus } from "./store.js";

export function isTerminalWorkflowStatus(status: WorkflowRunStatus): boolean {
  return status === "completed" || status === "error" || status === "stopped";
}

function messageNotificationText(message: TranscriptMessage): string {
  const parts: string[] = [message.content ?? ""];
  const llmText = message.metadata?.llmText;
  if (typeof llmText === "string") parts.push(llmText);
  return parts.join("\n");
}

/** True when a completion wake already lands in L0 for this run. */
export function transcriptContainsWorkflowNotification(
  transcript: TranscriptMessage[],
  run: WorkflowRunRecord,
): boolean {
  const markers = [`<run-id>${run.runId}</run-id>`, `<task-id>${run.taskId}</task-id>`];
  for (const message of transcript) {
    const text = messageNotificationText(message);
    if (!text.includes("<task-notification>")) continue;
    if (markers.some((marker) => text.includes(marker))) return true;
  }
  return false;
}

/**
 * Terminal workflow runs whose completion notification has not yet been
 * delivered into the session transcript (and not marked presentedAt).
 *
 * Completions are only held in process memory; after crash/restart the disk
 * run may be `completed` while chat never received the present-report turn.
 *
 * `stopped` is excluded: process-exit reconcile writes interrupted checkpoints
 * for orphaned runs, and Enter-to-resume owns that path (not a completion wake).
 */
export function listUnpresentedTerminalWorkflowRuns(
  runs: WorkflowRunRecord[],
  transcript: TranscriptMessage[],
): WorkflowRunRecord[] {
  return runs.filter((run) => {
    if (run.status !== "completed" && run.status !== "error") return false;
    if (run.presentedAt) return false;
    if (transcriptContainsWorkflowNotification(transcript, run)) return false;
    return true;
  });
}

/** Terminal runs whose chat wake already exists but presentedAt was never written. */
export function listTerminalRunsNeedingPresentedHeal(
  runs: WorkflowRunRecord[],
  transcript: TranscriptMessage[],
): WorkflowRunRecord[] {
  return runs.filter((run) => {
    if (run.status !== "completed" && run.status !== "error") return false;
    if (run.presentedAt) return false;
    return transcriptContainsWorkflowNotification(transcript, run);
  });
}
