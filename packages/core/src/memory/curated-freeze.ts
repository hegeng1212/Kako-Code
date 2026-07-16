import type { MemorySettings } from "../config/memory-store.js";
import { isCuratedEnabled } from "../config/memory-store.js";
import {
  formatCuratedSnapshot,
  loadCuratedEntries,
} from "./curated-store.js";

const freezeCache = new Map<string, string | undefined>();

/**
 * Load curated notes+user once per session id and freeze the inject string
 * for prompt-cache stability. Mid-session disk writes do not refresh this.
 */
export async function getFrozenCuratedSnapshot(
  sessionId: string,
  settings: MemorySettings,
): Promise<string | undefined> {
  if (!isCuratedEnabled(settings) || settings.curated.injectFrozenSnapshot === false) {
    return undefined;
  }
  if (freezeCache.has(sessionId)) {
    return freezeCache.get(sessionId);
  }
  const [notes, user] = await Promise.all([
    loadCuratedEntries("notes"),
    loadCuratedEntries("user"),
  ]);
  const snapshot = formatCuratedSnapshot(notes, user, settings).trim() || undefined;
  freezeCache.set(sessionId, snapshot);
  return snapshot;
}

export function clearFrozenCuratedSnapshot(sessionId: string): void {
  freezeCache.delete(sessionId);
}

/** Test helper */
export function __clearAllFrozenCuratedSnapshotsForTests(): void {
  freezeCache.clear();
}
