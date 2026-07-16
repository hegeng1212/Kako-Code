import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getSessionActiveAgentsPath } from "../config/paths.js";

export interface ActiveAgentPayload {
  taskId: string;
  description: string;
  prompt: string;
  subagentName: string;
  startedAt: string;
  childSessionId?: string;
}

interface ActiveAgentsFile {
  version: 1;
  agents: ActiveAgentPayload[];
}

function emptyFile(): ActiveAgentsFile {
  return { version: 1, agents: [] };
}

async function writeAtomic(path: string, data: ActiveAgentsFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  await rename(tmpPath, path);
}

export async function loadActiveAgentsFile(sessionId: string): Promise<ActiveAgentsFile> {
  const path = getSessionActiveAgentsPath(sessionId);
  try {
    const text = await readFile(path, "utf-8");
    const trimmed = text.trim();
    if (!trimmed) return emptyFile();
    const parsed = JSON.parse(trimmed) as ActiveAgentsFile;
    if (!Array.isArray(parsed.agents)) return emptyFile();
    return { version: 1, agents: parsed.agents };
  } catch {
    return emptyFile();
  }
}

export async function listActiveAgentPayloads(sessionId: string): Promise<ActiveAgentPayload[]> {
  return (await loadActiveAgentsFile(sessionId)).agents;
}

export async function upsertActiveAgentPayload(
  sessionId: string,
  payload: ActiveAgentPayload,
): Promise<void> {
  const file = await loadActiveAgentsFile(sessionId);
  const idx = file.agents.findIndex((a) => a.taskId === payload.taskId);
  if (idx === -1) file.agents.push(payload);
  else file.agents[idx] = payload;
  await writeAtomic(getSessionActiveAgentsPath(sessionId), file);
}

export async function removeActiveAgentPayload(sessionId: string, taskId: string): Promise<void> {
  const file = await loadActiveAgentsFile(sessionId);
  file.agents = file.agents.filter((a) => a.taskId !== taskId);
  await writeAtomic(getSessionActiveAgentsPath(sessionId), file);
}
