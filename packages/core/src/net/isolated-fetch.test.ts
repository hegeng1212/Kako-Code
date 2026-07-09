import { afterEach, describe, expect, it, vi } from "vitest";
import { createIsolatedFetch } from "./isolated-fetch.js";

describe("createIsolatedFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers one upstream abort listener for many concurrent requests", async () => {
    const upstream = new AbortController();
    const addSpy = vi.spyOn(upstream.signal, "addEventListener");
    const baseFetch = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      return new Response("ok", { status: 200, signal: init?.signal ?? undefined });
    });
    const isolated = createIsolatedFetch(baseFetch as typeof fetch);

    await Promise.all(
      Array.from({ length: 20 }, async () => {
        const res = await isolated("https://example.com", { signal: upstream.signal });
        await res.text();
      }),
    );

    const abortAdds = addSpy.mock.calls.filter(([type]) => type === "abort").length;
    expect(abortAdds).toBe(1);
    expect(baseFetch).toHaveBeenCalledTimes(20);
  });

  it("cleans up downstream links after each request", async () => {
    const upstream = new AbortController();
    const removeSpy = vi.spyOn(upstream.signal, "removeEventListener");
    const baseFetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const isolated = createIsolatedFetch(baseFetch as typeof fetch);

    for (let i = 0; i < 5; i++) {
      const res = await isolated("https://example.com", { signal: upstream.signal });
      await res.text();
    }

    expect(removeSpy).not.toHaveBeenCalled();
    expect(upstream.signal.listenerCount?.("abort") ?? 0).toBeLessThanOrEqual(1);
  });

  it("forwards upstream abort to the per-request controller", async () => {
    const upstream = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const baseFetch = vi.fn((_input: RequestInfo, init?: RequestInit) => {
      receivedSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const isolated = createIsolatedFetch(baseFetch as typeof fetch);

    const pending = isolated("https://example.com", { signal: upstream.signal });
    upstream.abort();
    await expect(pending).rejects.toThrow();
    expect(receivedSignal?.aborted).toBe(true);
  });
});
