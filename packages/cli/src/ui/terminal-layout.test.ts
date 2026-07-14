import { describe, expect, it } from "vitest";
import { displayWidth, stripAnsi } from "./ansi.js";
import { renderTurnToLines, type ChatTurn } from "./chat-blocks.js";
import {
  CHAT_FOOTER_HEIGHT,
  coalescePasteActions,
  contentClickMousePhase,
  contentLineIndexFromScreen,
  getTerminalSize,
  parseInputActions,
  resolveContentClickAction,
  resolveContentClickTarget,
  wrapContentLines,
} from "./terminal-layout.js";

describe("displayWidth", () => {
  it("counts CJK characters as width 2", () => {
    expect(displayWidth("你好")).toBe(4);
    expect(displayWidth("> 你好")).toBe(6);
  });

  it("counts dingbat status marks as width 1", () => {
    expect(displayWidth("✔")).toBe(1);
    expect(displayWidth("✘")).toBe(1);
  });
});

function baseTurn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: "turn-1",
    userText: "hello",
    answerText: "",
    thinkingExpanded: false,
    thinkingStartedAt: Date.now() - 5000,
    thinkingEndedAt: Date.now() - 2000,
    finishedAt: Date.now() - 1000,
    doneVerb: "Done",
    generatingVerb: "Working",
    outputTokens: 0,
    phase: "done",
    timeline: [
      {
        type: "thinking",
        text: "Let me check the files.",
        startedAt: Date.now() - 5000,
        lastChunkAt: Date.now() - 3000,
        endedAt: Date.now() - 3000,
      },
      {
        type: "tool",
        id: "tool-1",
        name: "Read",
        detail: "/tmp/a.md",
        status: "success",
        dotFrame: 0,
      },
      {
        type: "tool",
        id: "tool-2",
        name: "Bash",
        detail: "ls -la",
        status: "success",
        dotFrame: 0,
      },
    ],
    expandedToolGroups: new Set(),
    expandedChoices: new Set(),
    pulseFrame: 0,
    ...overrides,
  };
}

describe("content click resolution", () => {
  it("clicks on mouseUp when drag tracking is enabled", () => {
    expect(contentClickMousePhase(true, "mouseDown")).toBe("ignore");
    expect(contentClickMousePhase(true, "mouseUp")).toBe("click");
  });

  it("clicks on mouseDown when drag tracking is disabled", () => {
    expect(contentClickMousePhase(false, "mouseDown")).toBe("click");
    expect(contentClickMousePhase(false, "mouseUp")).toBe("ignore");
  });

  it("maps screen rows into scrollable content indices", () => {
    expect(contentLineIndexFromScreen(13, 12, 20)).toBe(0);
    expect(contentLineIndexFromScreen(12, 12, 20)).toBeNull();
    expect(contentLineIndexFromScreen(33, 12, 20)).toBeNull();
  });

  it("resolves standalone thought summary toggles", () => {
    const lines = renderTurnToLines(
      baseTurn({
        timeline: [
          {
            type: "thinking",
            text: "planning",
            startedAt: Date.now() - 3000,
            lastChunkAt: Date.now() - 1000,
            endedAt: Date.now() - 1000,
          },
          { type: "answer", text: "done" },
        ],
      }),
      100,
      Date.now(),
    );
    const thought = lines.find((line) => line.meta?.kind === "thought-summary");
    expect(resolveContentClickAction(thought)).toEqual({
      type: "toggleThought",
      turnId: "turn-1",
    });
  });

  it("resolves thought-prefixed activity summaries as tool-group toggles", () => {
    const lines = renderTurnToLines(baseTurn(), 100, Date.now());
    const toolGroup = lines.find((line) => line.meta?.kind === "tool-group-toggle");
    expect(toolGroup).toBeDefined();
    expect(stripAnsi(toolGroup!.text)).toContain("Thought for");
    expect(resolveContentClickAction(toolGroup)).toEqual({
      type: "toggleToolGroup",
      turnId: "turn-1",
      groupId: "turn-1:activity:0",
    });
  });

  it("resolves clicks against the scrolled viewport", () => {
    const lines = renderTurnToLines(baseTurn(), 100, Date.now());
    const toolGroupIndex = lines.findIndex((line) => line.meta?.kind === "tool-group-toggle");
    expect(toolGroupIndex).toBeGreaterThanOrEqual(0);
    const headerHeight = 12;
    const scrollHeight = 8;
    const visibleIndex = 3;
    const action = resolveContentClickTarget({
      allLines: lines,
      scrollOffset: toolGroupIndex - visibleIndex,
      scrollHeight,
      screenRow: headerHeight + 1 + visibleIndex,
      headerHeight,
    });
    expect(action).toEqual({
      type: "toggleToolGroup",
      turnId: "turn-1",
      groupId: "turn-1:activity:0",
    });
  });
});

describe("parseInputActions", () => {
  it("parses terminal focus-in for viewport repaint", () => {
    expect(parseInputActions("\x1b[I").actions).toEqual([{ type: "focusIn" }]);
  });

  it("parses page up as scroll", () => {
    const { actions } = parseInputActions("\x1b[5~");
    expect(actions).toEqual([{ type: "scroll", delta: -1 }]);
  });

  it("parses page down as scroll", () => {
    const { actions } = parseInputActions("\x1b[6~");
    expect(actions).toEqual([{ type: "scroll", delta: 1 }]);
  });

  it("parses mouse wheel up as scroll", () => {
    const { actions } = parseInputActions("\x1b[<64;5;10M");
    expect(actions).toEqual([{ type: "scroll", delta: -3 }]);
  });

  it("parses X10 mouse wheel as scroll", () => {
    const up = `\x1b[M${String.fromCharCode(64 + 32)}${String.fromCharCode(5 + 32)}${String.fromCharCode(10 + 32)}`;
    const { actions } = parseInputActions(up);
    expect(actions).toEqual([{ type: "scroll", delta: -3 }]);
  });

  it("parses SGR left click without modifier", () => {
    const { actions } = parseInputActions("\x1b[<0;12;8M");
    expect(actions).toEqual([{ type: "mouseDown", col: 12, row: 8 }]);
  });

  it("parses SGR mouse drag and release", () => {
    const down = parseInputActions("\x1b[<0;12;8M").actions;
    const drag = parseInputActions("\x1b[<32;14;8M").actions;
    const up = parseInputActions("\x1b[<0;14;8m").actions;
    expect(down).toEqual([{ type: "mouseDown", col: 12, row: 8 }]);
    expect(drag).toEqual([{ type: "mouseDrag", col: 14, row: 8 }]);
    expect(up).toEqual([{ type: "mouseUp", col: 14, row: 8 }]);
  });

  it("parses SGR mouse release for content clicks", () => {
    const { actions } = parseInputActions("\x1b[<0;20;15m");
    expect(actions).toEqual([{ type: "mouseUp", col: 20, row: 15 }]);
  });

  it("parses arrow keys as input history navigation", () => {
    expect(parseInputActions("\x1b[D").actions).toEqual([{ type: "cursorLeft" }]);
    expect(parseInputActions("\x1b[C").actions).toEqual([{ type: "cursorRight" }]);
    expect(parseInputActions("\x1b[A").actions).toEqual([{ type: "historyUp" }]);
    expect(parseInputActions("\x1b[B").actions).toEqual([{ type: "historyDown" }]);
  });

  it("parses escape as its own action", () => {
    expect(parseInputActions("\x1b").actions).toEqual([{ type: "escape" }]);
  });

  it("parses Tab as tab action", () => {
    expect(parseInputActions("\t").actions).toEqual([{ type: "tab" }]);
  });

  it("parses shift+tab", () => {
    expect(parseInputActions("\x1b[Z").actions).toEqual([{ type: "shiftTab" }]);
  });

  it("parses home/end keys as cursor movement", () => {
    expect(parseInputActions("\x1b[1~").actions).toEqual([{ type: "cursorHome" }]);
    expect(parseInputActions("\x1b[4~").actions).toEqual([{ type: "cursorEnd" }]);
  });

  it("parses bracketed paste as pasteText", () => {
    const path = "/Users/hegeng/Pictures/photo.jpeg";
    const { actions, rest } = parseInputActions(`\x1b[200~${path}\x1b[201~`);
    expect(actions).toEqual([{ type: "pasteText", text: path }]);
    expect(rest).toBe("");
  });

  it("buffers incomplete bracketed paste", () => {
    const { actions, rest } = parseInputActions("\x1b[200~/tmp/a.png");
    expect(actions).toEqual([]);
    expect(rest).toBe("\x1b[200~/tmp/a.png");
    const next = parseInputActions(`${rest}\x1b[201~`);
    expect(next.actions).toEqual([{ type: "pasteText", text: "/tmp/a.png" }]);
    expect(next.rest).toBe("");
  });

  it("coalesces unbracketed multiline paste into pasteText", async () => {
    const { actions } = parseInputActions("line one\nline two");
    const coalesced = await coalescePasteActions(actions);
    expect(coalesced).toEqual([{ type: "pasteText", text: "line one\nline two" }]);
  });

  it("coalesces rapid char burst into pasteText", async () => {
    const { actions } = parseInputActions("hello world");
    const coalesced = await coalescePasteActions(actions);
    expect(coalesced).toEqual([{ type: "pasteText", text: "hello world" }]);
  });

  it("coalesces carriage-return separated paste into multiline pasteText", async () => {
    const { actions } = parseInputActions("[1] first\r[2] second");
    const coalesced = await coalescePasteActions(actions);
    expect(coalesced).toEqual([{ type: "pasteText", text: "[1] first\n[2] second" }]);
  });
});

describe("wrapContentLines", () => {
  it("wraps long plain text to width", () => {
    const lines = wrapContentLines("hello world foo bar", 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });

  it("preserves explicit newlines", () => {
    const lines = wrapContentLines("a\nb", 20);
    expect(lines).toEqual(["a", "b"]);
  });
});

describe("ChatLayout regions", () => {
  it("reserves middle area between header and footer", () => {
    const headerLines = 12;
    const footerHeight = CHAT_FOOTER_HEIGHT;
    const rows = 30;
    const contentHeight = Math.max(1, rows - headerLines - footerHeight);
    expect(contentHeight).toBe(14);
    expect(headerLines + contentHeight + footerHeight).toBe(rows);
  });

  it("uses full terminal columns", () => {
    const { cols } = getTerminalSize();
    expect(cols).toBeGreaterThan(0);
  });
});
