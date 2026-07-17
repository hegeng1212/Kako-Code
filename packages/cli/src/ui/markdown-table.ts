import { ansi, displayWidth, stripAnsi } from "./ansi.js";
import { clipAnsiToDisplayWidth } from "./markdown-code-highlight.js";
import { parseInlineParts, renderInlinePart, wrapInlineParts } from "./markdown-inline.js";

const CELL_PAD_X = 1;

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

export function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

export function extractMarkdownTable(
  lines: string[],
  startIndex: number,
): { table: ParsedTable; linesConsumed: number } | null {
  if (startIndex + 2 > lines.length) return null;

  const headers = parseTableRow(lines[startIndex]!);
  const separator = parseTableRow(lines[startIndex + 1]!);
  if (!headers || headers.length < 2 || !separator || !isSeparatorRow(separator)) {
    return null;
  }

  const rows: string[][] = [];
  let index = startIndex + 2;
  while (index < lines.length) {
    const row = parseTableRow(lines[index]!);
    if (!row || row.length < 2) break;
    rows.push(normalizeRow(row, headers.length));
    index++;
  }

  return {
    table: { headers, rows },
    linesConsumed: index - startIndex,
  };
}

function normalizeRow(row: string[], columnCount: number): string[] {
  const next = row.slice(0, columnCount);
  while (next.length < columnCount) next.push("");
  return next;
}

function renderCellContent(text: string, bold: boolean): string {
  if (!text) return "";
  if (bold) {
    return `${ansi.bold}${stripAnsi(parseInlineParts(text).map(renderInlinePart).join(""))}${ansi.reset}`;
  }
  return parseInlineParts(text).map(renderInlinePart).join("");
}

function padDisplay(text: string, targetWidth: number): string {
  // displayWidth strips ANSI; pad so every cell's outer width (and thus ┤/│) aligns.
  // After clipping, width may be < target when the next glyph is wide (CJK) and does
  // not fit — always pad back up so borders stay column-aligned.
  let content = text;
  let width = displayWidth(content);
  if (width > targetWidth) {
    content = clipAnsiToDisplayWidth(content, targetWidth);
    width = displayWidth(content);
  }
  if (width < targetWidth) {
    return content + " ".repeat(targetWidth - width);
  }
  return content;
}

function wrapCellText(text: string, maxWidth: number, bold: boolean): string[] {
  const rendered = renderCellContent(text, bold);
  const plain = stripAnsi(rendered);
  if (maxWidth < 1 || displayWidth(plain) <= maxWidth) {
    return [rendered];
  }
  return wrapInlineParts(parseInlineParts(text), maxWidth);
}

function cellDisplayWidth(text: string, bold: boolean): number {
  return displayWidth(stripAnsi(renderCellContent(text, bold)));
}

function naturalColumnWidths(table: ParsedTable): number[] {
  const columns = table.headers.length;
  const widths = new Array<number>(columns).fill(3);

  const allRows = [table.headers, ...table.rows];
  for (const row of allRows) {
    for (let col = 0; col < columns; col++) {
      const cell = row[col] ?? "";
      const isHeader = row === table.headers;
      widths[col] = Math.max(widths[col]!, cellDisplayWidth(cell, isHeader));
    }
  }

  return widths;
}

function fitColumnWidths(naturalWidths: number[], maxWidth: number): number[] {
  const borderOverhead = naturalWidths.length + 1;
  const paddingOverhead = naturalWidths.length * CELL_PAD_X * 2;
  const available = Math.max(10, maxWidth - borderOverhead - paddingOverhead);

  let total = naturalWidths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return naturalWidths;

  const minWidth = 3;
  const scaled = naturalWidths.map((width) =>
    Math.max(minWidth, Math.floor((width / total) * available)),
  );

  total = scaled.reduce((sum, width) => sum + width, 0);
  let overflow = total - available;
  if (overflow <= 0) return scaled;

  const order = scaled
    .map((width, index) => ({ width, index }))
    .sort((a, b) => b.width - a.width);
  for (const item of order) {
    if (overflow <= 0) break;
    if (scaled[item.index]! <= minWidth) continue;
    scaled[item.index]! -= 1;
    overflow -= 1;
  }

  return scaled;
}

function columnOuterWidth(innerWidth: number): number {
  return innerWidth + CELL_PAD_X * 2;
}

function horizontalBorder(
  innerWidths: number[],
  left: string,
  join: string,
  right: string,
): string {
  const segments = innerWidths.map((width) => "─".repeat(columnOuterWidth(width)));
  return `${ansi.tableBorder}${left}${segments.join(join)}${right}${ansi.reset}`;
}

function formatCellLine(content: string, innerWidth: number): string {
  const padded = padDisplay(content, innerWidth);
  return `${" ".repeat(CELL_PAD_X)}${padded}${" ".repeat(CELL_PAD_X)}`;
}

function renderTableRow(
  cells: string[],
  innerWidths: number[],
  bold: boolean,
): string[] {
  const wrapped = cells.map((cell, index) =>
    wrapCellText(cell, innerWidths[index] ?? 3, bold),
  );
  const contentLineCount = Math.max(...wrapped.map((lines) => lines.length), 1);
  const rendered: string[] = [];

  for (let lineIndex = 0; lineIndex < contentLineCount; lineIndex++) {
    const parts = innerWidths.map((width, colIndex) => {
      const cellLines = wrapped[colIndex] ?? [""];
      const content = cellLines[lineIndex] ?? "";
      return formatCellLine(content, width);
    });
    rendered.push(
      `${ansi.tableBorder}│${ansi.reset}${parts.join(`${ansi.tableBorder}│${ansi.reset}`)}${ansi.tableBorder}│${ansi.reset}`,
    );
  }

  return rendered;
}

export function renderTableLines(table: ParsedTable, maxWidth: number): string[] {
  const innerWidths = fitColumnWidths(naturalColumnWidths(table), maxWidth);
  const lines: string[] = [];

  lines.push(horizontalBorder(innerWidths, "┌", "┬", "┐"));
  lines.push(
    ...renderTableRow(
      normalizeRow(table.headers, table.headers.length),
      innerWidths,
      true,
    ),
  );
  lines.push(horizontalBorder(innerWidths, "├", "┼", "┤"));

  for (const row of table.rows) {
    lines.push(...renderTableRow(normalizeRow(row, table.headers.length), innerWidths, false));
  }

  lines.push(horizontalBorder(innerWidths, "└", "┴", "┘"));

  return lines;
}

/** @internal Test helper — every row should share the same terminal width. */
export function tableLineWidths(lines: string[]): number[] {
  return lines.map((line) => displayWidth(stripAnsi(line)));
}
