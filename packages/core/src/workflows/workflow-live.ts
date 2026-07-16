import type { BackgroundTask } from "../background/types.js";
import { INTERRUPTED_PROCESS_ERROR, upsertInterruptedItem } from "../background/interrupted-store.js";
import { sessionManager } from "../session/manager.js";
import { updateWorkflowRun, type WorkflowRunRecord } from "./store.js";

/** True when an in-memory workflow handle is still in flight. */
export function liveWorkflowTaskActive(task: BackgroundTask | undefined): boolean {
  return Boolean(task && task.kind === "workflow" && !task.stopped);
}

/**
 * Chat footer must not show a "running" workflow after process restart: disk may
 * still say running while no live handle exists. Elapsed time would keep ticking
 * forever even though nothing is executing.
 */
export function shouldRenderWorkflowFooter(
  primary: WorkflowRunRecord | undefined,
  liveTask: BackgroundTask | undefined,
): boolean {
  if (!primary) return false;
  if (primary.status !== "running" && primary.status !== "pending") return false;
  if (!liveWorkflowTaskActive(liveTask)) return false;
  return liveTask!.id === primary.taskId;
}

/** Persist orphan cleanup when disk says running but this process has no handle. */
export async function markOrphanWorkflowInterrupted(
  sessionId: string,
  run: Pick<
    WorkflowRunRecord,
    | "runId"
    | "taskId"
    | "name"
    | "description"
    | "scriptPath"
    | "startedAt"
    | "agentsDone"
    | "agentsTotal"
    | "currentPhase"
    | "args"
  >,
): Promise<void> {
  await updateWorkflowRun(sessionId, run.runId, {
    status: "stopped",
    completedAt: new Date().toISOString(),
    error: INTERRUPTED_PROCESS_ERROR,
  });

  await upsertInterruptedItem(sessionId, {
    id: `wf-${run.runId}`,
    kind: "workflow",
    taskId: run.taskId,
    runId: run.runId,
    name: run.name,
    description: run.description,
    scriptPath: run.scriptPath,
    args: run.args,
    status: "interrupted",
    createdAt: run.startedAt,
    interruptedAt: new Date().toISOString(),
    agentsDone: run.agentsDone,
    agentsTotal: run.agentsTotal,
    currentPhase: run.currentPhase,
  });

  const meta = await sessionManager.getSessionMeta(sessionId);
  if (meta?.agentState?.state === "working") {
    await sessionManager.updateSession(sessionId, {
      agentState: {
        state: "blocked",
        detail: "Background workflow interrupted — reopen to continue",
        tempo: "blocked",
        needs: "resume or continue",
        since: new Date().toISOString(),
      },
    });
  }
}
