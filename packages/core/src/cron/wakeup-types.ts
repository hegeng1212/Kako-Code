export const SCHEDULE_WAKEUP_MIN_SECONDS = 60;
export const SCHEDULE_WAKEUP_MAX_SECONDS = 3600;

export const AUTONOMOUS_LOOP_DYNAMIC_SENTINEL = "<<autonomous-loop-dynamic>>";

export interface ScheduleWakeupInput {
  delaySeconds: number;
  prompt: string;
  reason: string;
}

export interface ScheduledWakeup {
  id: string;
  sessionId: string;
  delaySeconds: number;
  prompt: string;
  reason: string;
  scheduledAt: string;
  fireAt: string;
}

export interface ScheduleWakeupResult {
  wakeupId: string;
  delaySeconds: number;
  fireAt: string;
  prompt: string;
  reason: string;
}
