import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { getSessionWorkflowRunsPath } from "../config/paths.js";

export type WorkflowRunStatus = "pending" | "running" | "completed" | "error" | "stopped";

export interface WorkflowRunRecord {
  taskId: string;
  runId: string;
  name: string;
  description: string;
  status: WorkflowRunStatus;
  scriptPath: string;
  transcriptDir: string;
  startedAt: string;
  completedAt?: string;
  /** Set when the completion notification turn was delivered into chat. */
  presentedAt?: string;
  /** Launch-time Workflow args — required to soft-resume parameterized scripts. */
  args?: unknown;
  agentsTotal: number;
  agentsDone: number;
  agentsFailed: number;
  currentPhase?: string;
  result?: unknown;
  error?: string;
}

interface WorkflowRunsFile {
  runs: WorkflowRunRecord[];
}

const sessionLocks = new Map<string, Promise<void>>();

async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  sessionLocks.set(
    sessionId,
    prev.then(() => gate),
  );
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (sessionLocks.get(sessionId) === gate) {
      sessionLocks.delete(sessionId);
    }
  }
}

export function parseRunsFileText(text: string): WorkflowRunsFile {
  const trimmed = text.trim();
  if (!trimmed) return { runs: [] };

  try {
    const parsed = JSON.parse(trimmed) as WorkflowRunsFile;
    if (!Array.isArray(parsed.runs)) return { runs: [] };
    return parsed;
  } catch {
    const recovered = recoverRunsJsonPrefix(trimmed);
    if (!recovered) return { runs: [] };
    try {
      const parsed = JSON.parse(recovered) as WorkflowRunsFile;
      if (!Array.isArray(parsed.runs)) return { runs: [] };
      return parsed;
    } catch {
      return { runs: [] };
    }
  }
}

function recoverRunsJsonPrefix(text: string): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth++;
      started = true;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (started && depth === 0) {
        return text.slice(0, i + 1);
      }
    }
  }

  return undefined;
}

async function writeRunsFileUnlocked(sessionId: string, data: WorkflowRunsFile): Promise<void> {
  const path = getSessionWorkflowRunsPath(sessionId);
  await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  const tmpPath = `${path}.tmp`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmpPath, body, "utf-8");
  await rename(tmpPath, path);
}

async function readRunsFileUnlocked(sessionId: string): Promise<WorkflowRunsFile> {
  const path = getSessionWorkflowRunsPath(sessionId);
  try {
    const text = await readFile(path, "utf-8");
    const trimmed = text.trim();
    if (!trimmed) return { runs: [] };

    const parsed = parseRunsFileText(text);
    const prefix = recoverRunsJsonPrefix(trimmed);
    if (prefix && prefix.length < trimmed.length) {
      await writeRunsFileUnlocked(sessionId, parsed);
    }
    return parsed;
  } catch {
    return { runs: [] };
  }
}

export async function loadWorkflowRuns(sessionId: string): Promise<WorkflowRunRecord[]> {
  return withSessionLock(sessionId, async () => {
    const file = await readRunsFileUnlocked(sessionId);
    return file.runs;
  });
}

export async function saveWorkflowRun(sessionId: string, run: WorkflowRunRecord): Promise<void> {
  return withSessionLock(sessionId, async () => {
    const file = await readRunsFileUnlocked(sessionId);
    file.runs.push(run);
    await writeRunsFileUnlocked(sessionId, file);
  });
}

export async function updateWorkflowRun(
  sessionId: string,
  runId: string,
  patch: Partial<WorkflowRunRecord>,
): Promise<WorkflowRunRecord | undefined> {
  return withSessionLock(sessionId, async () => {
    const file = await readRunsFileUnlocked(sessionId);
    const idx = file.runs.findIndex((r) => r.runId === runId);
    if (idx === -1) return undefined;
    const prev = file.runs[idx]!;
    const next = { ...prev, ...patch };
    // Nested workflow agent() patches share the parent run id; never let a
    // smaller local counter overwrite a larger in-flight total/done.
    if (typeof patch.agentsTotal === "number") {
      next.agentsTotal = Math.max(prev.agentsTotal, patch.agentsTotal);
    }
    if (typeof patch.agentsDone === "number") {
      next.agentsDone = Math.max(prev.agentsDone, patch.agentsDone);
    }
    if (typeof patch.agentsFailed === "number") {
      next.agentsFailed = Math.max(prev.agentsFailed ?? 0, patch.agentsFailed);
    }
    file.runs[idx] = next;
    await writeRunsFileUnlocked(sessionId, file);
    return file.runs[idx];
  });
}

export function countRunningWorkflows(runs: WorkflowRunRecord[]): number {
  return listRunningWorkflows(runs).length;
}

/** All in-flight workflows for the session (pending + running), oldest first. */
export function listRunningWorkflows(runs: WorkflowRunRecord[]): WorkflowRunRecord[] {
  return runs.filter((r) => r.status === "running" || r.status === "pending");
}

export function primaryRunningWorkflow(runs: WorkflowRunRecord[]): WorkflowRunRecord | undefined {
  return listRunningWorkflows(runs)[0];
}
