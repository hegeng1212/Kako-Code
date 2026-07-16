import { loadMemorySettings, type MemorySettings } from "../../config/memory-store.js";

export type MemoryJobName = "consolidate" | "curator" | "dreaming";

/**
 * Phase 2 job entrypoints. Phase 1: when disabled (default), return skipped.
 * Bodies intentionally empty — enable + implement in Phase 2.
 */
export async function runMemoryJob(
  name: MemoryJobName,
  settings?: MemorySettings,
): Promise<{ skipped: true; reason: "disabled" } | { skipped: false }> {
  const s = settings ?? (await loadMemorySettings());
  if (!s.jobs[name].enabled) {
    return { skipped: true, reason: "disabled" };
  }
  // Phase 2 implementations go here.
  return { skipped: false };
}
