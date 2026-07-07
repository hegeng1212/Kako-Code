import { ansi, visibleLength } from "./ansi.js";

const H = "─";

/** Centered label on a horizontal rule — History 11/12 (Claude Code-style). */
export function renderHistorySeparator(label: string, cols: number): string {
  const inner = Math.max(0, cols - 2);
  const labelPlain = ` ${label} `;
  const labelLen = visibleLength(labelPlain);
  const dashTotal = Math.max(0, inner - labelLen);
  const left = Math.floor(dashTotal / 2);
  const right = dashTotal - left;
  const line = `${H.repeat(left)}${labelPlain}${H.repeat(right)}`;
  return `${ansi.line}${line}${ansi.reset}`;
}

/** Footer hint while plan mode is active. */
export function renderPlanModeFooterHint(): string {
  return `${ansi.planBorder}⏸ plan mode on (shift+tab to cycle)${ansi.reset}`;
}
