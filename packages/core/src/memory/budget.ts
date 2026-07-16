import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getIndexDir } from "../config/paths.js";
import type { MemorySettings } from "../config/memory-store.js";

export type MemoryLlmJob = "backgroundReview" | "consolidate" | "curator" | "dreaming";

interface BudgetFile {
  hourKey: string;
  dayKey: string;
  hourCalls: number;
  dayCalls: number;
  byJob: Record<string, { hourCalls: number; dayCalls: number; lastAt?: string }>;
  concurrent: number;
}

function budgetPath(): string {
  return join(getIndexDir(), "memory-budget.json");
}

function hourKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
}

function dayKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
}

async function loadBudget(): Promise<BudgetFile> {
  try {
    const raw = JSON.parse(await readFile(budgetPath(), "utf-8")) as BudgetFile;
    const hk = hourKey();
    const dk = dayKey();
    if (raw.hourKey !== hk) {
      raw.hourKey = hk;
      raw.hourCalls = 0;
      for (const j of Object.values(raw.byJob ?? {})) j.hourCalls = 0;
    }
    if (raw.dayKey !== dk) {
      raw.dayKey = dk;
      raw.dayCalls = 0;
      for (const j of Object.values(raw.byJob ?? {})) j.dayCalls = 0;
    }
    raw.byJob ??= {};
    return raw;
  } catch {
    return {
      hourKey: hourKey(),
      dayKey: dayKey(),
      hourCalls: 0,
      dayCalls: 0,
      byJob: {},
      concurrent: 0,
    };
  }
}

async function saveBudget(b: BudgetFile): Promise<void> {
  await mkdir(getIndexDir(), { recursive: true });
  await writeFile(budgetPath(), `${JSON.stringify(b, null, 2)}\n`, "utf-8");
}

function jobLimits(job: MemoryLlmJob, settings: MemorySettings): {
  enabled: boolean;
  maxPerHour?: number;
  maxPerDay?: number;
  cooldownSeconds?: number;
} {
  if (job === "backgroundReview") {
    return {
      enabled: settings.backgroundReview.enabled,
      maxPerHour: settings.backgroundReview.maxPerHour,
      maxPerDay: settings.backgroundReview.maxPerDay,
      cooldownSeconds: settings.backgroundReview.cooldownSeconds,
    };
  }
  const j = settings.jobs[job];
  return { enabled: j.enabled };
}

export function canRunMemoryLlm(
  job: MemoryLlmJob,
  settings: MemorySettings,
  budget: BudgetFile,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const limits = jobLimits(job, settings);
  if (!limits.enabled) return { ok: false, reason: "disabled" };

  if (settings.budget.enabled) {
    if (budget.hourCalls >= settings.budget.maxLlmCallsPerHour) {
      return { ok: false, reason: "budget_hour" };
    }
    if (budget.dayCalls >= settings.budget.maxLlmCallsPerDay) {
      return { ok: false, reason: "budget_day" };
    }
    if (budget.concurrent >= settings.budget.maxConcurrentJobs) {
      return { ok: false, reason: "budget_concurrent" };
    }
  }

  const jobStat = budget.byJob[job] ?? { hourCalls: 0, dayCalls: 0 };
  if (limits.maxPerHour !== undefined && jobStat.hourCalls >= limits.maxPerHour) {
    return { ok: false, reason: "job_hour" };
  }
  if (limits.maxPerDay !== undefined && jobStat.dayCalls >= limits.maxPerDay) {
    return { ok: false, reason: "job_day" };
  }
  if (limits.cooldownSeconds && jobStat.lastAt) {
    const elapsed = (now - Date.parse(jobStat.lastAt)) / 1000;
    if (elapsed < limits.cooldownSeconds) {
      return { ok: false, reason: "cooldown" };
    }
  }
  return { ok: true };
}

export async function beginMemoryLlmCall(
  job: MemoryLlmJob,
  settings: MemorySettings,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const budget = await loadBudget();
  const gate = canRunMemoryLlm(job, settings, budget);
  if (!gate.ok) return gate;
  budget.concurrent += 1;
  await saveBudget(budget);
  return { ok: true };
}

export async function recordMemoryLlmCall(job: MemoryLlmJob): Promise<void> {
  const budget = await loadBudget();
  budget.hourCalls += 1;
  budget.dayCalls += 1;
  budget.concurrent = Math.max(0, budget.concurrent - 1);
  const prev = budget.byJob[job] ?? { hourCalls: 0, dayCalls: 0 };
  budget.byJob[job] = {
    hourCalls: prev.hourCalls + 1,
    dayCalls: prev.dayCalls + 1,
    lastAt: new Date().toISOString(),
  };
  await saveBudget(budget);
}

export async function releaseMemoryLlmSlot(): Promise<void> {
  const budget = await loadBudget();
  budget.concurrent = Math.max(0, budget.concurrent - 1);
  await saveBudget(budget);
}

/** Test helper */
export async function __resetMemoryBudgetForTests(): Promise<void> {
  await saveBudget({
    hourKey: hourKey(),
    dayKey: dayKey(),
    hourCalls: 0,
    dayCalls: 0,
    byJob: {},
    concurrent: 0,
  });
}
