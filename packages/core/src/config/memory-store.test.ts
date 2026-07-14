import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMemorySettings, resolveInjectCaps } from "./memory-store.js";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";

describe("memory-store", () => {
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

  it("defaults autoRecall true when file missing", async () => {
    const s = await loadMemorySettings();
    expect(s.autoRecall).toBe(true);
  });

  it("reads autoRecall false", async () => {
    await mkdir(join(home, "config"), { recursive: true });
    await writeFile(join(home, "config", "memory.json"), '{"autoRecall":false}\n');
    expect((await loadMemorySettings()).autoRecall).toBe(false);
  });

  it("merges injectCap overrides", async () => {
    await mkdir(join(home, "config"), { recursive: true });
    await writeFile(
      join(home, "config", "memory.json"),
      JSON.stringify({ autoRecall: true, injectCaps: { autoRecallMaxSnippets: 2 } }),
    );
    const caps = resolveInjectCaps(await loadMemorySettings());
    expect(caps.autoRecallMaxSnippets).toBe(2);
    expect(caps.searchDefaultLimit).toBe(DEFAULT_MEMORY_INJECT_CAPS.searchDefaultLimit);
  });
});
