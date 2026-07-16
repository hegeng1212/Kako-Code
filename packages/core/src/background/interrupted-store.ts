import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getSessionInterruptedBackgroundPath } from "../config/paths.js";

export const INTERRUPTED_PROCESS_ERROR = "Interrupted: process exited";

export type InterruptedItemStatus = "interrupted" | "resuming" | "discarded";

export interface InterruptedBackgroundItemBase {
  id: string;
  taskId: string;
  status: InterruptedItemStatus;
  createdAt: string;
  interruptedAt: string;
  dismissedAt?: string;
}

export interface InterruptedWorkflowItem extends InterruptedBackgroundItemBase {
  kind: "workflow";
  runId: string;
  name: string;
  description: string;
  scriptPath: string;
  args?: unknown;
  agentsDone?: number;
  agentsTotal?: number;
  currentPhase?: string;
}

export interface InterruptedAgentItem extends InterruptedBackgroundItemBase {
  kind: "agent";
  description: string;
  prompt: string;
  subagentName: string;
  childSessionId?: string;
}

export type InterruptedBackgroundItem = InterruptedWorkflowItem | InterruptedAgentItem;

export interface InterruptedBackgroundFile {
  version: 1;
  items: InterruptedBackgroundItem[];
}

function emptyFile(): InterruptedBackgroundFile {
  return { version: 1, items: [] };
}

async function writeFileAtomic(path: string, data: InterruptedBackgroundFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  await rename(tmpPath, path);
}

export async function loadInterruptedBackground(
  sessionId: string,
): Promise<InterruptedBackgroundFile> {
  const path = getSessionInterruptedBackgroundPath(sessionId);
  try {
    const text = await readFile(path, "utf-8");
    const trimmed = text.trim();
    if (!trimmed) return emptyFile();
    const parsed = JSON.parse(trimmed) as InterruptedBackgroundFile;
    if (!Array.isArray(parsed.items)) return emptyFile();
    return { version: 1, items: parsed.items };
  } catch {
    return emptyFile();
  }
}

export async function saveInterruptedBackground(
  sessionId: string,
  file: InterruptedBackgroundFile,
): Promise<void> {
  await writeFileAtomic(getSessionInterruptedBackgroundPath(sessionId), {
    version: 1,
    items: file.items,
  });
}

function sameIdentity(a: InterruptedBackgroundItem, b: InterruptedBackgroundItem): boolean {
  if (a.id === b.id) return true;
  if (a.kind === "workflow" && b.kind === "workflow") return a.runId === b.runId;
  if (a.kind === "agent" && b.kind === "agent") return a.taskId === b.taskId;
  return false;
}

export async function upsertInterruptedItem(
  sessionId: string,
  item: InterruptedBackgroundItem,
): Promise<void> {
  const file = await loadInterruptedBackground(sessionId);
  const idx = file.items.findIndex((existing) => sameIdentity(existing, item));
  if (idx === -1) {
    file.items.push(item);
  } else {
    file.items[idx] = item;
  }
  await saveInterruptedBackground(sessionId, file);
}

export async function listResumableInterrupted(
  sessionId: string,
): Promise<InterruptedBackgroundItem[]> {
  const file = await loadInterruptedBackground(sessionId);
  return file.items.filter((item) => item.status === "interrupted");
}

export async function markInterruptedDiscarded(sessionId: string, id: string): Promise<void> {
  const file = await loadInterruptedBackground(sessionId);
  const item = file.items.find((entry) => entry.id === id);
  if (!item) return;
  item.status = "discarded";
  await saveInterruptedBackground(sessionId, file);
}

export async function removeInterruptedItem(sessionId: string, id: string): Promise<void> {
  const file = await loadInterruptedBackground(sessionId);
  file.items = file.items.filter((entry) => entry.id !== id);
  await saveInterruptedBackground(sessionId, file);
}

/** Clear checkpoints for a workflow run after soft-resume / relaunch. */
export async function removeInterruptedForWorkflowRun(
  sessionId: string,
  runId: string,
): Promise<void> {
  const file = await loadInterruptedBackground(sessionId);
  const next = file.items.filter(
    (entry) => !(entry.kind === "workflow" && entry.runId === runId),
  );
  if (next.length === file.items.length) return;
  file.items = next;
  await saveInterruptedBackground(sessionId, file);
}