import type { AgentTaskRecord } from "./agent-notification.js";

export type AgentCompleteHandler = (record: AgentTaskRecord) => void | Promise<void>;

const handlers = new Map<string, AgentCompleteHandler>();

export function registerAgentCompleteHandler(
  sessionId: string,
  handler: AgentCompleteHandler,
): void {
  handlers.set(sessionId, handler);
}

export function unregisterAgentCompleteHandler(sessionId: string): void {
  handlers.delete(sessionId);
}

export function getAgentCompleteHandler(sessionId: string): AgentCompleteHandler | undefined {
  return handlers.get(sessionId);
}
