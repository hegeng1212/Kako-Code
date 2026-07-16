import { ansi, displayWidth } from "./ansi.js";
import type { RewindTurnAnchor } from "./session-history.js";

/**
 * Fixed relative age for Rewind rows (not a live ticker).
 * Under 1 day: single unit (`18s ago` / `5m ago` / `2h ago`).
 * 1 day+: coarse Chinese (`1天` / `1天4小时`).
 */
export function formatRewindRelativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return `${Math.max(1, sec)}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  const remHours = hr % 24;
  if (remHours === 0) return `${days}天`;
  return `${days}天${remHours}小时`;
}

/** Claude Rewind list: cyan selection, muted chrome. */
const rewindSelect = ansi.planBorder;
const rewindTitle = `${ansi.bold}${ansi.text}`;

export const REWIND_LIST_HINT = `${ansi.muted}Enter to continue · Esc to cancel${ansi.reset}`;
export const REWIND_CONFIRM_HINT = `${ansi.muted}Enter to choose · Esc to go back${ansi.reset}`;
export const REWIND_CONFIRM_WARNING = `${ansi.muted}△ Rewinding does not affect files edited manually or via bash.${ansi.reset}`;

export type RewindConfirmAction =
  | "restore_both"
  | "restore"
  | "restore_code"
  | "summarize_from"
  | "summarize_up_to"
  | "never_mind";

export interface RewindFilesChanged {
  count: number;
  additions: number;
  deletions: number;
  primaryFile?: string;
}

export interface RewindListRow {
  kind: "history" | "current";
  label: string;
  subtitle?: string;
  filesChanged?: RewindFilesChanged;
  hasCodeChanges?: boolean;
  transcriptIndex?: number;
  timestamp?: string;
}

export function buildRewindListRows(anchors: RewindTurnAnchor[]): RewindListRow[] {
  const rows: RewindListRow[] = anchors.map((a) => ({
    kind: "history" as const,
    label: a.text.replace(/\s+/g, " ").trim(),
    subtitle: a.hasCodeChanges ? undefined : "No code changes",
    filesChanged: a.filesChanged,
    hasCodeChanges: a.hasCodeChanges,
    transcriptIndex: a.transcriptIndex,
    timestamp: a.timestamp,
  }));
  rows.push({ kind: "current", label: "(current)" });
  return rows;
}

export function defaultRewindListSelection(rows: RewindListRow[]): number {
  return Math.max(0, rows.length - 1);
}

export function rewindConfirmActions(hasCodeChanges = false): {
  id: RewindConfirmAction;
  label: string;
  editable?: boolean;
}[] {
  const actions: {
    id: RewindConfirmAction;
    label: string;
    editable?: boolean;
  }[] = [];
  if (hasCodeChanges) {
    actions.push({ id: "restore_both", label: "Restore code and conversation" });
  }
  actions.push({ id: "restore", label: "Restore conversation" });
  if (hasCodeChanges) {
    actions.push({ id: "restore_code", label: "Restore code" });
  }
  actions.push(
    { id: "summarize_from", label: "Summarize from here", editable: true },
    { id: "summarize_up_to", label: "Summarize up to here", editable: true },
    { id: "never_mind", label: "Never mind" },
  );
  return actions;
}

function formatCodeRestoreEffect(files?: RewindFilesChanged): string {
  if (!files || files.count <= 0) {
    return "The code will be restored.";
  }
  const plus = `${ansi.green}+${files.additions}${ansi.reset}`;
  const minus = `${ansi.red}-${files.deletions}${ansi.reset}`;
  if (files.count === 1 && files.primaryFile) {
    return `The code will be restored ${plus} ${minus} in ${ansi.text}${files.primaryFile}${ansi.reset}.`;
  }
  if (files.primaryFile) {
    const others = files.count - 1;
    const otherLabel = others === 1 ? "1 other file" : `${others} other files`;
    return `The code will be restored ${plus} ${minus} in ${ansi.text}${files.primaryFile}${ansi.reset} and ${otherLabel}.`;
  }
  const filesLabel = files.count === 1 ? "1 file" : `${files.count} files`;
  return `The code will be restored ${plus} ${minus} in ${filesLabel}.`;
}

export function rewindConfirmEffectLines(
  action: RewindConfirmAction,
  filesChanged?: RewindFilesChanged,
): string[] {
  switch (action) {
    case "restore_both":
      return [
        "The conversation will be truncated to before this message.",
        formatCodeRestoreEffect(filesChanged),
      ];
    case "restore":
      return [
        "The conversation will be truncated to before this message.",
        "The code will be unchanged.",
      ];
    case "restore_code":
      return ["The conversation will be unchanged.", formatCodeRestoreEffect(filesChanged)];
    case "summarize_from":
      return ["Messages after this point will be summarized.", "The code will be unchanged."];
    case "summarize_up_to":
      return [
        "Preceding messages will be summarized. This and subsequent messages will remain unchanged — you will stay at the end of the conversation.",
        "The code will be unchanged.",
      ];
    case "never_mind":
      return ["The conversation will be unchanged.", "The code will be unchanged."];
  }
}

/** @deprecated use rewindConfirmEffectLines — kept for existing call sites/tests */
export function rewindConfirmEffectLine(
  action: RewindConfirmAction,
  filesChanged?: RewindFilesChanged,
): string {
  return rewindConfirmEffectLines(action, filesChanged)
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""))
    .join(" ");
}

function truncateLabel(text: string, maxWidth: number): string {
  if (displayWidth(text) <= maxWidth) return text;
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = displayWidth(ch);
    if (w + cw > maxWidth - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

function renderFilesChangedSubtitle(row: RewindListRow): string {
  if (row.filesChanged && row.filesChanged.count > 0) {
    const { count, additions, deletions } = row.filesChanged;
    const files = count === 1 ? "1 file changed" : `${count} files changed`;
    return `${ansi.muted}${files}${ansi.reset} ${ansi.green}+${additions}${ansi.reset} ${ansi.red}-${deletions}${ansi.reset}`;
  }
  return `${ansi.muted}${row.subtitle ?? "No code changes"}${ansi.reset}`;
}

/** Full-width cyan rule; optional job-name badge near the right (Claude Rewind). */
export function renderRewindSeparator(cols: number, badge?: string): string {
  const color = ansi.planBorder;
  const trimmed = badge?.trim();
  if (!trimmed) {
    return `${color}${"─".repeat(Math.max(1, cols))}${ansi.reset}`;
  }
  const label = ` ${truncateLabel(trimmed, Math.max(8, Math.min(28, cols - 8)))} `;
  const labelW = displayWidth(label);
  const rightPad = 1;
  const leftLen = Math.max(1, cols - labelW - rightPad);
  const rightLen = Math.max(0, cols - leftLen - labelW);
  // Inverse cyan pill for the badge text.
  return `${color}${"─".repeat(leftLen)}\x1b[7m${label}\x1b[27m${"─".repeat(rightLen)}${ansi.reset}`;
}

export function renderRewindListPanel(options: {
  rows: RewindListRow[];
  selected: number;
  cols: number;
  now?: number;
  scrollHintAbove?: number;
}): string[] {
  const { rows, selected, cols, now = Date.now() } = options;
  const lines: string[] = [];
  lines.push(`${rewindTitle}Rewind${ansi.reset}`);
  lines.push(
    `${ansi.muted}Restore the code and/or conversation to the point before…${ansi.reset}`,
  );
  if ((options.scrollHintAbove ?? 0) > 0) {
    lines.push(`${ansi.muted}↑ ${options.scrollHintAbove} more above${ansi.reset}`);
  }
  lines.push("");

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const selectedRow = i === selected;
    const prefix = selectedRow ? `${rewindSelect}>${ansi.reset}` : " ";
    const age =
      row.timestamp && row.kind === "history"
        ? formatRewindRelativeTime(row.timestamp, now)
        : "";
    const time = age ? ` ${ansi.muted}(${age})${ansi.reset}` : "";
    const labelBudget = Math.max(12, cols - 4 - displayWidth(time));
    const label = truncateLabel(row.label, labelBudget);
    const labelStyled = selectedRow
      ? `${rewindSelect}${label}${ansi.reset}`
      : `${ansi.text}${label}${ansi.reset}`;
    lines.push(`${prefix} ${labelStyled}${time}`);
    if (row.kind === "history") {
      lines.push(`    ${renderFilesChangedSubtitle(row)}`);
      // Claude leaves a blank line between history entries.
      if (i < rows.length - 1) {
        lines.push("");
      }
    }
  }
  lines.push("");
  lines.push(REWIND_LIST_HINT);
  return lines;
}

export function renderRewindConfirmPanel(options: {
  messageText: string;
  timestamp?: string;
  actionIndex: number;
  context: string;
  cols: number;
  now?: number;
  hasCodeChanges?: boolean;
  filesChanged?: RewindFilesChanged;
}): string[] {
  const actions = rewindConfirmActions(options.hasCodeChanges === true);
  const action = actions[options.actionIndex] ?? actions[0]!;
  const now = options.now ?? Date.now();
  const lines: string[] = [];
  lines.push(`${rewindTitle}Rewind${ansi.reset}`);
  lines.push(
    `${ansi.text}Confirm you want to restore to the point before you sent this message:${ansi.reset}`,
  );
  lines.push("");

  const msgBudget = Math.max(12, options.cols - 4);
  const msg = truncateLabel(options.messageText.replace(/\s+/g, " ").trim(), msgBudget);
  lines.push(`${ansi.muted}│${ansi.reset} ${ansi.text}${msg}${ansi.reset}`);
  if (options.timestamp) {
    const age = formatRewindRelativeTime(options.timestamp, now);
    if (age) {
      lines.push(`${ansi.muted}│${ansi.reset} ${ansi.muted}(${age})${ansi.reset}`);
    }
  }
  lines.push("");

  for (const effect of rewindConfirmEffectLines(action.id, options.filesChanged)) {
    lines.push(
      effect.includes("\x1b[") ? effect : `${ansi.text}${effect}${ansi.reset}`,
    );
  }
  lines.push("");

  for (let i = 0; i < actions.length; i++) {
    const item = actions[i]!;
    const selected = i === options.actionIndex;
    const prefix = selected ? `${rewindSelect}>${ansi.reset}` : " ";
    const num = `${i + 1}.`;
    let label = item.label;
    if (item.editable && selected) {
      const ctx = options.context;
      const placeholder = "add context (optional)";
      const field = ctx.length > 0 ? ctx : placeholder;
      label = `${item.label}: [${field}]`;
    }
    const styled = selected
      ? `${rewindSelect}${num} ${label}${ansi.reset}`
      : `${ansi.text}${num} ${label}${ansi.reset}`;
    lines.push(`${prefix} ${styled}`);
  }
  lines.push("");
  lines.push(REWIND_CONFIRM_WARNING);
  lines.push(REWIND_CONFIRM_HINT);
  return lines;
}
