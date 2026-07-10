import { ansi, charDisplayWidth, displayWidth } from "./ansi.js";
import { renderClaudeInputLine } from "./box.js";
import { renderSlashInputText } from "./slash-suggest.js";

/** Visible logical lines in the input box (Claude Code-style). */
export const INPUT_MAX_VISIBLE_LINES = 20;

export const INPUT_PROMPT = "> ";
export const INPUT_CONTINUATION = "  ";
export const INPUT_SELECTION_BG = "\x1b[48;5;67m";

export interface InputSelectionRange {
  start: number;
  end: number;
}

export function normalizeSelectionRange(start: number, end: number): InputSelectionRange {
  if (start <= end) return { start, end };
  return { start: end, end: start };
}

export function selectedText(value: string, start: number, end: number): string {
  const range = normalizeSelectionRange(start, end);
  if (range.start === range.end) return "";
  return value.slice(range.start, range.end);
}

export function inputOffsetFromScreen(opts: {
  value: string;
  scrollRow: number;
  screenRow: number;
  screenCol: number;
}): number {
  const lines = splitLogicalLines(opts.value.length ? opts.value : "");
  const globalLine = opts.scrollRow + opts.screenRow;
  if (globalLine < 0 || globalLine >= lines.length) {
    return opts.value.length;
  }
  const prefix = globalLine === 0 ? INPUT_PROMPT : INPUT_CONTINUATION;
  const prefixCols = displayWidth(prefix);
  const colInLine = Math.max(0, opts.screenCol - 1 - prefixCols);
  return offsetForLineCol(opts.value, globalLine, colInLine);
}

function renderPlainWithSelection(
  text: string,
  lineStart: number,
  selection: InputSelectionRange,
): string {
  let out = "";
  let offset = lineStart;
  for (const char of text) {
    const charLen = char.length;
    const selected = offset < selection.end && offset + charLen > selection.start;
    out += selected ? `${INPUT_SELECTION_BG}${ansi.text}${char}${ansi.reset}` : char;
    offset += charLen;
  }
  return `${ansi.text}${out}${ansi.reset}`;
}

function renderVisibleInputLine(
  lineText: string,
  globalLine: number,
  lineStart: number,
  selection: InputSelectionRange | null,
): string {
  const hasSelectionOnLine =
    selection &&
    selection.start !== selection.end &&
    lineStart < selection.end &&
    lineStart + lineText.length > selection.start;

  const body = hasSelectionOnLine
    ? renderPlainWithSelection(lineText, lineStart, selection!)
    : renderSlashInputText(lineText);

  if (globalLine === 0) {
    return `${ansi.text}${ansi.bold}>${ansi.reset} ${body}`;
  }
  return `${ansi.text}${INPUT_CONTINUATION}${body}${ansi.reset}`;
}

export function splitLogicalLines(text: string): string[] {
  return text.split("\n");
}

export function lineStartOffset(text: string, lineIndex: number): number {
  if (lineIndex <= 0) return 0;
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      if (line === lineIndex) return i + 1;
    }
  }
  return text.length;
}

export function lineEndOffset(text: string, lineIndex: number): number {
  const start = lineStartOffset(text, lineIndex);
  const nextNl = text.indexOf("\n", start);
  return nextNl === -1 ? text.length : nextNl;
}

export function cursorLogicalLine(text: string, cursor: number): number {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  let line = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

export function cursorColInLogicalLine(text: string, cursor: number): number {
  const start = lineStartOffset(text, cursorLogicalLine(text, cursor));
  return displayWidth(text.slice(start, cursor));
}

export function offsetForLineCol(text: string, lineIndex: number, col: number): number {
  const start = lineStartOffset(text, lineIndex);
  const lineText = text.slice(start, lineEndOffset(text, lineIndex));
  let offset = start;
  let width = 0;
  for (const char of lineText) {
    if (width >= col) break;
    width += displayWidth(char);
    offset += char.length;
  }
  return offset;
}

export function moveCursorUp(text: string, cursor: number): number {
  const line = cursorLogicalLine(text, cursor);
  if (line === 0) return cursor;
  const col = cursorColInLogicalLine(text, cursor);
  const prevLineStart = lineStartOffset(text, line - 1);
  const prevLineText = text.slice(prevLineStart, lineEndOffset(text, line - 1));
  const targetCol = Math.min(col, displayWidth(prevLineText));
  return offsetForLineCol(text, line - 1, targetCol);
}

export function moveCursorDown(text: string, cursor: number): number {
  const line = cursorLogicalLine(text, cursor);
  const lines = splitLogicalLines(text);
  if (line >= lines.length - 1) return cursor;
  const col = cursorColInLogicalLine(text, cursor);
  const nextLineText = lines[line + 1] ?? "";
  const targetCol = Math.min(col, displayWidth(nextLineText));
  return offsetForLineCol(text, line + 1, targetCol);
}

export function insertNewlineAtCursor(text: string, cursor: number): { text: string; cursor: number } {
  const next = `${text.slice(0, cursor)}\n${text.slice(cursor)}`;
  return { text: next, cursor: cursor + 1 };
}

export function shouldBrowseHistoryOnUp(text: string, cursor: number): boolean {
  return cursorLogicalLine(text, cursor) === 0;
}

export function shouldBrowseHistoryOnDown(text: string, cursor: number): boolean {
  const line = cursorLogicalLine(text, cursor);
  const lines = splitLogicalLines(text);
  return line === lines.length - 1 && cursor >= text.length;
}

/** Slice plain text by terminal display columns. */
export function slicePlainByDisplayWidth(text: string, skipCols: number, maxCols: number): string {
  if (maxCols <= 0) return "";
  let skipped = 0;
  let taken = 0;
  let out = "";
  for (const char of text) {
    const w = charDisplayWidth(char.codePointAt(0)!);
    if (skipped < skipCols) {
      const next = skipped + w;
      if (next <= skipCols) {
        skipped = next;
        continue;
      }
      skipped = next;
    }
    if (taken + w > maxCols) break;
    out += char;
    taken += w;
  }
  return out;
}

export function horizontalScrollCol(colInLine: number, maxBodyCols: number): number {
  if (maxBodyCols <= 1 || colInLine < maxBodyCols) return 0;
  return colInLine - maxBodyCols + 1;
}

export function clampInputScrollRow(
  scrollRow: number,
  cursorLine: number,
  totalLines: number,
  maxVisible: number = INPUT_MAX_VISIBLE_LINES,
): number {
  const maxScroll = Math.max(0, totalLines - maxVisible);
  let next = Math.max(0, Math.min(scrollRow, maxScroll));
  if (cursorLine < next) next = cursorLine;
  if (cursorLine >= next + maxVisible) next = cursorLine - maxVisible + 1;
  return Math.max(0, Math.min(next, maxScroll));
}

export interface RenderedMultilineInput {
  rows: string[];
  cursorScreenRow: number;
  cursorScreenCol: number;
  scrollRow: number;
}

export function renderMultilineInput(opts: {
  value: string;
  cursor: number;
  scrollRow: number;
  cols: number;
  placeholder?: string;
  maxVisibleLines?: number;
  selection?: InputSelectionRange | null;
}): RenderedMultilineInput {
  const maxVisible = opts.maxVisibleLines ?? INPUT_MAX_VISIBLE_LINES;
  const selection =
    opts.selection && opts.selection.start !== opts.selection.end ? opts.selection : null;

  if (!opts.value && opts.placeholder) {
    return {
      rows: [renderClaudeInputLine(opts.placeholder)],
      cursorScreenRow: 0,
      cursorScreenCol: 1 + displayWidth(INPUT_PROMPT),
      scrollRow: 0,
    };
  }

  const logicalLines = splitLogicalLines(opts.value.length ? opts.value : "");
  const cursorLine = cursorLogicalLine(opts.value, opts.cursor);
  const colInLine = cursorColInLogicalLine(opts.value, opts.cursor);
  const cursorPrefix = cursorLine === 0 ? INPUT_PROMPT : INPUT_CONTINUATION;
  const maxBodyCols = Math.max(1, opts.cols - displayWidth(cursorPrefix));
  const cursorScrollCol = horizontalScrollCol(colInLine, maxBodyCols);
  const scrollRow = clampInputScrollRow(
    opts.scrollRow,
    cursorLine,
    Math.max(1, logicalLines.length),
    maxVisible,
  );
  const visible = logicalLines.slice(scrollRow, scrollRow + maxVisible);
  if (!visible.length) visible.push("");

  const rows = visible.map((lineText, index) => {
    const globalLine = scrollRow + index;
    const lineStart = lineStartOffset(opts.value, globalLine);
    const prefix = globalLine === 0 ? INPUT_PROMPT : INPUT_CONTINUATION;
    const bodyCols = Math.max(1, opts.cols - displayWidth(prefix));
    const lineCol = globalLine === cursorLine ? colInLine : 0;
    const lineScrollCol =
      globalLine === cursorLine ? cursorScrollCol : horizontalScrollCol(lineCol, bodyCols);
    const clipped = slicePlainByDisplayWidth(lineText, lineScrollCol, bodyCols);
    return renderVisibleInputLine(clipped, globalLine, lineStart + lineScrollCol, selection);
  });

  return {
    rows,
    cursorScreenRow: cursorLine - scrollRow,
    cursorScreenCol: 1 + displayWidth(cursorPrefix) + (colInLine - cursorScrollCol),
    scrollRow,
  };
}

export function inputBlockRowCount(
  value: string,
  scrollRow: number,
  cols: number,
  maxVisibleLines: number = INPUT_MAX_VISIBLE_LINES,
): number {
  const rendered = renderMultilineInput({ value, cursor: 0, scrollRow, cols, maxVisibleLines });
  return rendered.rows.length;
}
