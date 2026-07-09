import { describe, expect, it } from "vitest";
import {
  agentCacheKey,
  AgentResultReplayer,
} from "./agent-cache.js";

describe("agentCacheKey", () => {
  it("is stable for identical prompt and opts", () => {
    const a = agentCacheKey("hello", { label: "scope", phase: "Scope" });
    const b = agentCacheKey("hello", { label: "scope", phase: "Scope" });
    expect(a).toBe(b);
  });

  it("changes when prompt changes", () => {
    const a = agentCacheKey("hello", { label: "scope" });
    const b = agentCacheKey("world", { label: "scope" });
    expect(a).not.toBe(b);
  });
});

describe("AgentResultReplayer", () => {
  it("replays longest unchanged prefix then runs live", () => {
    const keyA = agentCacheKey("prompt-a", { label: "a" });
    const keyB = agentCacheKey("prompt-b", { label: "b" });
    const replayer = new AgentResultReplayer([
      { key: keyA, label: "a", output: { ok: 1 } },
      { key: keyB, label: "b", output: { ok: 2 } },
    ]);

    expect(replayer.tryReplay("prompt-a", { label: "a" })).toEqual({ ok: 1 });
    expect(replayer.tryReplay("prompt-b", { label: "b" })).toEqual({ ok: 2 });
    expect(replayer.tryReplay("prompt-changed", { label: "c" })).toBeUndefined();
    expect(replayer.tryReplay("prompt-d", { label: "d" })).toBeUndefined();
  });
});
