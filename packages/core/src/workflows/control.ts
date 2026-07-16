import { registerBackgroundTask, stopBackgroundTask } from "../background/task-store.js";
import { sessionManager } from "../session/manager.js";
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
  _runId: string,
): AbortController {
  const controller = new AbortController();
  controllers.set(key(sessionId, taskId), controller);

  // Abort only signals cancel. Do NOT stamp "Stopped by user" here —
  // process-exit checkpointing must still see status=running so reconcile can
  // write an interrupted (resumable) checkpoint. Explicit TaskStop writes the
  // user-stop terminal state in stopWorkflowByTaskId.
  registerBackgroundTask(sessionId, taskId, "workflow", () => {
    controller.abort();
  });

  // Persist immediately so Agents Working survives until turn-end classifier runs,
  // and so Ctrl+C leaves a recoverable agentState (reconciled on next startup).
  void sessionManager
    .updateSession(sessionId, {
      agentState: {
        state: "working",
        detail: "background workflow running",
        tempo: "active",
        since: new Date().toISOString(),
      },
    })
    .catch(() => {});

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
  if (result.success) {
    try {
      const { loadWorkflowRuns } = await import("./store.js");
      const runs = await loadWorkflowRuns(sessionId);
      const run = runs.find((entry) => entry.taskId === taskId);
      if (run && (run.status === "running" || run.status === "pending")) {
        await updateWorkflowRun(sessionId, run.runId, {
          status: "stopped",
          completedAt: new Date().toISOString(),
          error: "Stopped by user",
        });
      }
    } catch {
      // Best-effort terminal write — abort signal already delivered.
    }
  }
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
