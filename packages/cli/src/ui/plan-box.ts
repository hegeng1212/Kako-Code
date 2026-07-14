import { ansi, displayWidth, stripAnsi, visibleLength } from "./ansi.js";
import { parseMarkdownBlocks, type MarkdownBlock } from "./markdown-blocks.js";
import { parseInlineParts, wrapInlineParts, type InlinePart } from "./markdown-inline.js";

import { homedir } from "node:os";
import { ansi } from "./ansi.js";

/** Claude Code-style plan preview label under Updated plan. */
export const PLAN_PREVIEW_LABEL = "/plan to preview";

export function formatPlanPathForDisplay(planPath: string): string {
  const home = homedir();
  if (planPath.startsWith(home)) {
    return `~${planPath.slice(home.length)}`;
  }
  return planPath;
}

const BOX_H = "─";
const BOX_V = "│";
const BOX_TL = "┌";
const BOX_TR = "┐";
const BOX_BL = "└";
const BOX_BR = "┘";
const MAX_PLAN_CODE_LINES = 4;

function planBorder(text: string): string {
  return `${ansi.planBorder}${text}${ansi.reset}`;
}

function truncateToDisplayWidth(text: string, maxWidth: number): string {
  const plain = stripAnsi(text);
  if (displayWidth(plain) <= maxWidth) return text;
  let cut = plain.length;
  while (cut > 0 && displayWidth(plain.slice(0, cut) + "…") > maxWidth) {
    cut--;
  }
  return plain.slice(0, cut) + "…";
}

function padBoxLine(content: string, innerWidth: number): string {
  const body = truncateToDisplayWidth(content, innerWidth);
  const pad = Math.max(0, innerWidth - displayWidth(stripAnsi(body)));
  return `${BOX_V} ${body}${" ".repeat(pad)} ${BOX_V}`;
}

function renderPlanInlinePart(part: InlinePart): string {
  if (part.style.code) {
    return `${ansi.planBorder}${part.text}${ansi.reset}`;
  }
  if (part.style.link) {
    return `${ansi.planBorder}${part.text}${ansi.reset}${ansi.muted} (${part.style.link})${ansi.reset}`;
  }
  if (part.style.bold && part.style.italic) {
    return `${ansi.bold}${ansi.italic}${part.text}${ansi.reset}`;
  }
  if (part.style.bold) {
    return `${ansi.bold}${part.text}${ansi.reset}`;
  }
  if (part.style.italic) {
    return `${ansi.italic}${part.text}${ansi.reset}`;
  }
  return part.text;
}

function wrapPlanInlineParts(parts: InlinePart[], width: number): string[] {
  return wrapInlineParts(parts, width, renderPlanInlinePart);
}

function renderPlanHeading(text: string, level: number, width: number): string[] {
  const content = wrapPlanInlineParts(parseInlineParts(text), width);
  if (level === 1) {
    return content.map((line) => `${ansi.accentBold}${line}${ansi.reset}`);
  }
  if (level === 2) {
    return content.map((line) => `${ansi.planBorder}${ansi.bold}${line}${ansi.reset}`);
  }
  return content.map((line) => `${ansi.bold}${line}${ansi.reset}`);
}

function renderPlanCodeBlock(lines: string[], width: number): string[] {
  const innerWidth = Math.max(16, width - 2);
  const preview = lines.slice(0, MAX_PLAN_CODE_LINES);
  const out: string[] = [];
  for (const line of preview) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    out.push(...wrapPlanInlineParts(parseInlineParts(trimmed), innerWidth));
  }
  if (lines.length > MAX_PLAN_CODE_LINES) {
    out.push(`${ansi.muted}…${ansi.reset}`);
  }
  return out.length ? out : [`${ansi.muted}(code omitted)${ansi.reset}`];
}

function renderPlanBlock(block: MarkdownBlock, width: number): string[] {
  switch (block.type) {
    case "paragraph":
      return wrapPlanInlineParts(parseInlineParts(block.text), width);
    case "heading":
      return renderPlanHeading(block.text, block.level, width);
    case "ul":
      return block.items.flatMap((item) =>
        wrapPlanInlineParts(parseInlineParts(`• ${item}`), width),
      );
    case "ol":
      return block.items.flatMap((item, index) =>
        wrapPlanInlineParts(parseInlineParts(`${index + 1}. ${item}`), width),
      );
    case "code":
      return renderPlanCodeBlock(block.lines, width);
    case "blockquote":
      return block.lines.flatMap((line) =>
        wrapPlanInlineParts(parseInlineParts(line), width).map(
          (row) => `${ansi.muted}▏ ${row}${ansi.reset}`,
        ),
      );
    case "hr":
      return [`${ansi.planBorder}${"─".repeat(Math.min(32, width))}${ansi.reset}`];
    case "table": {
      const rows: string[] = [];
      if (block.table.headers.length) {
        rows.push(
          ...wrapPlanInlineParts(
            parseInlineParts(block.table.headers.join(" · ")),
            width,
          ),
        );
      }
      for (const row of block.table.rows) {
        rows.push(...wrapPlanInlineParts(parseInlineParts(row.join(" · ")), width));
      }
      return rows;
    }
  }
}

/** Plan preview markdown — cyan keywords, no code-block black background. */
export function renderPlanRichContentLines(text: string, width: number): string[] {
  const wrapWidth = Math.max(20, width);
  const trimmed = text.trim();
  if (!trimmed) return [""];

  const lines: string[] = [];
  for (const block of parseMarkdownBlocks(trimmed)) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(...renderPlanBlock(block, wrapWidth));
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.length ? lines : [""];
}

/** Tree connector line: └ Current Plan */
export function renderCurrentPlanTreeLine(): string {
  return `${ansi.muted}└ ${ansi.reset}${ansi.text}Current Plan${ansi.reset}`;
}

/** Full plan path shown under Current Plan. */
export function renderPlanPathLine(planPath: string): string {
  return `${ansi.muted}${formatPlanPathForDisplay(planPath)}${ansi.reset}`;
}

/** Tree connector line after /plan or shift+tab enter. */
export function renderPlanEnabledLine(): string {
  return `${ansi.muted}└ ${ansi.reset}Enabled plan mode`;
}

/** Tree connector line: └ /plan to preview */
export function renderPlanPreviewTreeLine(): string {
  return `${ansi.muted}└ ${PLAN_PREVIEW_LABEL}${ansi.reset}`;
}

export interface RenderPlanBoxOptions {
  planText: string;
  /** Total terminal columns available for the box (including borders). */
  width: number;
  /** Left indent spaces before the box. */
  indent?: number;
  /** Show scroll hint at bottom of box for long plans. */
  showScrollHint?: boolean;
}

/** Render plan markdown inside a cyan bordered box (Claude Code-style). */
export function renderPlanBoxLines(opts: RenderPlanBoxOptions): string[] {
  const { planText, width, indent = 0, showScrollHint = true } = opts;
  const boxWidth = Math.max(40, width - indent);
  const innerWidth = Math.max(16, boxWidth - 4);
  const contentWidth = innerWidth;

  const trimmed = planText.trim();
  if (!trimmed) {
    return [
      " ".repeat(indent) +
        planBorder(`${BOX_TL}${BOX_H.repeat(boxWidth - 2)}${BOX_TR}`),
      " ".repeat(indent) +
        planBorder(padBoxLine(`${ansi.muted}(empty plan)${ansi.reset}`, innerWidth)),
      " ".repeat(indent) +
        planBorder(`${BOX_BL}${BOX_H.repeat(boxWidth - 2)}${BOX_BR}`),
    ];
  }

  const contentLines = renderPlanRichContentLines(trimmed, contentWidth);
  const lines: string[] = [];

  lines.push(
    " ".repeat(indent) + planBorder(`${BOX_TL}${BOX_H.repeat(boxWidth - 2)}${BOX_TR}`),
  );

  for (const line of contentLines) {
    if (line === "") {
      lines.push(" ".repeat(indent) + planBorder(padBoxLine("", innerWidth)));
      continue;
    }
    lines.push(" ".repeat(indent) + planBorder(padBoxLine(line, innerWidth)));
  }

  if (showScrollHint && contentLines.length > 8) {
    const hint = `${ansi.muted}Jump to bottom (ctrl+End) ↓${ansi.reset}`;
    const hintPad = Math.max(0, innerWidth - displayWidth(stripAnsi(hint)));
    lines.push(
      " ".repeat(indent) +
        planBorder(padBoxLine(`${" ".repeat(hintPad)}${hint}`, innerWidth)),
    );
  }

  lines.push(
    " ".repeat(indent) + planBorder(`${BOX_BL}${BOX_H.repeat(boxWidth - 2)}${BOX_BR}`),
  );

  return lines;
}
