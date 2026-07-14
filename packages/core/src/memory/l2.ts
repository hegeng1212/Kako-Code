import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionId } from "@kako/shared";
import { getMemoryDir, getSessionMemoryDir } from "../config/paths.js";

export function rollingSummaryPath(dateKey: string): string {
  return join(getMemoryDir(), "summaries", "rolling", `${dateKey}.md`);
}

export function todayDateKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Merge today's L1 summaries into L2 rolling daily note.
 */
export async function consolidateL1ToL2(options?: {
  dateKey?: string;
  sessionIds?: SessionId[];
}): Promise<{ path: string; sessions: number }> {
  const dateKey = options?.dateKey ?? todayDateKey();
  const sessionsRoot = join(getMemoryDir(), "sessions");
  let sessionIds = options?.sessionIds?.map(String) ?? [];
  if (!sessionIds.length) {
    try {
      sessionIds = await readdir(sessionsRoot);
    } catch {
      sessionIds = [];
    }
  }

  const chunks: string[] = [];
  let count = 0;
  for (const id of sessionIds) {
    try {
      const summary = await readFile(join(getSessionMemoryDir(id), "summary.md"), "utf-8");
      chunks.push(`## Session ${id}\n\n${summary.trim()}\n`);
      count++;
    } catch {
      /* skip */
    }
  }

  const dir = join(getMemoryDir(), "summaries", "rolling");
  await mkdir(dir, { recursive: true });
  const path = rollingSummaryPath(dateKey);
  const body = [`# Rolling Summary — ${dateKey}`, "", ...chunks].join("\n");
  await writeFile(path, `${body.trim()}\n`, "utf-8");
  return { path, sessions: count };
}
