export type BackgroundTaskKind = "monitor" | "bash" | "agent" | "workflow";

export interface BackgroundTask {
  id: string;
  sessionId: string;
  kind: BackgroundTaskKind;
  startedAt: string;
  stopped: boolean;
  abort: () => void | Promise<void>;
  description?: string;
  subagentName?: string;
  childSessionId?: string;
}

export interface TaskStopResult {
  success: boolean;
  taskId: string;
  message?: string;
}
