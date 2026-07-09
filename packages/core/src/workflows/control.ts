import { registerBackgroundTask, stopBackgroundTask } from "../background/task-store.js";
import { updateWorkflowRun } from "./store.js";

const controllers = new Map<string, AbortController>();

function key(sessionId: string, taskId: string): string {
  return `${sessionId}:${taskId}`;
}

export class WorkflowStoppedError extends Error {
  constructor(message = "Workflow stopped") {
    super(message);
    this.name = "WorkflowStoppedError";
  }
}

export function registerWorkflowAbort(
  sessionId: string,
  taskId: string,
  runId: string,
): AbortController {
  const controller = new AbortController();
  controllers.set(key(sessionId, taskId), controller);

  registerBackgroundTask(sessionId, taskId, "workflow", async () => {
    controller.abort();
    await updateWorkflowRun(sessionId, runId, {
      status: "stopped",
      completedAt: new Date().toISOString(),
      error: "Stopped by user",
    });
  });

  return controller;
}

export function getWorkflowAbortSignal(
  sessionId: string,
  taskId: string,
): AbortSignal | undefined {
  return controllers.get(key(sessionId, taskId))?.signal;
}

export function clearWorkflowAbort(sessionId: string, taskId: string): void {
  controllers.delete(key(sessionId, taskId));
}

export function assertWorkflowNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new WorkflowStoppedError();
  }
}

export async function stopWorkflowByTaskId(
  sessionId: string,
  taskId: string,
): Promise<{ success: boolean; message?: string }> {
  const result = await stopBackgroundTask(sessionId, taskId);
  clearWorkflowAbort(sessionId, taskId);
  return { success: result.success, message: result.message };
}

export async function stopWorkflowByRunId(
  sessionId: string,
  runId: string,
): Promise<{ success: boolean; message?: string }> {
  const { loadWorkflowRuns } = await import("./store.js");
  const runs = await loadWorkflowRuns(sessionId);
  const run = runs.find((r) => r.runId === runId);
  if (!run) {
    return { success: false, message: `Workflow run not found: ${runId}` };
  }
  return stopWorkflowByTaskId(sessionId, run.taskId);
}
