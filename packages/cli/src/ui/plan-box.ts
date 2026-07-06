import { ansi, displayWidth, visibleLength } from "./ansi.js";
import { renderRichContentLines } from "./markdown-render.js";

/** Claude Code-style plan preview label under Updated plan. */
export const PLAN_PREVIEW_LABEL = "/plan to preview";

const BOX_H = "─";
const BOX_V = "│";
const BOX_TL = "┌";
const BOX_TR = "┐";
const BOX_BL = "└";
const BOX_BR = "┘";

function planBorder(text: string): string {
  return `${ansi.planBorder}${text}${ansi.reset}`;
}

function padBoxLine(content: string, innerWidth: number): string {
  const visible = visibleLength(content);
  if (visible >= innerWidth) {
    return `${BOX_V} ${content}`;
  }
  return `${BOX_V} ${content}${" ".repeat(innerWidth - visible)} `;
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
  const innerWidth = Math.max(20, boxWidth - 4);
  const contentWidth = Math.max(16, innerWidth - 2);

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

  const contentLines = renderRichContentLines(trimmed, contentWidth);
  const lines: string[] = [];

  lines.push(
    " ".repeat(indent) + planBorder(`${BOX_TL}${BOX_H.repeat(boxWidth - 2)}${BOX_TR}`),
  );

  for (const line of contentLines) {
    const padded = padBoxLine(line, innerWidth);
    if (displayWidth(padded) > boxWidth) {
      lines.push(" ".repeat(indent) + planBorder(`${BOX_V} ${line.slice(0, contentWidth)} `));
    } else {
      lines.push(" ".repeat(indent) + planBorder(padded));
    }
  }

  if (showScrollHint && contentLines.length > 8) {
    const hint = `${ansi.muted}Jump to bottom (ctrl+End) ↓${ansi.reset}`;
    const hintPad = Math.max(0, innerWidth - visibleLength(hint));
    lines.push(
      " ".repeat(indent) +
        planBorder(`${BOX_V} ${" ".repeat(hintPad)}${hint} `),
    );
  }

  lines.push(
    " ".repeat(indent) + planBorder(`${BOX_BL}${BOX_H.repeat(boxWidth - 2)}${BOX_BR}`),
  );

  return lines;
}
