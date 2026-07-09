import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getKakoHome } from "@kako/core";

export const STANDARD_HEADER_AFTER_IDLE_MS = 3 * 24 * 60 * 60 * 1000;

export type ChatHeaderMode = "standard" | "mini";

export interface CliUsageState {
  lastLaunchAt?: string;
}

export function getCliUsagePath(): string {
  return join(getKakoHome(), "config", "cli-usage.json");
}

export async function loadCliUsage(): Promise<CliUsageState> {
  try {
    const text = await readFile(getCliUsagePath(), "utf-8");
    return JSON.parse(text) as CliUsageState;
  } catch {
    return {};
  }
}

export async function recordCliLaunch(now = new Date()): Promise<void> {
  const path = getCliUsagePath();
  await mkdir(dirname(path), { recursive: true });
  const state: CliUsageState = { lastLaunchAt: now.toISOString() };
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export function resolveChatHeaderMode(usage: CliUsageState, now = new Date()): ChatHeaderMode {
  if (!usage.lastLaunchAt) return "standard";
  const last = new Date(usage.lastLaunchAt).getTime();
  if (!Number.isFinite(last)) return "standard";
  if (now.getTime() - last >= STANDARD_HEADER_AFTER_IDLE_MS) return "standard";
  return "mini";
}
