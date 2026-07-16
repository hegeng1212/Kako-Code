import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getMemoryDir } from "../config/paths.js";
import type { MemorySettings } from "../config/memory-store.js";

export type CuratedTarget = "notes" | "user";

const ENTRY_SEP = "\n§\n";

export function curatedPath(target: CuratedTarget): string {
  return join(getMemoryDir(), "curated", `${target}.md`);
}

export async function loadCuratedEntries(target: CuratedTarget): Promise<string[]> {
  try {
    const text = await readFile(curatedPath(target), "utf-8");
    return text
      .split(/\n§\n/)
      .map((e) => e.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function saveCuratedEntries(
  target: CuratedTarget,
  entries: string[],
): Promise<void> {
  const dir = join(getMemoryDir(), "curated");
  await mkdir(dir, { recursive: true });
  const body = entries.map((e) => e.trim()).filter(Boolean).join(ENTRY_SEP);
  await writeFile(curatedPath(target), body ? `${body}\n` : "", "utf-8");
}

export function curatedUsage(
  entries: string[],
  limit: number,
): { used: number; limit: number; pct: number } {
  const used = entries.reduce((n, e) => n + Buffer.byteLength(e, "utf-8"), 0);
  // Include separators approximately
  const sepCost = entries.length > 1 ? (entries.length - 1) * Buffer.byteLength(ENTRY_SEP, "utf-8") : 0;
  const total = used + sepCost;
  return {
    used: total,
    limit,
    pct: limit > 0 ? Math.min(100, Math.round((total / limit) * 100)) : 0,
  };
}

export function formatUsage(u: { used: number; limit: number }): string {
  return `${u.used}/${u.limit}`;
}

type CapResult =
  | { ok: true; entries: string[] }
  | {
      ok: false;
      error: string;
      current_entries: string[];
      usage: string;
    };

function charLimit(target: CuratedTarget, settings: MemorySettings): number {
  return target === "notes" ? settings.curated.notesCharLimit : settings.curated.userCharLimit;
}

export async function addCuratedEntry(
  target: CuratedTarget,
  content: string,
  settings: MemorySettings,
): Promise<CapResult> {
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "content is required",
      current_entries: await loadCuratedEntries(target),
      usage: formatUsage(curatedUsage([], charLimit(target, settings))),
    };
  }
  const entries = await loadCuratedEntries(target);
  if (entries.some((e) => e === trimmed)) {
    return { ok: true, entries };
  }
  const next = [...entries, trimmed];
  const limit = charLimit(target, settings);
  const usage = curatedUsage(next, limit);
  if (usage.used > limit) {
    return {
      ok: false,
      error: `Memory at ${usage.used}/${limit} chars. Adding this entry would exceed the limit. Consolidate with replace/remove, then retry.`,
      current_entries: entries,
      usage: formatUsage(usage),
    };
  }
  await saveCuratedEntries(target, next);
  return { ok: true, entries: next };
}

function findUniqueIndex(entries: string[], oldText: string): number | { error: string } {
  const needle = oldText.trim();
  if (!needle) return { error: "oldText is required" };
  const matches = entries
    .map((e, i) => (e.includes(needle) ? i : -1))
    .filter((i) => i >= 0);
  if (matches.length === 0) return { error: "no entry matched oldText" };
  if (matches.length > 1) return { error: "oldText matched multiple entries; use a narrower substring" };
  return matches[0]!;
}

export async function replaceCuratedEntry(
  target: CuratedTarget,
  oldText: string,
  content: string,
  settings: MemorySettings,
): Promise<CapResult> {
  const entries = await loadCuratedEntries(target);
  const idx = findUniqueIndex(entries, oldText);
  if (typeof idx === "object") {
    return {
      ok: false,
      error: idx.error,
      current_entries: entries,
      usage: formatUsage(curatedUsage(entries, charLimit(target, settings))),
    };
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "content is required",
      current_entries: entries,
      usage: formatUsage(curatedUsage(entries, charLimit(target, settings))),
    };
  }
  const next = [...entries];
  next[idx] = trimmed;
  const limit = charLimit(target, settings);
  const usage = curatedUsage(next, limit);
  if (usage.used > limit) {
    return {
      ok: false,
      error: `Replace would exceed limit (${usage.used}/${limit}). Shorten content or remove other entries.`,
      current_entries: entries,
      usage: formatUsage(usage),
    };
  }
  await saveCuratedEntries(target, next);
  return { ok: true, entries: next };
}

export async function removeCuratedEntry(
  target: CuratedTarget,
  oldText: string,
  settings: MemorySettings,
): Promise<CapResult> {
  const entries = await loadCuratedEntries(target);
  const idx = findUniqueIndex(entries, oldText);
  if (typeof idx === "object") {
    return {
      ok: false,
      error: idx.error,
      current_entries: entries,
      usage: formatUsage(curatedUsage(entries, charLimit(target, settings))),
    };
  }
  const next = entries.filter((_, i) => i !== idx);
  await saveCuratedEntries(target, next);
  return { ok: true, entries: next };
}

export function formatCuratedSnapshot(
  notes: string[],
  user: string[],
  settings: MemorySettings,
): string {
  const parts: string[] = [];
  const nUsage = curatedUsage(notes, settings.curated.notesCharLimit);
  const uUsage = curatedUsage(user, settings.curated.userCharLimit);
  if (notes.length) {
    parts.push(
      `## Curated Memory (notes) [${nUsage.pct}% — ${nUsage.used}/${nUsage.limit} chars]\n\n${notes.join("\n§\n")}`,
    );
  }
  if (user.length) {
    parts.push(
      `## User Profile (curated) [${uUsage.pct}% — ${uUsage.used}/${uUsage.limit} chars]\n\n${user.join("\n§\n")}`,
    );
  }
  return parts.join("\n\n");
}
