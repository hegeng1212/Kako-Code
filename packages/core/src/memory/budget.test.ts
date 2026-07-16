import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMemorySettings } from "../config/memory-store.js";
import {
  __resetMemoryBudgetForTests,
  beginMemoryLlmCall,
  canRunMemoryLlm,
  recordMemoryLlmCall,
  releaseMemoryLlmSlot,
} from "./budget.js";

describe("memory budget", () => {
  let home: string;
  let prev: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-bud-"));
    prev = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
    await __resetMemoryBudgetForTests();
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prev;
    await rm(home, { recursive: true, force: true });
  });

  it("blocks when job disabled", () => {
    const settings = parseMemorySettings({
      backgroundReview: { enabled: false },
    });
    const gate = canRunMemoryLlm("backgroundReview", settings, {
      hourKey: "x",
      dayKey: "y",
      hourCalls: 0,
      dayCalls: 0,
      byJob: {},
      concurrent: 0,
    });
    expect(gate).toEqual({ ok: false, reason: "disabled" });
  });

  it("honors shared hour budget", async () => {
    const settings = parseMemorySettings({
      budget: { enabled: true, maxLlmCallsPerHour: 1, maxLlmCallsPerDay: 100 },
      backgroundReview: { enabled: true, maxPerHour: 100, maxPerDay: 100, cooldownSeconds: 0 },
    });
    const a = await beginMemoryLlmCall("backgroundReview", settings);
    expect(a.ok).toBe(true);
    await recordMemoryLlmCall("backgroundReview");
    const b = await beginMemoryLlmCall("backgroundReview", settings);
    expect(b).toEqual({ ok: false, reason: "budget_hour" });
  });

  it("releases concurrent slot on failure path", async () => {
    const settings = parseMemorySettings({
      budget: { maxConcurrentJobs: 1 },
      backgroundReview: { cooldownSeconds: 0 },
    });
    expect((await beginMemoryLlmCall("backgroundReview", settings)).ok).toBe(true);
    expect((await beginMemoryLlmCall("backgroundReview", settings)).ok).toBe(false);
    await releaseMemoryLlmSlot();
    expect((await beginMemoryLlmCall("backgroundReview", settings)).ok).toBe(true);
    await recordMemoryLlmCall("backgroundReview");
  });
});
