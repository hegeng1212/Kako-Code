import { ansi, visibleLength } from "./ansi.js";

const H = "─";

/** 1-based column where the history label starts (History n/n). */
export const HISTORY_LABEL_COLUMN = 15;

/** Horizontal rule with gray history label at a fixed left offset — Claude Code-style. */
export function renderHistorySeparator(label: string, cols: number, rightHint?: string): string {
  const leftDashes = Math.max(0, HISTORY_LABEL_COLUMN - 1);
  const labelWidth = visibleLength(label);
  const hintWidth = rightHint ? visibleLength(rightHint) : 0;
  const middleDashes =
    hintWidth > 0
      ? Math.max(0, cols - leftDashes - labelWidth - hintWidth)
      : Math.max(0, cols - leftDashes - labelWidth);
  return (
    `${ansi.inputBorder}${H.repeat(leftDashes)}${ansi.reset}` +
    `${ansi.muted}${label}${ansi.reset}` +
    `${ansi.inputBorder}${H.repeat(middleDashes)}${ansi.reset}` +
    (hintWidth > 0 ? `${ansi.muted}${rightHint}${ansi.reset}` : "")
  );
}

/** Footer hint while plan mode is active. */
export function renderPlanModeFooterHint(): string {
  return `${ansi.planBorder}⏸ plan mode on (shift+tab to cycle)${ansi.reset}`;
}
