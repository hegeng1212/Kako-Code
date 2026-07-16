import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { SessionId, SessionMeta } from "@kako/shared";
import { getSessionMemoryDir, getSessionMetaPath } from "../config/paths.js";
import { coreDebug, coreDebugError } from "../debug.js";

/** Recover the first complete JSON object when concurrent writers left trailing garbage. */
export function parseSessionMetaJson(text: string): SessionMeta | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as SessionMeta;
    return typeof parsed?.id === "string" ? parsed : null;
  } catch {
    let end = trimmed.lastIndexOf("}");
    while (end > 0) {
      try {
        const parsed = JSON.parse(trimmed.slice(0, end + 1)) as SessionMeta;
        if (typeof parsed?.id === "string") return parsed;
      } catch {
        // try an earlier closing brace
      }
      end = trimmed.lastIndexOf("}", end - 1);
    }
    return null;
  }
}

function serializeSessionMeta(meta: SessionMeta): string {
  return `${JSON.stringify(meta, null, 2)}\n`;
}

export async function writeSessionMetaAtomic(
  sessionId: SessionId,
  meta: SessionMeta,
): Promise<void> {
  await mkdir(getSessionMemoryDir(sessionId), { recursive: true });
  const path = getSessionMetaPath(sessionId);
  const body = serializeSessionMeta(meta);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, body, "utf-8");
  await rename(tmp, path);
}

const metaLocks = new Map<SessionId, Promise<void>>();

/** Serialize read-modify-write for a session meta file (prevents interleaved writes). */
export async function withSessionMetaLock<T>(
  sessionId: SessionId,
  work: () => Promise<T>,
): Promise<T> {
  const previous = metaLocks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  metaLocks.set(
    sessionId,
    previous.catch(() => {}).then(() => gate),
  );

  await previous.catch(() => {});
  try {
    return await work();
  } finally {
    release();
    if (metaLocks.get(sessionId) === gate) {
      metaLocks.delete(sessionId);
    }
  }
}

export async function readSessionMeta(sessionId: SessionId): Promise<SessionMeta | null> {
  try {
    const path = getSessionMetaPath(sessionId);
    const text = await readFile(path, "utf-8");
    const parsed = parseSessionMetaJson(text);
    if (!parsed) {
      coreDebugError("session-meta:parse-failed", {
        sessionId,
        bytes: text.length,
        preview: text.slice(0, 120),
      });
      return null;
    }

    const normalized = serializeSessionMeta(parsed);
    if (text !== normalized) {
      coreDebug("session-meta:healed", {
        sessionId,
        beforeBytes: text.length,
        afterBytes: normalized.length,
      });
      await writeSessionMetaAtomic(sessionId, parsed);
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      coreDebugError("session-meta:read-error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

export async function writeSessionMeta(meta: SessionMeta): Promise<void> {
  await withSessionMetaLock(meta.id, async () => {
    await writeSessionMetaAtomic(meta.id, meta);
  });
}
