import { createHash } from "node:crypto";
import type { WorkflowAgentOpts } from "./workflow-agent.js";
import { readJournalEntries, type JournalEntry } from "./journal.js";

export interface AgentCacheEntry {
  key: string;
  label: string;
  output: unknown;
}

export function agentCacheKey(prompt: string, opts: WorkflowAgentOpts = {}): string {
  const payload = JSON.stringify({
    prompt,
    label: opts.label ?? "",
    phase: opts.phase ?? "",
    schema: opts.schema ?? null,
    model: opts.model ?? "",
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export async function loadAgentResultCache(
  sessionId: string,
  resumeFromRunId: string,
): Promise<AgentCacheEntry[]> {
  const entries = await readJournalEntries(sessionId, resumeFromRunId);
  const cache: AgentCacheEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "result") continue;
    if (entry.status !== "success") continue;
    if (!entry.promptHash) continue;
    cache.push({
      key: entry.promptHash,
      label: entry.label,
      output: entry.output,
    });
  }
  return cache;
}

export class AgentResultReplayer {
  private readonly cache: AgentCacheEntry[];
  private index = 0;
  private cacheBroken = false;

  constructor(cache: AgentCacheEntry[]) {
    this.cache = cache;
  }

  tryReplay(prompt: string, opts: WorkflowAgentOpts = {}): unknown | undefined {
    if (this.cacheBroken) return undefined;
    const key = agentCacheKey(prompt, opts);
    const entry = this.cache[this.index];
    if (!entry || entry.key !== key) {
      this.cacheBroken = true;
      return undefined;
    }
    this.index++;
    return entry.output;
  }
}

export function journalHasPromptHash(entries: JournalEntry[]): boolean {
  return entries.some((entry) => entry.type === "result" && Boolean(entry.promptHash));
}
