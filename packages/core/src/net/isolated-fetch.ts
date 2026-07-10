import { AsyncLocalStorage } from "node:async_hooks";
import type { NetworkPolicy } from "../config/network-store.js";
import { evaluateNetworkAccess } from "../security/network-guard.js";
import { rawKakoFetch } from "./proxy-fetch.js";

export type FetchLike = typeof fetch;

type DownstreamSet = Set<AbortController>;

/** One upstream abort listener fans out to many per-request controllers. */
const upstreamLinks = new WeakMap<AbortSignal, DownstreamSet>();

export interface FetchSecurityScope {
  enforceNetworkPolicy: boolean;
  networkPolicy?: NetworkPolicy;
  sessionAllowedHosts?: Set<string>;
  mcpContext?: boolean;
  mcpExceptionHosts?: Set<string>;
}

const fetchSecurityScope = new AsyncLocalStorage<FetchSecurityScope>();

export function runWithFetchSecurityScope<T>(scope: FetchSecurityScope, fn: () => T): T {
  return fetchSecurityScope.run(scope, fn);
}

function urlFromFetchInput(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function assertNetworkAllowed(input: string | URL | Request): Promise<void> {
  const scope = fetchSecurityScope.getStore();
  if (!scope?.enforceNetworkPolicy || !scope.networkPolicy) return;

  const url = urlFromFetchInput(input);
  const decision = evaluateNetworkAccess(
    url,
    scope.networkPolicy,
    scope.sessionAllowedHosts ?? new Set(),
    {
      mcpContext: scope.mcpContext,
      mcpExceptionHosts: scope.mcpExceptionHosts,
    },
  );
  if (decision.action === "deny") {
    throw new Error(decision.reason);
  }
}

function linkToUpstream(upstream: AbortSignal, downstream: AbortController): () => void {
  if (upstream.aborted) {
    downstream.abort(upstream.reason);
    return () => {};
  }

  let downstreams = upstreamLinks.get(upstream);
  if (!downstreams) {
    downstreams = new Set();
    upstreamLinks.set(upstream, downstreams);
    upstream.addEventListener(
      "abort",
      () => {
        const reason = upstream.reason;
        for (const child of downstreams!) {
          if (!child.signal.aborted) {
            child.abort(reason);
          }
        }
        downstreams!.clear();
      },
      { once: true },
    );
  }

  downstreams.add(downstream);
  return () => {
    downstreams!.delete(downstream);
  };
}

/**
 * Wrap fetch so each request uses its own AbortSignal.
 * Prevents undici from piling abort listeners onto a long-lived transport signal
 * (e.g. MCP StreamableHTTP / SSE reconnect loops).
 */
export function createIsolatedFetch(baseFetch: FetchLike): FetchLike {
  return async (input, init) => {
    const upstream = init?.signal;
    if (!upstream) {
      return baseFetch(input, init);
    }

    const controller = new AbortController();
    const unlink = linkToUpstream(upstream, controller);

    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } finally {
      unlink();
    }
  };
}

let cachedIsolatedKakoFetch: FetchLike | undefined;

/** Proxy-aware fetch; isolates upstream abort signals when present. */
export async function kakoFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  await assertNetworkAllowed(input);

  if (!init?.signal) {
    return rawKakoFetch(input, init);
  }
  cachedIsolatedKakoFetch ??= createIsolatedFetch(rawKakoFetch);
  return cachedIsolatedKakoFetch(input, init);
}

export { rawKakoFetch };
