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
): BackgroundTask {
  const task: BackgroundTask = {
    id,
    sessionId,
    kind,
    startedAt: new Date().toISOString(),
    stopped: false,
    abort,
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
