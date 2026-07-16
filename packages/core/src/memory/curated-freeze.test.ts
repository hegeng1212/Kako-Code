import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMemorySettings } from "../config/memory-store.js";
import { addCuratedEntry } from "./curated-store.js";
import {
  __clearAllFrozenCuratedSnapshotsForTests,
  clearFrozenCuratedSnapshot,
  getFrozenCuratedSnapshot,
} from "./curated-freeze.js";

describe("curated-freeze", () => {
  let home: string;
  let prev: string | undefined;
  const settings = parseMemorySettings({});

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-freeze-"));
    prev = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
    __clearAllFrozenCuratedSnapshotsForTests();
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prev;
    await rm(home, { recursive: true, force: true });
  });

  it("freezes Option A snapshot; mid-session add does not change inject", async () => {
    await addCuratedEntry("notes", "Prefer Option A", settings);
    const first = await getFrozenCuratedSnapshot("sess-1", settings);
    expect(first).toContain("Prefer Option A");

    await addCuratedEntry("notes", "Also Option B detail", settings);
    const second = await getFrozenCuratedSnapshot("sess-1", settings);
    expect(second).toBe(first);
    expect(second).not.toContain("Option B");

    clearFrozenCuratedSnapshot("sess-1");
    const third = await getFrozenCuratedSnapshot("sess-1", settings);
    expect(third).toContain("Option B");
  });

  it("returns undefined when curated disabled", async () => {
    const off = parseMemorySettings({ curated: { enabled: false } });
    await addCuratedEntry("notes", "x", parseMemorySettings({}));
    expect(await getFrozenCuratedSnapshot("s", off)).toBeUndefined();
  });
});
