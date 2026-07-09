import type { SearchProviderProfile } from "@kako/shared";
import { fetchWithTimeout } from "../../net/fetch-with-timeout.js";
import type { WebSearchResult } from "./search-types.js";

const DOUBAO_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = "https://open.feedcoopapi.com";
const SEARCH_PATH = "/search_api/web_search";

const TIME_RANGE_SHORTCUTS = new Set(["OneDay", "OneWeek", "OneMonth", "OneYear"]);
const DATE_RANGE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

function validateTimeRange(timeRange?: string): string | undefined {
  if (!timeRange?.trim()) return undefined;
  const value = timeRange.trim();
  if (TIME_RANGE_SHORTCUTS.has(value)) return value;
  const match = DATE_RANGE_PATTERN.exec(value);
  if (!match) {
    throw new Error(
      "TimeRange 需为 OneDay/OneWeek/OneMonth/OneYear，或 YYYY-MM-DD..YYYY-MM-DD",
    );
  }
  const [, startText, endText] = match;
  const startDate = new Date(`${startText}T00:00:00`);
  const endDate = new Date(`${endText}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("TimeRange 中的日期需为有效的 YYYY-MM-DD");
  }
  if (startDate > endDate) {
    throw new Error("TimeRange 的开始日期不能晚于结束日期");
  }
  return value;
}

function buildDoubaoPayload(query: string, profile: SearchProviderProfile): Record<string, unknown> {
  const normalized = query.trim();
  if (!normalized || normalized.length > 100) {
    throw new Error("Query 长度需为 1~100 个字符");
  }

  const searchType = profile.searchType ?? "web";
  const count = profile.count ?? 10;
  const maxCount = searchType === "web" ? 50 : 5;
  if (count < 1 || count > maxCount) {
    throw new Error(`${searchType} 类型 Count 需在 1~${maxCount}`);
  }

  const authLevel = profile.authLevel ?? 0;
  const payload: Record<string, unknown> = {
    Query: normalized,
    SearchType: searchType,
    Count: count,
  };

  if (searchType === "web") {
    payload.NeedSummary = true;
    const timeRange = validateTimeRange(profile.timeRange);
    if (timeRange) payload.TimeRange = timeRange;
    if (authLevel > 0) payload.Filter = { AuthInfoLevel: authLevel };
  }

  return payload;
}

function extractDoubaoResultRows(data: Record<string, unknown>): unknown[] {
  const top = data.Results ?? data.results;
  if (Array.isArray(top)) return top;

  const result = data.Result ?? data.result;
  if (!result || typeof result !== "object") return [];

  const nested = result as Record<string, unknown>;
  const web = nested.WebResults ?? nested.webResults;
  if (Array.isArray(web)) return web;

  const image = nested.ImageResults ?? nested.imageResults;
  if (Array.isArray(image)) return image;

  const generic = nested.Results ?? nested.results;
  return Array.isArray(generic) ? generic : [];
}

function parseDoubaoResults(data: Record<string, unknown>): WebSearchResult[] {
  const raw = extractDoubaoResultRows(data);
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const title = String(row.Title ?? row.title ?? "").trim();
      const url = String(row.Url ?? row.url ?? "").trim();
      if (!title || !url) return null;
      const snippet = String(row.Snippet ?? row.snippet ?? row.Summary ?? row.summary ?? "").trim();
      return {
        title,
        url,
        ...(snippet ? { snippet } : {}),
      };
    })
    .filter((item): item is WebSearchResult => item !== null);
}

export async function searchDoubao(
  query: string,
  profile: SearchProviderProfile,
): Promise<WebSearchResult[]> {
  const apiKey = profile.apiKey?.trim();
  if (!apiKey) {
    throw new Error("豆包搜索需要配置 API Key");
  }

  const baseUrl = (profile.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = `${baseUrl}${SEARCH_PATH}`;
  const payload = buildDoubaoPayload(query, profile);

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Traffic-Tag": "kako_web_search",
      },
      body: JSON.stringify(payload),
    },
    DOUBAO_TIMEOUT_MS,
  );

  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`豆包搜索返回非 JSON (HTTP ${response.status})`);
  }

  if (!response.ok) {
    const message =
      typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : text.slice(0, 200);
    throw new Error(`豆包搜索失败 (HTTP ${response.status}): ${message}`);
  }

  const results = parseDoubaoResults(data);
  if (!results.length) {
    throw new Error("豆包搜索未返回结果");
  }
  return results;
}

export { parseDoubaoResults, buildDoubaoPayload };
