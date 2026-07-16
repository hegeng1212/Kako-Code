import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMemorySettings } from "../config/memory-store.js";
import { loadCuratedEntries } from "./curated-store.js";
import {
  approvePendingMemoryWrite,
  listPendingMemoryWrites,
  rejectPendingMemoryWrite,
  stageMemoryWrite,
} from "./pending.js";

describe("pending memory writes", () => {
  let home: string;
  let prev: string | undefined;
  const settings = parseMemorySettings({});

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-pend-"));
    prev = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prev;
    await rm(home, { recursive: true, force: true });
  });

  it("stages Option A write then applies on approve", async () => {
    const id = await stageMemoryWrite([
      { kind: "curated", target: "notes", action: "add", content: "Prefer Option A" },
    ]);
    expect(await listPendingMemoryWrites()).toHaveLength(1);
    expect(await loadCuratedEntries("notes")).toEqual([]);
    await approvePendingMemoryWrite(id, settings);
    expect(await loadCuratedEntries("notes")).toEqual(["Prefer Option A"]);
    expect(await listPendingMemoryWrites()).toHaveLength(0);
  });

  it("reject drops pending without write", async () => {
    const id = await stageMemoryWrite([
      { kind: "curated", target: "user", action: "add", content: "Tag: option-b" },
    ]);
    await rejectPendingMemoryWrite(id);
    expect(await loadCuratedEntries("user")).toEqual([]);
    expect(await listPendingMemoryWrites()).toHaveLength(0);
  });
});
