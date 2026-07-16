import { sessionManager } from "../session/manager.js";
import { loadWorkflowRuns, updateWorkflowRun } from "../workflows/store.js";
import {
  completeBackgroundTask,
  getBackgroundTask,
  listAllBackgroundTasks,
} from "./task-store.js";
import {
  listActiveAgentPayloads,
  removeActiveAgentPayload,
} from "./agent-persist.js";
import {
  INTERRUPTED_PROCESS_ERROR,
  listResumableInterrupted,
  upsertInterruptedItem,
} from "./interrupted-store.js";

export interface ReconcileStaleBackgroundWorkResult {
  stoppedRuns: number;
  demotedSessions: number;
  checkpointed: number;
}

async function ensureSessionNeedsInput(
  sessionId: string,
  detail: string,
  options?: { reviveEnded?: boolean },
): Promise<boolean> {
  const meta = await sessionManager.getSessionMeta(sessionId);
  if (!meta) return false;
  const revive = options?.reviveEnded === true && meta.status === "ended";
  const alreadyBlocked = meta.agentState?.state === "blocked";
  if (alreadyBlocked && !revive) return false;

  await sessionManager.updateSession(sessionId, {
    ...(revive ? { status: "active" as const } : {}),
    agentState: {
      state: "blocked",
      detail: alreadyBlocked ? (meta.agentState?.detail ?? detail) : detail,
      tempo: "blocked",
      needs: meta.agentState?.needs ?? "resume or continue",
      since: new Date().toISOString(),
    },
  });
  return true;
}

/**
 * Background agent/workflow handles live only in process memory.
 * After Ctrl+C / crash, disk may still say `running` and agentState may still
 * say `working` — which is false. Demote those and write interrupted checkpoints
 * so the session can offer resume-from-approval.
 */
export async function reconcileStaleBackgroundWork(): Promise<ReconcileStaleBackgroundWorkResult> {
  const metas = await sessionManager.listSessionMetas({ limit: 500 });
  let stoppedRuns = 0;
  let demotedSessions = 0;
  let checkpointed = 0;

  for (const meta of metas) {
    const runs = await loadWorkflowRuns(meta.id);
    let stoppedHere = false;
    for (const run of runs) {
      if (run.status !== "running" && run.status !== "pending") continue;
      const live = getBackgroundTask(meta.id, run.taskId);
      if (live && !live.stopped && live.kind === "workflow") continue;

      await updateWorkflowRun(meta.id, run.runId, {
        status: "stopped",
        completedAt: new Date().toISOString(),
        error: INTERRUPTED_PROCESS_ERROR,
      });
      await upsertInterruptedItem(meta.id, {
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
      stoppedRuns += 1;
      checkpointed += 1;
      stoppedHere = true;
    }

    const activeAgents = await listActiveAgentPayloads(meta.id);
    for (const payload of activeAgents) {
      const live = getBackgroundTask(meta.id, payload.taskId);
      if (live && !live.stopped && live.kind === "agent") continue;

      await upsertInterruptedItem(meta.id, {
        id: `ag-${payload.taskId}`,
        kind: "agent",
        taskId: payload.taskId,
        description: payload.description,
        prompt: payload.prompt,
        subagentName: payload.subagentName,
        childSessionId: payload.childSessionId,
        status: "interrupted",
        createdAt: payload.startedAt,
        interruptedAt: new Date().toISOString(),
      });
      await removeActiveAgentPayload(meta.id, payload.taskId);
      checkpointed += 1;
      stoppedHere = true;
    }

    const unpresentedTerminal = runs.some(
      (run) =>
        (run.status === "completed" || run.status === "error") && !run.presentedAt,
    );

    if (stoppedHere || meta.agentState?.state === "working") {
      const detail = stoppedHere
        ? "Background workflow interrupted — reopen to continue"
        : unpresentedTerminal
          ? "workflow finished — open to present report"
          : "Background work interrupted — reopen to continue";
      if (await ensureSessionNeedsInput(meta.id, detail, { reviveEnded: stoppedHere })) {
        demotedSessions += 1;
      }
    } else if (
      meta.status === "ended" &&
      (await listResumableInterrupted(meta.id)).length > 0
    ) {
      // Prior quit ended the session before checkpoints were reconciled.
      if (
        await ensureSessionNeedsInput(meta.id, "Interrupted background work — reopen to continue", {
          reviveEnded: true,
        })
      ) {
        demotedSessions += 1;
      }
    }
  }

  return { stoppedRuns, demotedSessions, checkpointed };
}

/**
 * Graceful Ctrl+C / process exit: drop in-memory live handles so disk orphans are
 * checkpointed immediately (do not wait for the next launch).
 */
export async function checkpointBackgroundWorkForProcessExit(): Promise<ReconcileStaleBackgroundWorkResult> {
  for (const task of listAllBackgroundTasks()) {
    if (task.stopped) continue;
    if (task.kind !== "agent" && task.kind !== "workflow") continue;
    try {
      // Signal-only abort (workflow/agent). Must not mark the disk run
      // "Stopped by user" — that would skip interrupted checkpoint creation.
      await Promise.resolve(task.abort());
    } catch {
      // Best-effort — exit must not hang on abort.
    }
    task.stopped = true;
    completeBackgroundTask(task.sessionId, task.id);
  }
  return reconcileStaleBackgroundWork();
}
