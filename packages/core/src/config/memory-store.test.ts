import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isAutoRecallEnabled,
  loadMemorySettings,
  parseMemorySettings,
  resolveInjectCaps,
} from "./memory-store.js";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";

describe("memory-store switchable schema", () => {
  let home: string;
  let prev: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-memcfg-"));
    prev = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prev;
    await rm(home, { recursive: true, force: true });
  });

  it("defaults autoRecall and curated enabled; jobs off", async () => {
    const s = await loadMemorySettings();
    expect(s.autoRecall.enabled).toBe(true);
    expect(s.curated.enabled).toBe(true);
    expect(s.backgroundReview.enabled).toBe(true);
    expect(s.jobs.consolidate.enabled).toBe(false);
    expect(s.jobs.curator.enabled).toBe(false);
    expect(s.jobs.dreaming.enabled).toBe(false);
    expect(s.writeApproval.enabled).toBe(false);
  });

  it("accepts legacy flat autoRecall boolean", () => {
    const s = parseMemorySettings({ autoRecall: false });
    expect(s.autoRecall.enabled).toBe(false);
    expect(isAutoRecallEnabled(s)).toBe(false);
  });

  it("reads nested job enable and review model", async () => {
    await mkdir(join(home, "config"), { recursive: true });
    await writeFile(
      join(home, "config", "memory.json"),
      JSON.stringify({
        backgroundReview: { enabled: true, model: "cheap-model", maxPerHour: 5 },
        jobs: { consolidate: { enabled: true, maxSessionsPerRun: 3 } },
      }),
    );
    const s = await loadMemorySettings();
    expect(s.backgroundReview.model).toBe("cheap-model");
    expect(s.backgroundReview.maxPerHour).toBe(5);
    expect(s.jobs.consolidate.enabled).toBe(true);
    expect(s.jobs.consolidate.maxSessionsPerRun).toBe(3);
  });

  it("merges injectCap overrides", async () => {
    await mkdir(join(home, "config"), { recursive: true });
    await writeFile(
      join(home, "config", "memory.json"),
      JSON.stringify({ autoRecall: { enabled: true, maxSnippets: 2 } }),
    );
    const caps = resolveInjectCaps(await loadMemorySettings());
    expect(caps.autoRecallMaxSnippets).toBe(2);
    expect(caps.searchDefaultLimit).toBe(DEFAULT_MEMORY_INJECT_CAPS.searchDefaultLimit);
  });
});
