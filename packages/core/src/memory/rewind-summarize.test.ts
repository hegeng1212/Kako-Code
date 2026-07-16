import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TranscriptMessage } from "@kako/shared";
import { FileMemoryStore } from "./store.js";
import {
  selectedTurnEndIndex,
  summarizeTranscriptRange,
} from "./rewind-summarize.js";

function msg(
  role: TranscriptMessage["role"],
  content: string,
  id: string,
  extra?: Partial<TranscriptMessage>,
): TranscriptMessage {
  return {
    id,
    role,
    content,
    timestamp: "2026-07-14T10:00:00.000Z",
    ...extra,
  };
}

describe("selectedTurnEndIndex", () => {
  it("returns index of next user message", () => {
    const transcript = [
      msg("user", "a", "1", { metadata: { cliInput: true } }),
      msg("assistant", "reply", "2"),
      msg("user", "b", "3", { metadata: { cliInput: true } }),
    ];
    expect(selectedTurnEndIndex(transcript, 0)).toBe(2);
    expect(selectedTurnEndIndex(transcript, 2)).toBe(3);
  });
});

describe("summarizeTranscriptRange", () => {
  afterEach(() => {
    delete process.env.KAKO_HOME;
  });

  it("summarize from_here keeps head turn and collapses the tail", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-rewind-"));
    process.env.KAKO_HOME = home;
    const sessionId = "sess-rewind-from";
    const store = new FileMemoryStore(sessionId);
    await store.rewriteTranscript([
      msg("user", "first", "1", { metadata: { cliInput: true } }),
      msg("assistant", "answer1", "2"),
      msg("user", "second", "3", { metadata: { cliInput: true } }),
      msg("assistant", "answer2", "4"),
    ]);

    await summarizeTranscriptRange({
      sessionId,
      selectedUserIndex: 0,
      mode: "from_here",
    });

    const next = await store.loadTranscript();
    expect(next[0]?.content).toBe("first");
    expect(next[1]?.content).toBe("answer1");
    expect(next).toHaveLength(3);
    expect(next[2]?.metadata?.rewindSummary).toBe(true);
    expect(next[2]?.content).toContain("second");
  });

  it("summarize up_to_here collapses head and keeps selected onwards", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-rewind-up-"));
    process.env.KAKO_HOME = home;
    const sessionId = "sess-rewind-up";
    const store = new FileMemoryStore(sessionId);
    await store.rewriteTranscript([
      msg("user", "first", "1", { metadata: { cliInput: true } }),
      msg("assistant", "answer1", "2"),
      msg("user", "second", "3", { metadata: { cliInput: true } }),
      msg("assistant", "answer2", "4"),
    ]);

    await summarizeTranscriptRange({
      sessionId,
      selectedUserIndex: 2,
      mode: "up_to_here",
      context: "keep focus on second",
    });

    const next = await store.loadTranscript();
    expect(next[0]?.metadata?.rewindSummary).toBe(true);
    expect(next[0]?.content).toContain("keep focus on second");
    expect(next[0]?.content).toContain("first");
    expect(next[1]?.content).toBe("second");
    expect(next[2]?.content).toBe("answer2");
  });

  it("from_here with nothing after selected turn is a no-op", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-rewind-noop-"));
    process.env.KAKO_HOME = home;
    const sessionId = "sess-rewind-noop";
    const store = new FileMemoryStore(sessionId);
    const original = [
      msg("user", "only", "1", { metadata: { cliInput: true } }),
      msg("assistant", "done", "2"),
    ];
    await store.rewriteTranscript(original);

    await summarizeTranscriptRange({
      sessionId,
      selectedUserIndex: 0,
      mode: "from_here",
    });

    expect(await store.loadTranscript()).toEqual(original);
  });
});
