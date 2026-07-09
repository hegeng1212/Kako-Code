const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  markdown: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedMarkdown(url: string): string | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(url);
    return undefined;
  }
  return entry.markdown;
}

export function setCachedMarkdown(url: string, markdown: string): void {
  cache.set(url, { markdown, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Test-only reset. */
export function resetWebFetchCache(): void {
  cache.clear();
}

export const WEB_FETCH_CACHE_TTL_MS = CACHE_TTL_MS;
