import type { SearchProviderId, SearchProviderProfile } from "@kako/shared";
import {
  isSearchProviderReady,
  loadSearchRegistry,
  searchProviderReadyError,
} from "../config/search-store.js";
import type { WebSearchInput, WebSearchResponse, WebSearchResult } from "./search-types.js";
import { fetchWithTimeout } from "../net/fetch-with-timeout.js";
import { searchDoubao } from "./search-providers/doubao.js";

const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DUCKDUCKGO_TIMEOUT_MS = 8_000;
const BING_TIMEOUT_MS = 15_000;
const API_SEARCH_TIMEOUT_MS = 20_000;

export function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message) {
    return `${error.message} (${cause.message})`;
  }
  return error.message;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0*(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHref(raw: string): string {
  return raw.replace(/&amp;/g, "&").trim();
}

function isBingHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return host === "bing.com" || host.endsWith(".bing.com");
}

/** Decode destination URL from Bing /ck/a redirect links. */
export function decodeBingCkUrl(href: string): string | undefined {
  try {
    const url = new URL(normalizeHref(href));
    if (!isBingHost(url.hostname) || !url.pathname.includes("/ck/a")) return undefined;
    const encoded = url.searchParams.get("u");
    if (!encoded) return undefined;
    const payload = encoded.replace(/^a[12]/, "");
    const decoded = Buffer.from(payload, "base64").toString("utf8");
    if (!/^https?:\/\//i.test(decoded)) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

function extractBingResultUrl(block: string): string | undefined {
  for (const match of block.matchAll(/href="([^"]+)"/gi)) {
    const href = normalizeHref(match[1] ?? "");
    if (!/^https?:\/\//i.test(href)) continue;

    let hostname: string;
    try {
      hostname = new URL(href).hostname;
    } catch {
      continue;
    }

    if (hostname.toLowerCase() === "r.bing.com") continue;

    if (isBingHost(hostname)) {
      const decoded = decodeBingCkUrl(href);
      if (decoded) return decoded;
      continue;
    }

    return href;
  }
  return undefined;
}

export function parseBingHtml(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blocks = html.split(/<li class="b_algo"/i).slice(1);

  for (const block of blocks) {
    const titleMatch = block.match(/<h2[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    const url = extractBingResultUrl(block);
    if (!url || !titleMatch) continue;

    const title = decodeHtmlEntities(titleMatch[1] ?? "");
    if (!title) continue;

    const snippetMatch = block.match(/<p class="b_lineclamp\d*"[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? decodeHtmlEntities(snippetMatch[1] ?? "") : undefined;

    results.push({
      title,
      url,
      ...(snippet ? { snippet } : {}),
    });
    if (results.length >= 10) break;
  }

  return results;
}

function queryPrefersBing(query: string): boolean {
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(query);
}

function bingSearchUrl(query: string): string {
  const host = queryPrefersBing(query) ? "https://cn.bing.com" : "https://www.bing.com";
  const url = new URL("/search", host);
  url.searchParams.set("q", query);
  return url.toString();
}

async function searchBingWeb(query: string): Promise<WebSearchResult[]> {
  const response = await fetchWithTimeout(
    bingSearchUrl(query),
    {
      headers: {
        "User-Agent": SEARCH_USER_AGENT,
        "Accept-Language": queryPrefersBing(query) ? "zh-CN,zh;q=0.9" : "en-US,en;q=0.9",
      },
    },
    BING_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`Bing search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const results = parseBingHtml(html);
  if (!results.length) {
    throw new Error("Bing search returned no parseable results");
  }
  return results;
}

export function parseWebSearchInput(raw: Record<string, unknown>): WebSearchInput {
  const query = String(raw.query ?? "").trim();
  if (query.length < 2) {
    throw new Error("WebSearch requires query with at least 2 characters");
  }

  const allowedDomains = parseDomainList(raw.allowed_domains);
  const blockedDomains = parseDomainList(raw.blocked_domains);

  return {
    query,
    ...(allowedDomains?.length ? { allowedDomains } : {}),
    ...(blockedDomains?.length ? { blockedDomains } : {}),
  };
}

function parseDomainList(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error("WebSearch domain filters must be arrays");
  }
  const domains = raw.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  return domains.length ? domains : undefined;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const normalizedHost = hostname.replace(/^www\./, "");
  const normalizedDomain = domain.replace(/^www\./, "").replace(/^\*\./, "");
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

export function filterSearchResults(
  results: WebSearchResult[],
  allowedDomains?: string[],
  blockedDomains?: string[],
): WebSearchResult[] {
  return results.filter((result) => {
    const host = hostnameOf(result.url);
    if (!host) return false;
    if (blockedDomains?.some((domain) => hostnameMatchesDomain(host, domain))) {
      return false;
    }
    if (allowedDomains?.length) {
      return allowedDomains.some((domain) => hostnameMatchesDomain(host, domain));
    }
    return true;
  });
}

export function formatWebSearchResponse(response: WebSearchResponse): string {
  if (!response.results.length) {
    return `No search results for: ${response.query}`;
  }

  const blocks = response.results.map((result, index) => {
    const lines = [`## Result ${index + 1}`, `Title: ${result.title}`, `URL: ${result.url}`];
    if (result.snippet) {
      lines.push(`Snippet: ${result.snippet}`);
    }
    return lines.join("\n");
  });

  return blocks.join("\n\n");
}

async function searchBrave(query: string, apiKey: string): Promise<WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("country", "US");
  url.searchParams.set("search_lang", "en");
  url.searchParams.set("count", "10");

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    },
    API_SEARCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`Brave search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  return (data.web?.results ?? [])
    .filter((item) => item.title && item.url)
    .map((item) => ({
      title: String(item.title),
      url: String(item.url),
      ...(item.description ? { snippet: String(item.description) } : {}),
    }));
}

async function searchSerpApi(query: string, apiKey: string): Promise<WebSearchResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("gl", "us");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", apiKey);

  const response = await fetchWithTimeout(url.toString(), undefined, API_SEARCH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`SerpAPI search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
  };

  return (data.organic_results ?? [])
    .filter((item) => item.title && item.link)
    .map((item) => ({
      title: String(item.title),
      url: String(item.link),
      ...(item.snippet ? { snippet: String(item.snippet) } : {}),
    }));
}

async function searchDuckDuckGo(query: string): Promise<WebSearchResult[]> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("no_html", "1");

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: { "User-Agent": SEARCH_USER_AGENT },
    },
    DUCKDUCKGO_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    Heading?: string;
    AbstractURL?: string;
    AbstractText?: string;
    RelatedTopics?: Array<
      | { Text?: string; FirstURL?: string }
      | { Name?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }
    >;
  };

  const results: WebSearchResult[] = [];
  if (data.Heading && data.AbstractURL) {
    results.push({
      title: data.Heading,
      url: data.AbstractURL,
      ...(data.AbstractText ? { snippet: data.AbstractText } : {}),
    });
  }

  for (const topic of data.RelatedTopics ?? []) {
    if ("Topics" in topic && Array.isArray(topic.Topics)) {
      for (const nested of topic.Topics) {
        if (nested.Text && nested.FirstURL) {
          results.push({ title: nested.Text, url: nested.FirstURL });
        }
      }
      continue;
    }
    if ("Text" in topic && topic.Text && topic.FirstURL) {
      results.push({ title: topic.Text, url: topic.FirstURL });
    }
  }

  return results;
}

export async function searchWithProvider(
  query: string,
  profile: SearchProviderProfile,
): Promise<WebSearchResult[]> {
  switch (profile.id) {
    case "doubao":
      return searchDoubao(query, profile);
    case "brave": {
      const key = profile.apiKey?.trim();
      if (!key) throw new Error("Brave 搜索需要 API Key");
      return searchBrave(query, key);
    }
    case "serpapi": {
      const key = profile.apiKey?.trim();
      if (!key) throw new Error("SerpAPI 需要 API Key");
      return searchSerpApi(query, key);
    }
    case "bing":
      return searchBingWeb(query);
    case "duckduckgo":
      return searchDuckDuckGo(query);
    default:
      throw new Error(`Unknown search provider: ${profile.id satisfies never}`);
  }
}

export async function runWebSearchWithRegistry(
  input: WebSearchInput,
  providers: SearchProviderProfile[],
): Promise<string> {
  const errors: string[] = [];

  for (const profile of providers) {
    if (!isSearchProviderReady(profile)) continue;
    try {
      const results = await searchWithProvider(input.query, profile);
      const filtered = filterSearchResults(
        results,
        input.allowedDomains,
        input.blockedDomains,
      );
      if (!filtered.length) {
        errors.push(`${profile.id}: no results after domain filter`);
        continue;
      }
      return formatWebSearchResponse({
        query: input.query,
        region: "US",
        results: filtered,
      });
    } catch (error) {
      errors.push(`${profile.id}: ${formatFetchError(error)}`);
    }
  }

  if (errors.length) {
    throw new Error(`All search providers failed:\n${errors.join("\n")}`);
  }
  throw new Error(
    "No search provider is enabled and configured. Open Kako settings → 搜索设置.",
  );
}

export async function runWebSearch(input: WebSearchInput): Promise<string> {
  const registry = await loadSearchRegistry();
  return runWebSearchWithRegistry(input, registry.providers);
}

export async function testSearchProvider(
  providerId: SearchProviderId,
  query = "test",
): Promise<{ resultCount: number; latencyMs: number }> {
  const registry = await loadSearchRegistry();
  const profile = registry.providers.find((p) => p.id === providerId);
  if (!profile) throw new Error(`Unknown provider: ${providerId}`);
  const configError = searchProviderReadyError(profile);
  if (configError) throw new Error(configError);
  if (!isSearchProviderReady(profile)) {
    throw new Error("搜索后端未就绪");
  }

  const start = Date.now();
  const results = await searchWithProvider(query, profile);
  return { resultCount: results.length, latencyMs: Date.now() - start };
}
