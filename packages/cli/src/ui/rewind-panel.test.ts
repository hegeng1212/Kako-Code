import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@kako/shared";
import { stripAnsi } from "./ansi.js";
import { rewindTurnsFromTranscript } from "./session-history.js";
import {
  buildRewindListRows,
  defaultRewindListSelection,
  formatRewindRelativeTime,
  renderRewindConfirmPanel,
  renderRewindListPanel,
  renderRewindSeparator,
  rewindConfirmActions,
  rewindConfirmEffectLine,
} from "./rewind-panel.js";

function msg(
  partial: Partial<TranscriptMessage> & Pick<TranscriptMessage, "role" | "content">,
): TranscriptMessage {
  return {
    id: partial.id ?? `m-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: partial.timestamp ?? "2026-07-14T00:00:00.000Z",
    ...partial,
  };
}

describe("rewindTurnsFromTranscript", () => {
  it("returns display user prompts with L0 indexes", () => {
    const transcript = [
      msg({ id: "u1", role: "user", content: "你好", metadata: { cliInput: true } }),
      msg({ id: "a1", role: "assistant", content: "hi" }),
      msg({
        id: "h",
        role: "user",
        content: "injected",
        metadata: { harnessInjected: true },
      }),
      msg({ id: "u2", role: "user", content: "继续", metadata: { cliInput: true } }),
    ];
    const anchors = rewindTurnsFromTranscript(transcript);
    expect(anchors).toEqual([
      {
        text: "你好",
        timestamp: "2026-07-14T00:00:00.000Z",
        transcriptIndex: 0,
        hasCodeChanges: false,
        filesChanged: undefined,
      },
      {
        text: "继续",
        timestamp: "2026-07-14T00:00:00.000Z",
        transcriptIndex: 3,
        hasCodeChanges: false,
        filesChanged: undefined,
      },
    ]);
  });
});

describe("formatRewindRelativeTime", () => {
  const now = Date.parse("2026-07-14T12:00:00.000Z");

  it("uses a single unit under one day", () => {
    expect(formatRewindRelativeTime("2026-07-14T11:59:42.000Z", now)).toBe("18s ago");
    expect(formatRewindRelativeTime("2026-07-14T11:55:00.000Z", now)).toBe("5m ago");
    expect(formatRewindRelativeTime("2026-07-14T10:00:00.000Z", now)).toBe("2h ago");
  });

  it("uses day + hour over one day", () => {
    expect(formatRewindRelativeTime("2026-07-13T12:00:00.000Z", now)).toBe("1天");
    expect(formatRewindRelativeTime("2026-07-13T08:00:00.000Z", now)).toBe("1天4小时");
    expect(formatRewindRelativeTime("2026-07-09T12:00:00.000Z", now)).toBe("5天");
  });
});

describe("rewind panel helpers", () => {
  it("appends (current) and defaults selection to it", () => {
    const rows = buildRewindListRows([
      { text: "a", timestamp: "2026-07-14T00:00:00.000Z", transcriptIndex: 0 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.kind).toBe("current");
    expect(defaultRewindListSelection(rows)).toBe(1);
  });

  it("renders list with Claude-style gaps and No code changes", () => {
    const rows = buildRewindListRows([
      { text: "你好啊", timestamp: "2026-07-09T00:00:00.000Z", transcriptIndex: 0 },
      {
        text: "/deep-research report",
        timestamp: "2026-07-13T00:00:00.000Z",
        transcriptIndex: 2,
      },
    ]);
    const listLines = renderRewindListPanel({
      rows,
      selected: rows.length - 1,
      cols: 80,
      now: Date.parse("2026-07-14T00:00:00.000Z"),
    });
    const list = listLines.join("\n");
    const plain = stripAnsi(list);
    expect(plain).toContain("Rewind");
    expect(plain).toContain("Restore the code and/or conversation");
    expect(plain).toContain("(current)");
    expect(plain).toContain("你好啊");
    expect(plain).toContain("(5天)");
    expect(plain).toContain("(1天)");
    expect(plain).toContain("No code changes");
    expect(plain).toContain("Enter to continue · Esc to cancel");
    // Blank line between history entries (Claude list spacing).
    const idx = listLines.findIndex((l) => stripAnsi(l).includes("你好啊"));
    expect(stripAnsi(listLines[idx + 1] ?? "")).toContain("No code changes");
    expect(stripAnsi(listLines[idx + 2] ?? "").trim()).toBe("");
  });

  it("renders confirm with message bar, warning, and actions", () => {
    const confirm = renderRewindConfirmPanel({
      messageText: "你好啊",
      timestamp: "2026-07-09T00:00:00.000Z",
      actionIndex: 1,
      context: "",
      cols: 80,
      now: Date.parse("2026-07-14T00:00:00.000Z"),
    }).join("\n");
    const plain = stripAnsi(confirm);
    expect(plain).toContain("Confirm you want to restore");
    expect(plain).toContain("│");
    expect(plain).toContain("你好啊");
    expect(plain).toContain("Summarize from here");
    expect(plain).toContain("add context (optional)");
    expect(plain).toContain("Rewinding does not affect files edited manually or via bash");
    expect(plain).not.toContain("Restore code and conversation");
    expect(rewindConfirmActions(false)).toHaveLength(4);
    expect(rewindConfirmActions(true).map((a) => a.id)).toEqual([
      "restore_both",
      "restore",
      "restore_code",
      "summarize_from",
      "summarize_up_to",
      "never_mind",
    ]);
    expect(rewindConfirmEffectLine("never_mind")).toMatch(/unchanged/i);
  });

  it("shows Restore code options when the turn had file edits", () => {
    const confirm = renderRewindConfirmPanel({
      messageText: "改接口",
      timestamp: "2026-07-14T00:00:00.000Z",
      actionIndex: 0,
      context: "",
      cols: 80,
      now: Date.parse("2026-07-14T22:00:00.000Z"),
      hasCodeChanges: true,
      filesChanged: {
        count: 4,
        additions: 8,
        deletions: 41,
        primaryFile: "doubao_validator.go",
      },
    }).join("\n");
    const plain = stripAnsi(confirm);
    expect(plain).toContain("Restore code and conversation");
    expect(plain).toContain("Restore code");
    expect(plain).toContain("Restore conversation");
    expect(plain).toContain("+8");
    expect(plain).toContain("-41");
    expect(plain).toContain("doubao_validator.go");
  });

  it("renders cyan separator with optional badge", () => {
    const plain = stripAnsi(renderRewindSeparator(40, "add-doubao-model-api"));
    expect(plain).toContain("─");
    expect(plain).toContain("add-doubao-model-api");
    expect(stripAnsi(renderRewindSeparator(10)).length).toBe(10);
  });
});
