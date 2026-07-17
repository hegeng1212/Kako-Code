import type { ToolConfirmResult } from "@kako/shared";

const TURN_ABORT_DENIAL: ToolConfirmResult = {
  allowed: false,
  denialReason: "Interrupted by user",
};

/**
 * If the turn is cancelled while a confirm UI is awaiting (or its Promise was
 * orphaned by a parallel overwrite), settle as denied so the agent loop can
 * observe shouldAbort instead of hanging forever.
 */
export async function raceToolConfirmWithTurnAbort(
  confirm: () => Promise<ToolConfirmResult>,
  isTurnAborted: () => boolean,
  options?: {
    pollMs?: number;
    /** Called once when abort wins — e.g. deny the visible approval panel. */
    onAbort?: () => void;
  },
): Promise<ToolConfirmResult> {
  if (isTurnAborted()) return { ...TURN_ABORT_DENIAL };

  const pollMs = options?.pollMs ?? 50;
  let settled = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  const abortWatch = new Promise<ToolConfirmResult>((resolve) => {
    interval = setInterval(() => {
      if (settled) return;
      if (!isTurnAborted()) return;
      settled = true;
      if (interval) clearInterval(interval);
      options?.onAbort?.();
      resolve({ ...TURN_ABORT_DENIAL });
    }, pollMs);
  });

  try {
    const result = await Promise.race([confirm(), abortWatch]);
    settled = true;
    return result;
  } finally {
    settled = true;
    if (interval) clearInterval(interval);
  }
}
