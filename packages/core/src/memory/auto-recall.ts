import type { MemoryInjectCaps, SearchHit, SessionId } from "@kako/shared";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";
import { searchMemoryFts } from "./index-fts.js";
import { estimateTextTokens } from "./tokens.js";

export interface AutoRecallOptions {
  query: string;
  sessionId?: SessionId;
  enabled?: boolean;
  caps?: MemoryInjectCaps;
  crossSession?: boolean;
}

/**
 * Bounded auto-recall for the current user turn.
 * Hard-caps snippets and tokens; never dumps full L0.
 */
export function runAutoRecall(options: AutoRecallOptions): {
  hits: SearchHit[];
  formatted: string;
  injectedSnippets: number;
  injectedTokens: number;
} {
  if (options.enabled === false) {
    return { hits: [], formatted: "", injectedSnippets: 0, injectedTokens: 0 };
  }
  const caps = options.caps ?? DEFAULT_MEMORY_INJECT_CAPS;
  const query = options.query.trim();
  if (!query) return { hits: [], formatted: "", injectedSnippets: 0, injectedTokens: 0 };

  const hits = searchMemoryFts(
    {
      query,
      sessionId: options.sessionId,
      crossSession: options.crossSession ?? true,
      limit: caps.autoRecallMaxSnippets,
      layers: ["L1", "L2", "L3", "L5"],
    },
    caps,
  );

  const selected: SearchHit[] = [];
  let tokens = 0;
  for (const hit of hits) {
    if (selected.length >= caps.autoRecallMaxSnippets) break;
    const cost = estimateTextTokens(hit.snippet);
    if (tokens + cost > caps.autoRecallMaxTokens) break;
    selected.push(hit);
    tokens += cost;
  }

  const formatted = selected
    .map(
      (h, i) =>
        `${i + 1}. [${h.layer}] ${h.path}${h.sessionId ? ` (session ${h.sessionId})` : ""}\n${h.snippet}`,
    )
    .join("\n\n");

  return {
    hits: selected,
    formatted,
    injectedSnippets: selected.length,
    injectedTokens: tokens,
  };
}
