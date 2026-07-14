import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeMemoryFtsDb, upsertMemoryDoc } from "../../memory/index-fts.js";
import { memorySearchHandler, memorySearchToolDefinition } from "./memory-search.js";
import { toolContext } from "./test-helpers.js";

describe("MemorySearch tool definition", () => {
  it("requires query and disables additional properties", () => {
    expect(memorySearchToolDefinition.inputSchema.required).toEqual(["query"]);
    expect(memorySearchToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(memorySearchToolDefinition.description).toContain("≤8");
  });
});

describe("MemorySearch handler", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-ms-"));
    prevHome = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
    closeMemoryFtsDb();
  });

  afterEach(async () => {
    closeMemoryFtsDb();
    process.env.KAKO_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  });

  it("returns bounded JSON hits for Option A query", async () => {
    upsertMemoryDoc({
      id: "L1:s1",
      layer: "L1",
      path: join(home, "memory", "sessions", "s1", "summary.md"),
      sessionId: "s1" as never,
      body: "Goal: ship Option A search tools.",
    });
    const out = await memorySearchHandler({ query: "Option A", limit: 3 }, toolContext("/tmp"));
    const parsed = JSON.parse(String(out)) as { hits: unknown[] };
    expect(Array.isArray(parsed.hits)).toBe(true);
    expect(parsed.hits.length).toBeGreaterThan(0);
    expect(parsed.hits.length).toBeLessThanOrEqual(3);
  });
});
