import { randomUUID } from "node:crypto";
import type { ScheduleWakeupInput, ScheduledWakeup } from "./wakeup-types.js";
import {
  SCHEDULE_WAKEUP_MAX_SECONDS,
  SCHEDULE_WAKEUP_MIN_SECONDS,
} from "./wakeup-types.js";

const sessionWakeups = new Map<string, ScheduledWakeup>();

export function clampWakeupDelaySeconds(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return SCHEDULE_WAKEUP_MIN_SECONDS;
  }
  return Math.min(
    SCHEDULE_WAKEUP_MAX_SECONDS,
    Math.max(SCHEDULE_WAKEUP_MIN_SECONDS, Math.floor(n)),
  );
}

export function parseScheduleWakeupInput(raw: Record<string, unknown>): ScheduleWakeupInput {
  const prompt = String(raw.prompt ?? "").trim();
  if (!prompt) {
    throw new Error("ScheduleWakeup requires prompt");
  }
  const reason = String(raw.reason ?? "").trim();
  if (!reason) {
    throw new Error("ScheduleWakeup requires reason");
  }
  return {
    delaySeconds: clampWakeupDelaySeconds(raw.delaySeconds),
    prompt,
    reason,
  };
}

export function scheduleWakeup(sessionId: string, input: ScheduleWakeupInput): ScheduledWakeup {
  const now = Date.now();
  const wakeup: ScheduledWakeup = {
    id: `wakeup-${randomUUID().slice(0, 8)}`,
    sessionId,
    delaySeconds: input.delaySeconds,
    prompt: input.prompt,
    reason: input.reason,
    scheduledAt: new Date(now).toISOString(),
    fireAt: new Date(now + input.delaySeconds * 1000).toISOString(),
  };
  sessionWakeups.set(sessionId, wakeup);
  return wakeup;
}

export function getScheduledWakeup(sessionId: string): ScheduledWakeup | undefined {
  return sessionWakeups.get(sessionId);
}

export function clearScheduledWakeup(sessionId: string): boolean {
  return sessionWakeups.delete(sessionId);
}

/** Test-only reset. */
export function resetWakeupStore(): void {
  sessionWakeups.clear();
}
