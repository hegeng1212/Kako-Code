import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TranscriptMessage } from "@kako/shared";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";
import {
  projectToolResultsForContext,
  consolidateToL1,
  runCompactionCascade,
} from "./compact.js";
import { formatL1Summary, mergeCumulativeL1, parseL1Summary } from "./l1.js";
import { createPin, selectPinsForInject } from "./pins.js";
import { estimateTextTokens, softCompactThreshold } from "./tokens.js";
import { FileMemoryStore, createMessage } from "./store.js";
import { closeMemoryFtsDb } from "./index-fts.js";

function msg(
  partial: Omit<TranscriptMessage, "id" | "timestamp"> & Partial<Pick<TranscriptMessage, "id" | "timestamp">>,
): TranscriptMessage {
  return {
    id: partial.id ?? "m1",
    timestamp: partial.timestamp ?? new Date().toISOString(),
    role: partial.role,
    content: partial.content,
    toolCallId: partial.toolCallId,
    toolName: partial.toolName,
    toolCalls: partial.toolCalls,
    metadata: partial.metadata,
  };
}

describe("memory tokens", () => {
  it("estimates tokens from character length", () => {
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcdefgh")).toBe(2);
  });

  it("computes soft compact threshold from context window", () => {
    const t = softCompactThreshold(100_000, DEFAULT_MEMORY_INJECT_CAPS);
    expect(t).toBe(Math.floor((100_000 - 8192) * 0.8));
  });
});

describe("Tier A tool-result projection", () => {
  it("folds oversized tool results while keeping recent Read for same path", () => {
    const big = "x".repeat(DEFAULT_MEMORY_INJECT_CAPS.toolResultMaxChars + 100);
    const transcript = [
      msg({
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "Read", input: { file_path: "/tmp/a.ts" } }],
      }),
      msg({ role: "tool", content: "old full content " + "y".repeat(100), toolCallId: "c1", toolName: "Read" }),
      msg({
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c2", name: "Read", input: { file_path: "/tmp/a.ts" } }],
      }),
      msg({ role: "tool", content: "new full content", toolCallId: "c2", toolName: "Read" }),
      msg({ role: "tool", content: big, toolCallId: "c3", toolName: "Bash" }),
    ];
    const view = projectToolResultsForContext(transcript);
    expect(view[1]?.metadata?.toolResultFolded).toBe(true);
    expect(view[1]?.content).toContain("folded tool result");
    expect(view[3]?.content).toBe("new full content");
    expect(view[4]?.metadata?.toolResultFolded).toBe(true);
  });
});

describe("L1 cumulative consolidate", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-mem-"));
    prevHome = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prevHome;
    closeMemoryFtsDb();
    await rm(home, { recursive: true, force: true });
  });

  it("accumulates Historical Context across consolidations", async () => {
    const sessionId = "sess-option-a";
    const store = new FileMemoryStore(sessionId);
    await store.append(createMessage("user", "Choose Option A for the path layout."));
    await store.append(createMessage("assistant", "Using Option A."));
    const first = await consolidateToL1({
      sessionId,
      transcript: await store.loadTranscript(),
    });
    expect(first.sections.Goal).toContain("Option A");
    expect(first.frontmatter.compactGeneration).toBe(1);

    await store.append(createMessage("user", "Now apply Option B for the naming."));
    const second = await consolidateToL1({
      sessionId,
      transcript: await store.loadTranscript(),
    });
    expect(second.frontmatter.compactGeneration).toBe(2);
    expect(second.sections["Historical Context"]).toContain("Compact gen 1");
    const formatted = formatL1Summary(second);
    expect(formatted).toContain("## Historical Context");
    expect(formatted).toContain("compactGeneration: 2");
  });

  it("parses frontmatter round-trip", () => {
    const merged = mergeCumulativeL1(
      null,
      { Goal: "Ship caps", Next: "Write tests" },
      "s1" as never,
      1,
    );
    const text = formatL1Summary(merged);
    const parsed = parseL1Summary(text, "s1" as never);
    expect(parsed.frontmatter.compactGeneration).toBe(1);
    expect(parsed.sections.Goal).toContain("Ship caps");
  });
});

describe("pins caps", () => {
  it("enforces count and bytes caps", () => {
    const pins = [
      createPin("a".repeat(100)),
      createPin("b".repeat(100)),
      createPin("c".repeat(100)),
    ];
    const selected = selectPinsForInject(pins, {
      ...DEFAULT_MEMORY_INJECT_CAPS,
      pinsMaxCount: 2,
      pinsMaxBytes: 150,
    });
    expect(selected.length).toBe(1);
  });
});

describe("compaction cascade", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-cascade-"));
    prevHome = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prevHome;
    closeMemoryFtsDb();
    await rm(home, { recursive: true, force: true });
  });

  it("stays at Tier A under soft threshold", async () => {
    const result = await runCompactionCascade({
      sessionId: "tiny",
      transcript: [createMessage("user", "hello")],
      contextWindow: 128_000,
    });
    expect(result.result.tierApplied).toBe("A");
    expect(result.viewTranscript).toHaveLength(1);
  });
});
