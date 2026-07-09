import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const execFileAsync = promisify(execFile);

const PROXY_ENV_KEYS = [
  "KAKO_HTTPS_PROXY",
  "KAKO_HTTP_PROXY",
  "KAKO_PROXY",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

let cachedProxyUrl: string | null | undefined;
let cachedDispatcher: ProxyAgent | undefined;

export function resolveProxyUrlFromEnv(): string | undefined {
  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function parseMacScutilProxy(stdout: string): string | undefined {
  const httpEnabled = /HTTPEnable\s*:\s*1/.test(stdout);
  const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(stdout);
  if (!httpEnabled && !httpsEnabled) return undefined;

  const host =
    (httpsEnabled ? stdout.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1] : undefined) ??
    stdout.match(/HTTPProxy\s*:\s*(\S+)/)?.[1];
  const port =
    (httpsEnabled ? stdout.match(/HTTPSPort\s*:\s*(\d+)/)?.[1] : undefined) ??
    stdout.match(/HTTPPort\s*:\s*(\d+)/)?.[1];

  if (!host || !port) return undefined;
  return `http://${host}:${port}`;
}

export async function detectMacSystemProxy(): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  try {
    const { stdout } = await execFileAsync("scutil", ["--proxy"]);
    return parseMacScutilProxy(stdout);
  } catch {
    return undefined;
  }
}

export async function resolveProxyUrl(): Promise<string | undefined> {
  if (process.env.KAKO_NO_PROXY === "1") {
    cachedProxyUrl = null;
    return undefined;
  }
  if (cachedProxyUrl !== undefined) {
    return cachedProxyUrl ?? undefined;
  }

  const fromEnv = resolveProxyUrlFromEnv();
  if (fromEnv) {
    cachedProxyUrl = fromEnv;
    return fromEnv;
  }

  const fromSystem = await detectMacSystemProxy();
  cachedProxyUrl = fromSystem ?? null;
  return fromSystem;
}

export function resetProxyCacheForTests(): void {
  cachedProxyUrl = undefined;
  cachedDispatcher = undefined;
}

async function getProxyDispatcher(): Promise<ProxyAgent | undefined> {
  const proxyUrl = await resolveProxyUrl();
  if (!proxyUrl) return undefined;
  cachedDispatcher ??= new ProxyAgent(proxyUrl);
  return cachedDispatcher;
}

/** Low-level fetch with proxy support — does not isolate abort signals. */
export async function rawKakoFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const dispatcher = await getProxyDispatcher();
  if (!dispatcher) {
    return fetch(input, init);
  }
  return undiciFetch(input, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1]);
}
