import { ansi, pink, visibleLength } from "./ansi.js";

const H = "─";
const V = "│";
const TL = "┌";
const TR = "┐";
const BL = "└";
const BR = "┘";

function padCell(text: string, width: number, align: "left" | "center" = "left"): string {
  const len = visibleLength(text);
  if (len >= width) return text;
  const pad = width - len;
  if (align === "center") {
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + text + " ".repeat(pad - left);
  }
  return text + " ".repeat(pad);
}

export interface ClaudeBoxLayout {
  width: number;
  inner: number;
  leftContentWidth: number;
  rightContentWidth: number;
}

export function computeClaudeBoxLayout(width?: number): ClaudeBoxLayout {
  const termWidth = process.stdout.columns ?? 100;
  const boxWidth = Math.max(width ?? termWidth, 40);
  const inner = boxWidth - 2;
  const leftPane = Math.floor(inner * 0.36);
  const leftContentWidth = leftPane - 2;
  const rightContentWidth = inner - leftPane - 3;
  return { width: boxWidth, inner, leftContentWidth, rightContentWidth };
}

/** Top border with title embedded on the left, Claude Code style. */
export function renderClaudeTopBorder(title: string, inner: number): string {
  const titlePart = `─ ${title} `;
  const dashCount = Math.max(0, inner - titlePart.length);
  return pink(`${TL}${titlePart}${H.repeat(dashCount)}${TR}`);
}

export function renderClaudeBottomBorder(inner: number): string {
  return pink(`${BL}${H.repeat(inner)}${BR}`);
}

export function renderClaudeRow(
  left: string,
  right: string,
  layout: ClaudeBoxLayout,
  leftAlign: "left" | "center" = "left",
): string {
  const l = padCell(left, layout.leftContentWidth, leftAlign);
  const r = padCell(right, layout.rightContentWidth, "left");
  return `${pink(V)} ${l} ${pink(V)} ${r} ${pink(V)}`;
}

export function renderClaudeTwoColumnBox(
  title: string,
  leftLines: string[],
  rightLines: string[],
  options?: { width?: number; leftAlign?: "left" | "center" },
): string {
  const layout = computeClaudeBoxLayout(options?.width);
  const align = options?.leftAlign ?? "center";
  const rows = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [renderClaudeTopBorder(title, layout.inner)];

  for (let i = 0; i < rows; i++) {
    out.push(
      renderClaudeRow(leftLines[i] ?? "", rightLines[i] ?? "", layout, align),
    );
  }

  out.push(renderClaudeBottomBorder(layout.inner));
  return out.join("\n");
}

export function pinLeftColumnBottom(
  topLines: string[],
  bottomLine: string,
  totalRows: number,
): string[] {
  const contentRows = topLines.length + 1;
  const spacers = Math.max(0, totalRows - contentRows);
  return [...topLines, ...Array(spacers).fill(""), bottomLine];
}

/** Grey block cursor + placeholder continuing on the same line (Claude Code). */
export function renderClaudeInputLine(placeholder: string): string {
  const cursor = `${ansi.placeholder}\x1b[7m \x1b[27m${ansi.placeholder}`;
  const tail = placeholder.length > 1 ? placeholder.slice(1) : "";
  return `${ansi.text}${ansi.bold}>${ansi.reset} ${cursor}${tail}${ansi.reset}`;
}

export interface ClaudeFooterParts {
  topSep: string;
  inputLine: string;
  bottomSep: string;
  shortcuts: string;
}

export function renderClaudeFooterParts(options?: {
  placeholder?: string;
  shortcuts?: string;
}): ClaudeFooterParts {
  const termWidth = process.stdout.columns ?? 100;
  const line = ansi.line + H.repeat(termWidth) + ansi.reset;
  const placeholder =
    options?.placeholder ?? 'Try "explain this codebase"';
  const shortcuts =
    options?.shortcuts ?? "? for shortcuts · /help for commands";

  return {
    topSep: line,
    inputLine: renderClaudeInputLine(placeholder),
    bottomSep: line,
    shortcuts: `${ansi.muted}${shortcuts}${ansi.reset}`,
  };
}

export function renderClaudeFooter(options?: {
  placeholder?: string;
  shortcuts?: string;
  /** When false, omit the input line (caller prints it via readline prompt). */
  includeInputLine?: boolean;
}): string {
  const parts = renderClaudeFooterParts(options);
  const includeInputLine = options?.includeInputLine ?? true;
  const lines = ["", parts.topSep];
  if (includeInputLine) lines.push(parts.inputLine);
  lines.push(parts.bottomSep, parts.shortcuts, "");
  return lines.join("\n");
}
