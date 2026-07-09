import { kakoFetch } from "./isolated-fetch.js";

export async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await kakoFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
