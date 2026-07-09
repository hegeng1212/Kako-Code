import { describe, expect, it } from "vitest";
import { displayWidth } from "./ansi.js";
import { CHAT_FOOTER_HEIGHT, coalescePasteActions, getTerminalSize, parseInputActions, wrapContentLines } from "./terminal-layout.js";

describe("displayWidth", () => {
  it("counts CJK characters as width 2", () => {
    expect(displayWidth("你好")).toBe(4);
    expect(displayWidth("> 你好")).toBe(6);
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
    expect(actions).toEqual([{ type: "click", col: 12, row: 8 }]);
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
