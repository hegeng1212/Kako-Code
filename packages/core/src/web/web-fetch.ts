import type { LLMRouter } from "@kako/shared";
import { createLLMRouter } from "../llm/router.js";
import { fetchWithTimeout } from "../net/fetch-with-timeout.js";
import { getCachedMarkdown, setCachedMarkdown } from "./fetch-cache.js";
import { htmlToMarkdown } from "./html-to-markdown.js";

export const WEB_FETCH_MAX_BYTES = 5_000_000;
export const WEB_FETCH_MAX_MARKDOWN_CHARS = 120_000;
export const WEB_FETCH_MAX_REDIRECTS = 5;
/** Per-hop HTTP timeout — slow hosts fail fast instead of blocking fetch agents. */
export const WEB_FETCH_TIMEOUT_MS = 20_000;

export interface WebFetchInput {
  url: string;
  prompt: string;
}

export interface WebFetchRedirectResult {
  type: "cross_host_redirect";
  originalUrl: string;
  redirectUrl: string;
}

export interface WebFetchContentResult {
  type: "content";
  url: string;
  finalUrl: string;
  markdown: string;
  fromCache: boolean;
}

export type WebFetchPageResult = WebFetchRedirectResult | WebFetchContentResult;

export function parseWebFetchInput(raw: Record<string, unknown>): WebFetchInput {
  const url = String(raw.url ?? "").trim();
  const prompt = String(raw.prompt ?? "").trim();
  if (!url) {
    throw new Error("WebFetch requires url");
  }
  if (!prompt) {
    throw new Error("WebFetch requires prompt");
  }
  return { url, prompt };
}

export function normalizeWebFetchUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol === "http:") {
    parsed.protocol = "https:";
  }
  if (parsed.protocol !== "https:") {
    throw new Error("WebFetch only supports http and https URLs");
  }
  return parsed.toString();
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(`WebFetch response exceeds ${maxBytes} bytes`);
    }
    return Buffer.from(arrayBuffer);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(`WebFetch response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function bodyToMarkdown(body: string, contentType: string): string {
  if (contentType.includes("text/html")) {
    return htmlToMarkdown(body);
  }
  return body.trim();
}

export async function fetchWebPage(requestUrl: string): Promise<WebFetchPageResult> {
  const normalizedRequestUrl = normalizeWebFetchUrl(requestUrl);
  const cached = getCachedMarkdown(normalizedRequestUrl);
  if (cached) {
    return {
      type: "content",
      url: normalizedRequestUrl,
      finalUrl: normalizedRequestUrl,
      markdown: cached,
      fromCache: true,
    };
  }

  let currentUrl = normalizedRequestUrl;
  const startHost = new URL(normalizedRequestUrl).host;

  for (let hop = 0; hop < WEB_FETCH_MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        currentUrl,
        {
          redirect: "manual",
          headers: {
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            "User-Agent": "Kako-WebFetch/1.0",
          },
        },
        WEB_FETCH_TIMEOUT_MS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("abort") || message.includes("Abort")) {
        throw new Error(`WebFetch timed out after ${WEB_FETCH_TIMEOUT_MS / 1000}s for ${currentUrl}`);
      }
      throw error;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Redirect without location header from ${currentUrl}`);
      }
      const nextUrl = new URL(location, currentUrl).toString();
      const nextHost = new URL(nextUrl).host;
      if (nextHost !== startHost) {
        return {
          type: "cross_host_redirect",
          originalUrl: normalizedRequestUrl,
          redirectUrl: nextUrl,
        };
      }
      currentUrl = nextUrl;
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "WebFetch cannot access authenticated or private URLs. Use an authenticated MCP tool or gh instead.",
      );
    }
    if (!response.ok) {
      throw new Error(`WebFetch failed: HTTP ${response.status} for ${currentUrl}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const buffer = await readResponseWithLimit(response, WEB_FETCH_MAX_BYTES);
    const markdown = bodyToMarkdown(buffer.toString("utf-8"), contentType);
    setCachedMarkdown(normalizedRequestUrl, markdown);

    return {
      type: "content",
      url: normalizedRequestUrl,
      finalUrl: currentUrl,
      markdown,
      fromCache: false,
    };
  }

  throw new Error("WebFetch exceeded maximum redirect hops");
}

export function formatCrossHostRedirect(result: WebFetchRedirectResult): string {
  return [
    `Cross-host redirect from ${result.originalUrl} to ${result.redirectUrl}.`,
    "Call WebFetch again with the redirect URL.",
  ].join(" ");
}

export async function answerWebFetchPrompt(
  markdown: string,
  prompt: string,
  router?: LLMRouter,
): Promise<string> {
  const llm = router ?? createLLMRouter();
  const clipped = markdown.slice(0, WEB_FETCH_MAX_MARKDOWN_CHARS);
  const completion = await llm.complete({
    model: "",
    messages: [
      {
        role: "system",
        content:
          "You answer questions using only the provided web page markdown. Be concise and factual.",
      },
      {
        role: "user",
        content: `Page markdown:\n\n${clipped}\n\nQuestion: ${prompt}`,
      },
    ],
    maxTokens: 4096,
    temperature: 0,
  });

  const answer = completion.content.trim();
  if (completion.finishReason === "error" || !answer) {
    throw new Error("WebFetch summarization failed — check provider configuration");
  }
  return answer;
}

export async function runWebFetch(
  input: WebFetchInput,
  router?: LLMRouter,
): Promise<string> {
  const page = await fetchWebPage(input.url);
  if (page.type === "cross_host_redirect") {
    return formatCrossHostRedirect(page);
  }
  return answerWebFetchPrompt(page.markdown, input.prompt, router);
}
