import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  FactMergeDecision,
  MemoryFact,
  MemoryInjectCaps,
  TranscriptMessage,
} from "@kako/shared";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";
import { getMemoryDir } from "../config/paths.js";
import { estimateTextTokens } from "./tokens.js";

export function factsDir(): string {
  return join(getMemoryDir(), "facts");
}

export function factsIndexPath(): string {
  return join(factsDir(), "facts.index.json");
}

interface FactsIndex {
  facts: Array<{ id: string; path: string; updatedAt: string }>;
}

async function loadIndex(): Promise<FactsIndex> {
  try {
    const raw = await readFile(factsIndexPath(), "utf-8");
    const parsed = JSON.parse(raw) as FactsIndex;
    if (!parsed?.facts || !Array.isArray(parsed.facts)) return { facts: [] };
    return parsed;
  } catch {
    return { facts: [] };
  }
}

async function saveIndex(index: FactsIndex): Promise<void> {
  await mkdir(factsDir(), { recursive: true });
  await writeFile(factsIndexPath(), `${JSON.stringify(index, null, 2)}\n`, "utf-8");
}

function factFilePath(id: string): string {
  return join(factsDir(), `${id}.md`);
}

export function formatFactMarkdown(fact: MemoryFact): string {
  return [
    "---",
    `id: ${fact.id}`,
    `confidence: ${fact.confidence}`,
    `source: ${fact.source}`,
    `valid_from: ${fact.validFrom ?? "null"}`,
    `valid_to: ${fact.validTo ?? "null"}`,
    `created_at: ${fact.createdAt}`,
    `updated_at: ${fact.updatedAt}`,
    "---",
    "",
    fact.content.trim(),
    "",
  ].join("\n");
}

export function parseFactMarkdown(text: string, fallbackId: string): MemoryFact | null {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]!] = kv[2]!.trim();
  }
  const content = (m[2] ?? "").trim();
  if (!content) return null;
  const confidence = Number(meta.confidence ?? "0.5");
  return {
    id: meta.id || fallbackId,
    content,
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    source: meta.source || "unknown",
    validFrom: meta.valid_from && meta.valid_from !== "null" ? meta.valid_from : undefined,
    validTo: meta.valid_to && meta.valid_to !== "null" ? meta.valid_to : undefined,
    createdAt: meta.created_at || new Date().toISOString(),
    updatedAt: meta.updated_at || new Date().toISOString(),
  };
}

export async function listFacts(): Promise<MemoryFact[]> {
  const index = await loadIndex();
  const facts: MemoryFact[] = [];
  for (const entry of index.facts) {
    try {
      const text = await readFile(entry.path, "utf-8");
      const fact = parseFactMarkdown(text, entry.id);
      if (fact) facts.push(fact);
    } catch {
      // missing file
    }
  }
  return facts;
}

export async function writeFact(fact: MemoryFact): Promise<void> {
  await mkdir(factsDir(), { recursive: true });
  const path = factFilePath(fact.id);
  await writeFile(path, formatFactMarkdown(fact), "utf-8");
  const index = await loadIndex();
  const without = index.facts.filter((f) => f.id !== fact.id);
  without.push({ id: fact.id, path, updatedAt: fact.updatedAt });
  await saveIndex({ facts: without });
}

export async function deleteFact(factId: string): Promise<void> {
  const path = factFilePath(factId);
  try {
    await unlink(path);
  } catch {
    // already gone
  }
  const index = await loadIndex();
  await saveIndex({ facts: index.facts.filter((f) => f.id !== factId) });
}

/**
 * Apply mem0-style merge decisions to the facts store.
 */
export async function applyFactDecisions(decisions: FactMergeDecision[]): Promise<void> {
  for (const d of decisions) {
    if (d.action === "NOOP") continue;
    if (d.action === "DELETE" && d.factId) {
      await deleteFact(d.factId);
      continue;
    }
    if (d.action === "UPDATE" && d.factId && d.content) {
      const existing = (await listFacts()).find((f) => f.id === d.factId);
      const now = new Date().toISOString();
      await writeFact({
        id: d.factId,
        content: d.content,
        confidence: d.confidence ?? existing?.confidence ?? 0.7,
        source: existing?.source ?? "extract",
        validFrom: existing?.validFrom,
        validTo: existing?.validTo,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      continue;
    }
    if (d.action === "ADD" && d.content) {
      const now = new Date().toISOString();
      await writeFact({
        id: d.factId ?? `fact-${randomUUID().slice(0, 8)}`,
        content: d.content,
        confidence: d.confidence ?? 0.7,
        source: "extract",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

/**
 * Deterministic fact extraction from durable assistant/user statements.
 * Does not use semantic intent classifiers — emits ADD when content is new,
 * NOOP when an identical fact already exists.
 */
export async function extractFactsFromTranscript(
  transcript: TranscriptMessage[],
): Promise<FactMergeDecision[]> {
  const existing = await listFacts();
  const existingContents = new Set(existing.map((f) => f.content.trim().toLowerCase()));
  const decisions: FactMergeDecision[] = [];
  const candidates = collectFactCandidates(transcript);

  for (const content of candidates) {
    const key = content.toLowerCase();
    if (existingContents.has(key)) {
      decisions.push({ action: "NOOP", content, reason: "identical fact exists" });
      continue;
    }
    decisions.push({
      action: "ADD",
      content,
      confidence: 0.6,
      reason: "new durable statement from transcript",
    });
    existingContents.add(key);
  }
  return decisions;
}

function collectFactCandidates(transcript: TranscriptMessage[]): string[] {
  const out: string[] = [];
  for (const msg of transcript) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = msg.content.trim();
    // Prefer short durable-looking lines (length budget only — not keyword intent).
    if (text.length < 20 || text.length > 280) continue;
    if (text.includes("\n")) continue;
    out.push(text);
    if (out.length >= 12) break;
  }
  return out;
}

/** Cap L3 excerpts for bootstrap inject. */
export function formatFactsExcerpt(
  facts: MemoryFact[],
  caps: MemoryInjectCaps = DEFAULT_MEMORY_INJECT_CAPS,
): string {
  const lines: string[] = [];
  let tokens = 0;
  for (const fact of facts) {
    const line = `- ${fact.content}`;
    const cost = estimateTextTokens(line);
    if (tokens + cost > caps.l3FactsMaxTokens) break;
    lines.push(line);
    tokens += cost;
  }
  return lines.join("\n");
}

export async function loadUserProfile(): Promise<string | undefined> {
  try {
    const text = await readFile(join(getMemoryDir(), "profile", "user.md"), "utf-8");
    return text.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function ensureUserProfileScaffold(): Promise<void> {
  const dir = join(getMemoryDir(), "profile");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "user.md");
  try {
    await readFile(path, "utf-8");
  } catch {
    await writeFile(
      path,
      "# User Profile\n\n(Preferences and durable user context.)\n",
      "utf-8",
    );
  }
}

export async function listFactFiles(): Promise<string[]> {
  try {
    const files = await readdir(factsDir());
    return files.filter((f) => f.endsWith(".md")).map((f) => join(factsDir(), f));
  } catch {
    return [];
  }
}
