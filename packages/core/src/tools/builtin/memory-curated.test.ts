import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveMemorySettings, parseMemorySettings } from "../../config/memory-store.js";
import { loadCuratedEntries } from "../../memory/curated-store.js";
import {
  memoryCuratedHandler,
  memoryCuratedToolDefinition,
} from "./memory-curated.js";

const ctx = {
  cwd: "/tmp",
  sessionId: "sess-1" as const,
  agentId: "agent-main",
};

describe("Memory curated tool definition", () => {
  it("is named Memory with notes|user targets", () => {
    expect(memoryCuratedToolDefinition.name).toBe("Memory");
    expect(memoryCuratedToolDefinition.inputSchema.properties).toMatchObject({
      target: expect.any(Object),
      action: expect.any(Object),
    });
  });
});

describe("Memory curated handler", () => {
  let home: string;
  let prev: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-memtool-"));
    prev = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
    await saveMemorySettings(parseMemorySettings({}));
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prev;
    await rm(home, { recursive: true, force: true });
  });

  it("adds Option A note and lists it", async () => {
    const add = await memoryCuratedHandler(
      { target: "notes", action: "add", content: "Prefer Option A" },
      ctx,
    );
    expect(JSON.parse(add).ok).toBe(true);
    const list = JSON.parse(
      await memoryCuratedHandler({ target: "notes", action: "list" }, ctx),
    );
    expect(list.entries).toEqual(["Prefer Option A"]);
    expect(await loadCuratedEntries("notes")).toEqual(["Prefer Option A"]);
  });

  it("returns clear error when tool disabled", async () => {
    await saveMemorySettings(
      parseMemorySettings({ memoryTool: { enabled: false } }),
    );
    const out = JSON.parse(
      await memoryCuratedHandler(
        { target: "notes", action: "add", content: "x" },
        ctx,
      ),
    );
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/disabled/i);
  });
});
