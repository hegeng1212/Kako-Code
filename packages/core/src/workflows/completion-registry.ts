import type { WorkflowRunRecord } from "./store.js";

export type WorkflowCompleteHandler = (record: WorkflowRunRecord) => void | Promise<void>;

const handlers = new Map<string, WorkflowCompleteHandler>();

export function registerWorkflowCompleteHandler(
  sessionId: string,
  handler: WorkflowCompleteHandler,
): void {
  handlers.set(sessionId, handler);
}

export function unregisterWorkflowCompleteHandler(sessionId: string): void {
  handlers.delete(sessionId);
}

export function getWorkflowCompleteHandler(sessionId: string): WorkflowCompleteHandler | undefined {
  return handlers.get(sessionId);
}
