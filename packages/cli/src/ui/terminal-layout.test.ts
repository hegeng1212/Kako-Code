import { describe, expect, it } from "vitest";
import { displayWidth, stripAnsi } from "./ansi.js";
import { renderTurnToLines, type ChatTurn } from "./chat-blocks.js";
import {
  ChatLayout,
  CHAT_FOOTER_HEIGHT,
  buildTerminalInputModeEnablement,
  coalescePasteActions,
  contentClickMousePhase,
  contentLineIndexFromScreen,
  getTerminalSize,
  parseInputActions,
  resolveContentClickAction,
  resolveContentClickTarget,
  resolveFooterLayoutHeight,
  wrapContentLines,
} from "./terminal-layout.js";
import { renderInitialInputFooter } from "./welcome.js";

describe("buildTerminalInputModeEnablement", () => {
  it("always re-arms mouse, bracketed paste, and focus reporting", () => {
    const seq = buildTerminalInputModeEnablement({});
    expect(seq).toContain("\x1b[?1000h");
    expect(seq).toContain("\x1b[?1006h");
    expect(seq).toContain("\x1b[?2004h");
    expect(seq).toContain("\x1b[?1004h");
    expect(seq).not.toContain("\x1b[?1002h");
    expect(seq).not.toContain("\x1b[?1003h");
  });

  it("includes drag tracking when the input is selecting", () => {
    const seq = buildTerminalInputModeEnablement({ mouseDrag: true });
    expect(seq).toContain("\x1b[?1002h");
    expect(seq).not.toContain("\x1b[?1003h");
  });

  it("prefers Agents any-event mouse over drag tracking", () => {
    const seq = buildTerminalInputModeEnablement({ mouseDrag: true, mouseAnyEvent: true });
    expect(seq).toContain("\x1b[?1003h");
    expect(seq).not.toContain("\x1b[?1002h");
  });
});

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
    expandedThoughts: new Set(),
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
      thoughtIndex: 0,
    });
  });

  it("resolves each thought summary to its own timeline index", () => {
    const now = Date.now();
    const lines = renderTurnToLines(
      baseTurn({
        timeline: [
          {
            type: "thinking",
            text: "first",
            startedAt: now - 5000,
            lastChunkAt: now - 4000,
            endedAt: now - 4000,
          },
          { type: "answer", text: "bridge" },
          {
            type: "thinking",
            text: "second",
            startedAt: now - 3000,
            lastChunkAt: now - 2000,
            endedAt: now - 2000,
          },
          { type: "answer", text: "done" },
        ],
      }),
      100,
      now,
    );
    const thoughts = lines.filter((line) => line.meta?.kind === "thought-summary");
    expect(thoughts).toHaveLength(2);
    expect(resolveContentClickAction(thoughts[0])).toEqual({
      type: "toggleThought",
      turnId: "turn-1",
      thoughtIndex: 0,
    });
    expect(resolveContentClickAction(thoughts[1])).toEqual({
      type: "toggleThought",
      turnId: "turn-1",
      thoughtIndex: 2,
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
  it("parses ctrl+b for foreground agent background promote", () => {
    expect(parseInputActions("\u0002").actions).toEqual([{ type: "ctrlB" }]);
  });

  it("parses ctrl+c and ctrl+d as interrupt (ctrl+d survives native copy-on-selection)", () => {
    expect(parseInputActions("\u0003").actions).toEqual([{ type: "interrupt" }]);
    expect(parseInputActions("\u0004").actions).toEqual([{ type: "interrupt" }]);
  });

  it("parses terminal focus-in for viewport repaint", () => {
    expect(parseInputActions("\x1b[I").actions).toEqual([{ type: "focusIn" }]);
  });

  it("buildTerminalInputModeEnablement is idempotent for periodic reassert", () => {
    const a = buildTerminalInputModeEnablement({});
    const b = buildTerminalInputModeEnablement({});
    expect(a).toBe(b);
    expect(a).toContain("\x1b[?1000h");
  });

  it("expands thinking by default while streaming", () => {
    const layout = new ChatLayout(
      () => ({
        version: "0.0.0",
        agentName: "main",
        modelLabel: "test",
        cwd: "/tmp",
        sessionId: "sess-think",
        sessionLabel: "main",
        dataDir: "/tmp",
      }),
      renderInitialInputFooter(),
    );
    layout.setSessionId("sess-think");
    layout.beginTurn("摸清 LLM");
    layout.appendThinking("用户现在需要全面摸清");
    const turn = (
      layout as unknown as { activeTurn: { expandedThoughts: Set<number>; timeline: unknown[] } }
    ).activeTurn;
    expect(turn).not.toBeNull();
    expect(turn!.expandedThoughts.has(0)).toBe(true);
  });

  it("collapses expandedThoughts when thinking stream ends", () => {
    const layout = new ChatLayout(
      () => ({
        version: "0.0.0",
        agentName: "main",
        modelLabel: "test",
        cwd: "/tmp",
        sessionId: "sess-think-end",
        sessionLabel: "main",
        dataDir: "/tmp",
      }),
      renderInitialInputFooter(),
    );
    layout.setSessionId("sess-think-end");
    layout.beginTurn("摸清 LLM");
    layout.appendThinking("用户现在需要全面摸清");
    layout.endThinkingStream();
    const turn = (
      layout as unknown as { activeTurn: { expandedThoughts: Set<number> } | null }
    ).activeTurn;
    expect(turn).not.toBeNull();
    expect(turn!.expandedThoughts.has(0)).toBe(false);
  });

  it("collapses expandedThoughts when answer starts", () => {
    const layout = new ChatLayout(
      () => ({
        version: "0.0.0",
        agentName: "main",
        modelLabel: "test",
        cwd: "/tmp",
        sessionId: "sess-think-ans",
        sessionLabel: "main",
        dataDir: "/tmp",
      }),
      renderInitialInputFooter(),
    );
    layout.setSessionId("sess-think-ans");
    layout.beginTurn("摸清 LLM");
    layout.appendThinking("先想一下");
    layout.appendAnswer("你好");
    const turn = (
      layout as unknown as { activeTurn: { expandedThoughts: Set<number> } | null }
    ).activeTurn;
    expect(turn).not.toBeNull();
    expect(turn!.expandedThoughts.has(0)).toBe(false);
  });

  it("does not re-paste full answerText when thinking resumes mid-answer", () => {
    const layout = new ChatLayout(
      () => ({
        version: "0.0.0",
        agentName: "main",
        modelLabel: "test",
        cwd: "/tmp",
        sessionId: "sess-interleave",
        sessionLabel: "main",
        dataDir: "/tmp",
      }),
      renderInitialInputFooter(),
    );
    layout.setSessionId("sess-interleave");
    layout.beginTurn("");
    layout.appendTurnTimeline("└ workflow finished");
    layout.appendThinking("plan the report");
    layout.appendAnswer("# 中国婚姻调研报告\n\n摘要第一段");
    // Late reasoning after answer started must not split / re-paste the answer.
    layout.appendThinking("tighten the numbers");
    layout.appendAnswer("。2023年曾因疫情后补偿性结婚潮回升。");

    const turn = (
      layout as unknown as {
        activeTurn: {
          answerText: string;
          timeline: Array<{ type: string; text?: string }>;
        } | null;
      }
    ).activeTurn;
    expect(turn).not.toBeNull();
    const answers = turn!.timeline.filter((e) => e.type === "answer");
    expect(answers).toHaveLength(1);
    expect(answers[0]!.text).toBe(
      "# 中国婚姻调研报告\n\n摘要第一段。2023年曾因疫情后补偿性结婚潮回升。",
    );
    expect(turn!.answerText).toBe(answers[0]!.text);
    expect(turn!.timeline.filter((e) => e.type === "thinking")).toHaveLength(1);

    const plain = renderTurnToLines(turn as ChatTurn, 80, { now: Date.now(), isActive: true }).map(
      (l) => l.text.replace(/\x1b\[[0-9;]*m/g, ""),
    );
    const titleHits = plain.filter((l) => l.includes("中国婚姻调研报告")).length;
    expect(titleHits).toBe(1);
  });

  it("drops silentChat / muted recap stream so thinking never enters the timeline", () => {
    const layout = new ChatLayout(
      () => ({
        version: "0.0.0",
        agentName: "main",
        modelLabel: "test",
        cwd: "/tmp",
        sessionId: "sess-recap-mute",
        sessionLabel: "main",
        dataDir: "/tmp",
      }),
      renderInitialInputFooter(),
    );
    layout.setSessionId("sess-recap-mute");
    layout.beginTurn("主对话");
    layout.appendAnswer("主回复");
    layout.finishTurn();

    layout.muteChatStream();
    layout.beginTurn("");
    layout.markActiveTurnHarnessOnly({ silentChat: true });
    layout.appendThinking("用户离开后回来，需要一个简要的回顾。");
    layout.appendThinking("用户现在回来，我需要按照要求写一个简短的总结。");
    layout.appendAnswer("已完成探索，等待下一步指示。");
    const active = (
      layout as unknown as { activeTurn: { timeline: Array<{ type: string }> } | null }
    ).activeTurn;
    expect(active?.timeline ?? []).toEqual([]);
    layout.suppressActiveTurnAnswer();
    layout.applyRecapToLastCompletedTurn("已完成探索，等待下一步指示。");
    layout.finishTurn();
    layout.unmuteChatStream();

    const turns = (layout as unknown as { turns: Array<{ recapText?: string; timeline: unknown[] }> })
      .turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]!.recapText).toContain("已完成探索");
    expect(turns[0]!.timeline.some((e) => (e as { type: string }).type === "thinking")).toBe(false);
  });

  it("parses terminal focus-out for stepped-away idle tracking", () => {
    expect(parseInputActions("\x1b[O").actions).toEqual([{ type: "focusOut" }]);
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

  it("buffers incomplete SGR mouse wheel instead of leaking into chars", () => {
    const partial = parseInputActions("\x1b[<65;80;30");
    expect(partial.actions).toEqual([]);
    expect(partial.rest).toBe("\x1b[<65;80;30");
    const complete = parseInputActions(`${partial.rest}M`);
    expect(complete.actions).toEqual([{ type: "scroll", delta: 3 }]);
    expect(complete.rest).toBe("");
  });

  it("buffers a lone ESC so a following mouse chunk is not typed as text", () => {
    const first = parseInputActions("\x1b");
    expect(first.actions).toEqual([]);
    expect(first.rest).toBe("\x1b");
    const second = parseInputActions(`${first.rest}[<65;80;30M`);
    expect(second.actions).toEqual([{ type: "scroll", delta: 3 }]);
    expect(second.rest).toBe("");
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

  it("parses SGR any-event hover as mouseMove", () => {
    // btn 35 = motion (32) + no button (3)
    const { actions } = parseInputActions("\x1b[<35;12;8M");
    expect(actions).toEqual([{ type: "mouseMove", col: 12, row: 8 }]);
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
    expect(parseInputActions("\x1b").rest).toBe("\x1b");
    expect(parseInputActions("\x1bx").actions).toEqual([
      { type: "escape" },
      { type: "char", char: "x" },
    ]);
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

  it("wraps CJK by display columns so padToWidth does not strip muted SGR", () => {
    const cjk = "你好世界测试一二三四五六七八九十"; // 16 chars → 32 cols
    const lines = wrapContentLines(cjk, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(10);
    }
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

  it("flags content redraw when painted footer height diverges from reserved", () => {
    expect(resolveFooterLayoutHeight(5, 4, 20)).toEqual({
      height: 4,
      needsContentRedraw: true,
    });
    expect(resolveFooterLayoutHeight(4, 4, 20)).toEqual({
      height: 4,
      needsContentRedraw: false,
    });
    expect(resolveFooterLayoutHeight(4, 30, 10)).toEqual({
      height: 10,
      needsContentRedraw: true,
    });
  });
});

describe("ChatLayout Agents session switch", () => {
  it("keeps a parked live turn when loading another session transcript", async () => {
    const layout = new ChatLayout(
      () => ({
        version: "0.0.0",
        agentName: "main",
        modelLabel: "test",
        cwd: "/tmp",
        sessionId: "sess-a",
        sessionLabel: "main",
        dataDir: "/tmp",
      }),
      renderInitialInputFooter(),
    );
    layout.setSessionId("sess-a");
    layout.beginTurn("working prompt");
    expect(layout.isTurnInProgress()).toBe(true);

    layout.parkForegroundSession();
    layout.setSessionId("sess-b");
    await layout.loadSessionFromTranscript("sess-b-nonexistent");

    expect(layout.restoreParkedSession("sess-a")).toBe(true);
    expect(layout.isTurnInProgress()).toBe(true);
    expect(layout.hasActiveTurn()).toBe(true);
  });
});
