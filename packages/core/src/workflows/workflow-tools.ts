import type { ToolHandler } from "@kako/shared";
import { parseWebFetchInput, runWebFetchMarkdown } from "../web/web-fetch.js";
import { getCachedWebSearch, setCachedWebSearch } from "../web/search-cache.js";
import { parseWebSearchInput, runWebSearch } from "../web/web-search.js";

/** Workflow fetch: return clipped page markdown — no summarization LLM round-trip. */
export function createWorkflowWebFetchHandler(): ToolHandler {
  return async (input) => {
    const parsed = parseWebFetchInput(input);
    return runWebFetchMarkdown(parsed.url);
  };
}

/** Workflow search: dedupe identical queries within a session (verify voters). */
export function createWorkflowWebSearchHandler(sessionId: string): ToolHandler {
  return async (input) => {
    const parsed = parseWebSearchInput(input);
    const cached = getCachedWebSearch(sessionId, parsed);
    if (cached !== undefined) return cached;
    const result = await runWebSearch(parsed);
    setCachedWebSearch(sessionId, parsed, result);
    return result;
  };
}
