import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMemorySettings } from "../config/memory-store.js";
import {
  addCuratedEntry,
  loadCuratedEntries,
  removeCuratedEntry,
  replaceCuratedEntry,
} from "./curated-store.js";

describe("curated-store", () => {
  let home: string;
  let prev: string | undefined;
  const settings = parseMemorySettings({
    curated: { notesCharLimit: 80, userCharLimit: 80 },
  });

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-cur-"));
    prev = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prev;
    await rm(home, { recursive: true, force: true });
  });

  it("adds and lists Option A entry", async () => {
    const r = await addCuratedEntry("notes", "Prefer Option A for layout", settings);
    expect(r.ok).toBe(true);
    expect(await loadCuratedEntries("notes")).toEqual(["Prefer Option A for layout"]);
  });

  it("rejects add when over cap", async () => {
    await addCuratedEntry("notes", "x".repeat(50), settings);
    const r = await addCuratedEntry("notes", "y".repeat(50), settings);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exceed/i);
  });

  it("replaces and removes by unique oldText", async () => {
    await addCuratedEntry("user", "Tag: option-a-user", settings);
    await addCuratedEntry("user", "Prefers terse replies", settings);
    const replaced = await replaceCuratedEntry(
      "user",
      "option-a",
      "Tag: option-b-user",
      settings,
    );
    expect(replaced.ok).toBe(true);
    const removed = await removeCuratedEntry("user", "terse", settings);
    expect(removed.ok).toBe(true);
    expect(await loadCuratedEntries("user")).toEqual(["Tag: option-b-user"]);
  });
});
