import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionMeta } from "@kako/shared";
import { getKakoHome } from "@kako/core";

/** sessionId → last chat open time (epoch ms). */
export type AgentsSessionVisits = Map<string, number>;

interface AgentsSessionReadsFileV1 {
  day: string;
  sessionIds: string[];
}

interface AgentsSessionReadsFileV2 {
  version: 2;
  visits: Record<string, string>;
}

function todayKey(now = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readsPath(): string {
  return join(getKakoHome(), "memory", "agents-session-reads.json");
}

function startOfLocalDayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function readVisits(now = Date.now()): Promise<AgentsSessionVisits> {
  try {
    const raw = await readFile(readsPath(), "utf-8");
    const parsed = JSON.parse(raw) as AgentsSessionReadsFileV2 | AgentsSessionReadsFileV1;
    if (parsed && "version" in parsed && parsed.version === 2 && parsed.visits) {
      const map: AgentsSessionVisits = new Map();
      for (const [id, iso] of Object.entries(parsed.visits)) {
        const ms = Date.parse(iso);
        if (!Number.isNaN(ms)) map.set(String(id), ms);
      }
      return map;
    }
    // Legacy: sessionIds visited on a calendar day → treat as opened at that day’s start.
    if (parsed && "sessionIds" in parsed && Array.isArray(parsed.sessionIds)) {
      const day = typeof parsed.day === "string" ? parsed.day : todayKey(now);
      const [y, m, d] = day.split("-").map(Number);
      const dayStart =
        y && m && d ? new Date(y, m - 1, d).getTime() : startOfLocalDayMs(now);
      const map: AgentsSessionVisits = new Map();
      for (const id of parsed.sessionIds) {
        map.set(String(id), dayStart);
      }
      return map;
    }
  } catch {
    // Missing or corrupt — empty visits.
  }
  return new Map();
}

async function writeVisits(visits: AgentsSessionVisits): Promise<void> {
  const path = readsPath();
  await mkdir(join(getKakoHome(), "memory"), { recursive: true });
  const out: AgentsSessionReadsFileV2 = { version: 2, visits: {} };
  for (const [id, ms] of visits) {
    out.visits[id] = new Date(ms).toISOString();
  }
  await writeFile(path, `${JSON.stringify(out, null, 2)}\n`, "utf-8");
}

/** When this session entered its current Agents bucket (best-effort). */
export function agentsBucketEnteredAt(meta: SessionMeta): string {
  return meta.agentState?.since ?? meta.updatedAt;
}

export async function loadAgentsSessionVisits(now = Date.now()): Promise<AgentsSessionVisits> {
  return readVisits(now);
}

/** @deprecated Prefer loadAgentsSessionVisits. */
export async function loadAgentsReadSessionIds(now = Date.now()): Promise<Set<string>> {
  return new Set((await loadAgentsSessionVisits(now)).keys());
}

/** Mark a session as read after visiting its chat page. */
export async function markAgentsSessionRead(
  sessionId: string,
  now = Date.now(),
): Promise<AgentsSessionVisits> {
  const visits = await readVisits(now);
  visits.set(sessionId, now);
  await writeVisits(visits);
  return visits;
}

export function isAgentsSessionReadToday(
  sessionId: string,
  readToday: ReadonlySet<string> | Iterable<string>,
): boolean {
  const set = readToday instanceof Set ? readToday : new Set(readToday);
  return set.has(sessionId);
}
