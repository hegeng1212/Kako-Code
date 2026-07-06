import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { getScheduledTasksPath } from "../config/paths.js";
import type { CronCreateInput, CronJob } from "./types.js";
import { CRON_RECURRING_TTL_MS } from "./types.js";
import { validateCronExpression } from "./validate-cron.js";

const sessionJobs = new Map<string, Map<string, CronJob>>();

interface DurableFile {
  jobs: CronJob[];
}

async function readDurableJobs(): Promise<CronJob[]> {
  try {
    const raw = await readFile(getScheduledTasksPath(), "utf-8");
    const parsed = JSON.parse(raw) as DurableFile;
    return Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

async function writeDurableJobs(jobs: CronJob[]): Promise<void> {
  const path = getScheduledTasksPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ jobs }, null, 2), "utf-8");
}

function sessionMap(sessionId: string): Map<string, CronJob> {
  let map = sessionJobs.get(sessionId);
  if (!map) {
    map = new Map();
    sessionJobs.set(sessionId, map);
  }
  return map;
}

export function parseCronCreateInput(raw: Record<string, unknown>): CronCreateInput {
  const cron = String(raw.cron ?? "").trim();
  const prompt = String(raw.prompt ?? "").trim();
  if (!prompt) {
    throw new Error("CronCreate requires prompt");
  }
  validateCronExpression(cron);
  return {
    cron,
    prompt,
    recurring: raw.recurring !== false,
    durable: raw.durable === true,
  };
}

export function createCronJob(sessionId: string, input: CronCreateInput): CronJob {
  const now = Date.now();
  const job: CronJob = {
    id: `cron-${randomUUID().slice(0, 8)}`,
    sessionId,
    cron: input.cron,
    prompt: input.prompt,
    recurring: input.recurring !== false,
    durable: input.durable === true,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CRON_RECURRING_TTL_MS).toISOString(),
  };
  sessionMap(sessionId).set(job.id, job);
  return job;
}

export async function persistCronJob(job: CronJob): Promise<void> {
  if (!job.durable) return;
  const jobs = await readDurableJobs();
  jobs.push(job);
  await writeDurableJobs(jobs);
}

export function getCronJob(sessionId: string, jobId: string): CronJob | undefined {
  return sessionMap(sessionId).get(jobId);
}

export function listCronJobs(sessionId: string): CronJob[] {
  return [...sessionMap(sessionId).values()];
}

export async function deleteCronJob(sessionId: string, jobId: string): Promise<boolean> {
  const removed = sessionMap(sessionId).delete(jobId);
  const durable = await readDurableJobs();
  const next = durable.filter((j) => !(j.id === jobId && j.sessionId === sessionId));
  if (next.length !== durable.length) {
    await writeDurableJobs(next);
    return true;
  }
  return removed;
}

/** Test-only reset. */
export function resetCronJobStore(): void {
  sessionJobs.clear();
}

export async function resetDurableCronJobs(): Promise<void> {
  await writeDurableJobs([]);
}
