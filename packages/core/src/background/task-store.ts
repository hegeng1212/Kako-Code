import type { BackgroundTask, BackgroundTaskKind, TaskStopResult } from "./types.js";

const sessionTasks = new Map<string, Map<string, BackgroundTask>>();

function sessionMap(sessionId: string): Map<string, BackgroundTask> {
  let map = sessionTasks.get(sessionId);
  if (!map) {
    map = new Map();
    sessionTasks.set(sessionId, map);
  }
  return map;
}

export function registerBackgroundTask(
  sessionId: string,
  id: string,
  kind: BackgroundTaskKind,
  abort: () => void | Promise<void>,
  meta?: Pick<BackgroundTask, "description" | "subagentName" | "childSessionId" | "blocking">,
): BackgroundTask {
  const task: BackgroundTask = {
    id,
    sessionId,
    kind,
    startedAt: new Date().toISOString(),
    stopped: false,
    abort,
    ...meta,
  };
  sessionMap(sessionId).set(id, task);
  return task;
}

export function getBackgroundTask(sessionId: string, taskId: string): BackgroundTask | undefined {
  return sessionMap(sessionId).get(taskId);
}

export function listBackgroundTasks(sessionId: string): BackgroundTask[] {
  return [...sessionMap(sessionId).values()];
}

/** All registered background tasks across sessions (including stopped). */
export function listAllBackgroundTasks(): BackgroundTask[] {
  const out: BackgroundTask[] = [];
  for (const map of sessionTasks.values()) {
    out.push(...map.values());
  }
  return out;
}

/** Sessions that still have in-flight agent or workflow background work. */
export function sessionsWithRunningBackgroundWork(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const task of listAllBackgroundTasks()) {
    if (task.stopped) continue;
    if (task.kind === "agent" || task.kind === "workflow") {
      ids.add(task.sessionId);
    }
  }
  return ids;
}

export async function stopBackgroundTask(sessionId: string, taskId: string): Promise<TaskStopResult> {
  const task = getBackgroundTask(sessionId, taskId);
  if (!task) {
    return { success: false, taskId, message: `Task not found: ${taskId}` };
  }
  if (task.stopped) {
    return { success: false, taskId, message: `Task already stopped: ${taskId}` };
  }
  await task.abort();
  task.stopped = true;
  return { success: true, taskId };
}

export function completeBackgroundTask(sessionId: string, taskId: string): void {
  sessionMap(sessionId).delete(taskId);
}

/** Test-only reset. */
export function resetBackgroundTaskStore(): void {
  sessionTasks.clear();
}
