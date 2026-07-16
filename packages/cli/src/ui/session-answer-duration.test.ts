import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@kako/shared";
import { formatAnswerDuration, sessionAnswerDurationMs } from "./session-answer-duration.js";
import { chatTurnsFromTranscript } from "./session-history.js";
import { turnElapsedSeconds } from "./chat-blocks.js";

function msg(
  partial: Pick<TranscriptMessage, "role" | "timestamp"> & Partial<TranscriptMessage>,
): TranscriptMessage {
  return {
    id: partial.id ?? `m-${partial.timestamp}`,
    role: partial.role,
    content: partial.content ?? "x",
    timestamp: partial.timestamp,
    ...partial,
  };
}

describe("sessionAnswerDurationMs", () => {
  it("matches Sum of chat Done durations (user start → last model)", () => {
    const transcript = [
      msg({ role: "user", timestamp: "2026-07-14T12:00:00.000Z", metadata: { cliInput: true } }),
      msg({ role: "assistant", timestamp: "2026-07-14T12:00:12.000Z" }),
      msg({ role: "user", timestamp: "2026-07-14T12:01:00.000Z", metadata: { cliInput: true } }),
      msg({ role: "assistant", timestamp: "2026-07-14T12:01:05.000Z" }),
      msg({ role: "tool", timestamp: "2026-07-14T12:01:20.000Z" }),
    ];
    // turn1: 12s; turn2: 20s → 32s (same as chatTurnsFromTranscript Done lines)
    expect(sessionAnswerDurationMs(transcript)).toBe(32_000);

    const turns = chatTurnsFromTranscript(transcript);
    const fromTurns = turns.reduce((sum, turn) => {
      if (!turn.finishedAt) return sum;
      return sum + Math.max(0, turn.finishedAt - turn.thinkingStartedAt);
    }, 0);
    expect(sessionAnswerDurationMs(transcript)).toBe(fromTurns);
    // Displayed Worked-for seconds round per turn; Agent column uses exact ms sum.
    const displayedSec = turns.reduce((sum, turn) => sum + turnElapsedSeconds(turn), 0);
    expect(displayedSec).toBe(32);
  });

  it("counts single-assistant turns (Agents used to under-count as 0)", () => {
    const transcript = [
      msg({ role: "user", timestamp: "2026-07-14T12:00:00.000Z" }),
      msg({ role: "assistant", timestamp: "2026-07-14T12:00:54.000Z" }),
    ];
    expect(sessionAnswerDurationMs(transcript)).toBe(54_000);
  });

  it("returns 0 when there is no model output", () => {
    expect(
      sessionAnswerDurationMs([msg({ role: "user", timestamp: "2026-07-14T12:00:00.000Z" })]),
    ).toBe(0);
  });
});

describe("formatAnswerDuration", () => {
  it("formats compact durations", () => {
    expect(formatAnswerDuration(0)).toBe("");
    expect(formatAnswerDuration(999)).toBe("");
    expect(formatAnswerDuration(12_000)).toBe("12s");
    expect(formatAnswerDuration(125_000)).toBe("2m");
    expect(formatAnswerDuration(3_600_000)).toBe("1h");
  });
});
