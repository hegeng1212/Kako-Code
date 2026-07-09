import { createHash } from "node:crypto";
import type { WebSearchInput } from "./search-types.js";

const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  result: string;
  expiresAt: number;
}

const bySession = new Map<string, Map<string, CacheEntry>>();

export function webSearchCacheKey(input: WebSearchInput): string {
  const payload = JSON.stringify({
    query: input.query.toLowerCase().trim(),
    allowed: input.allowedDomains?.slice().sort() ?? [],
    blocked: input.blockedDomains?.slice().sort() ?? [],
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function getCachedWebSearch(sessionId: string, input: WebSearchInput): string | undefined {
  const session = bySession.get(sessionId);
  const entry = session?.get(webSearchCacheKey(input));
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    session!.delete(webSearchCacheKey(input));
    return undefined;
  }
  return entry.result;
}

export function setCachedWebSearch(sessionId: string, input: WebSearchInput, result: string): void {
  let session = bySession.get(sessionId);
  if (!session) {
    session = new Map();
    bySession.set(sessionId, session);
  }
  session.set(webSearchCacheKey(input), { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Test-only reset. */
export function resetWebSearchCache(sessionId?: string): void {
  if (sessionId) {
    bySession.delete(sessionId);
    return;
  }
  bySession.clear();
}

export const WEB_SEARCH_CACHE_TTL_MS = CACHE_TTL_MS;
