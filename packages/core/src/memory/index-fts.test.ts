import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeMemoryFtsDb,
  rebuildMemoryFtsIndex,
  searchMemoryFts,
  upsertMemoryDoc,
  memoryGet,
} from "./index-fts.js";
import { runAutoRecall } from "./auto-recall.js";
import { applyFactDecisions, listFacts, writeFact } from "./facts.js";
import { consolidateL1ToL2 } from "./l2.js";
import { runMemoryCurator } from "./curator.js";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";

describe("memory FTS + facts + auto-recall", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-fts-"));
    prevHome = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
    closeMemoryFtsDb();
  });

  afterEach(async () => {
    closeMemoryFtsDb();
    process.env.KAKO_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  });

  it("indexes and returns bounded SearchHit snippets", async () => {
    const sessionDir = join(home, "memory", "sessions", "s1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "summary.md"),
      "---\nupdatedAt: 2026-07-14T00:00:00Z\ncompactGeneration: 1\nsessionId: s1\n---\n\n# Session Summary\n\n## Goal\n\nImplement Option A memory search.\n",
      "utf-8",
    );
    const { docs } = await rebuildMemoryFtsIndex();
    expect(docs).toBeGreaterThan(0);

    const hits = searchMemoryFts({ query: "Option A", crossSession: true });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.snippet.length).toBeLessThanOrEqual(
      DEFAULT_MEMORY_INJECT_CAPS.searchHitSnippetChars,
    );
    expect(hits[0]!.layer).toBe("L1");
  });

  it("auto-recall respects snippet and token caps", () => {
    upsertMemoryDoc({
      id: "L1:x",
      layer: "L1",
      path: "/tmp/x.md",
      body: "Option B landing path for recall testing. ".repeat(50),
    });
    const { hits, formatted } = runAutoRecall({
      query: "Option B",
      caps: {
        ...DEFAULT_MEMORY_INJECT_CAPS,
        autoRecallMaxSnippets: 1,
        autoRecallMaxTokens: 40,
        searchHitSnippetChars: 80,
      },
    });
    expect(hits.length).toBeLessThanOrEqual(1);
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("memoryGet returns line ranges", async () => {
    const dir = join(home, "memory", "facts");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "sample.md");
    await writeFile(path, "line1\nline2\nline3\nline4\n", "utf-8");
    const text = await memoryGet({ path, startLine: 2, endLine: 3 });
    expect(text).toBe("line2\nline3");
  });

  it("extract/apply facts and consolidate L2", async () => {
    await applyFactDecisions([
      {
        action: "ADD",
        content: "Prefer Option A for layout defaults.",
        confidence: 0.8,
        reason: "test",
      },
    ]);
    const facts = await listFacts();
    expect(facts.some((f) => f.content.includes("Option A"))).toBe(true);

    const sessionDir = join(home, "memory", "sessions", "s2");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "summary.md"), "## Goal\n\nDaily rollup.\n", "utf-8");
    const rolled = await consolidateL1ToL2({ dateKey: "2026-07-14", sessionIds: ["s2" as never] });
    expect(rolled.sessions).toBe(1);
  });

  it("curator promotes long L1 into L5", async () => {
    const sessionDir = join(home, "memory", "sessions", "longsess01");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "summary.md"),
      `# Summary\n\n${"Milestone content for episode promotion. ".repeat(30)}\n`,
      "utf-8",
    );
    await writeFact({
      id: "fact-old",
      content: "stale",
      confidence: 0.1,
      source: "t",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    const report = await runMemoryCurator({
      factMaxAgeDays: 1,
      minConfidence: 0.3,
      episodeMinChars: 200,
      enableVectors: true,
    });
    expect(report.factsDeleted).toBeGreaterThanOrEqual(1);
    expect(report.episodesPromoted).toBeGreaterThanOrEqual(1);
  });
});
