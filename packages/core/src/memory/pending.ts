import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getMemoryDir } from "../config/paths.js";
import type { MemorySettings } from "../config/memory-store.js";
import {
  addCuratedEntry,
  type CuratedTarget,
  removeCuratedEntry,
  replaceCuratedEntry,
} from "./curated-store.js";
import { applyFactDecisions } from "./facts.js";
import type { FactMergeDecision } from "@kako/shared";

export type PendingMemoryOp =
  | {
      kind: "curated";
      target: CuratedTarget;
      action: "add" | "replace" | "remove";
      content?: string;
      oldText?: string;
    }
  | {
      kind: "facts";
      decisions: FactMergeDecision[];
    };

export interface PendingMemoryWrite {
  id: string;
  createdAt: string;
  source: string;
  ops: PendingMemoryOp[];
}

function pendingDir(): string {
  return join(getMemoryDir(), "pending");
}

function pendingPath(id: string): string {
  return join(pendingDir(), `${id}.json`);
}

export async function stageMemoryWrite(
  ops: PendingMemoryOp[],
  source = "backgroundReview",
): Promise<string> {
  await mkdir(pendingDir(), { recursive: true });
  const id = randomUUID().slice(0, 12);
  const record: PendingMemoryWrite = {
    id,
    createdAt: new Date().toISOString(),
    source,
    ops,
  };
  await writeFile(pendingPath(id), `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  return id;
}

export async function listPendingMemoryWrites(): Promise<PendingMemoryWrite[]> {
  try {
    const files = (await readdir(pendingDir())).filter((f) => f.endsWith(".json"));
    const out: PendingMemoryWrite[] = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(await readFile(join(pendingDir(), file), "utf-8")) as PendingMemoryWrite;
        if (raw?.id && Array.isArray(raw.ops)) out.push(raw);
      } catch {
        // skip corrupt
      }
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

async function applyOps(ops: PendingMemoryOp[], settings: MemorySettings): Promise<void> {
  for (const op of ops) {
    if (op.kind === "facts") {
      await applyFactDecisions(op.decisions);
      continue;
    }
    if (op.action === "add" && op.content) {
      await addCuratedEntry(op.target, op.content, settings);
    } else if (op.action === "replace" && op.oldText && op.content) {
      await replaceCuratedEntry(op.target, op.oldText, op.content, settings);
    } else if (op.action === "remove" && op.oldText) {
      await removeCuratedEntry(op.target, op.oldText, settings);
    }
  }
}

export async function approvePendingMemoryWrite(
  id: string,
  settings: MemorySettings,
): Promise<void> {
  const text = await readFile(pendingPath(id), "utf-8");
  const record = JSON.parse(text) as PendingMemoryWrite;
  await applyOps(record.ops, settings);
  await unlink(pendingPath(id)).catch(() => {});
}

export async function rejectPendingMemoryWrite(id: string): Promise<void> {
  await unlink(pendingPath(id)).catch(() => {});
}
