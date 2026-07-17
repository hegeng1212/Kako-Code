import type { BackgroundTask } from "@kako/core";
import { ansi, displayWidth } from "./ansi.js";
import { formatDurationMs } from "./format-duration.js";
import { shouldBrowseHistoryOnDown } from "./multiline-input.js";

export type SessionAgentFocus = "input" | "list";

export type SessionAgentRow =
  | { kind: "main"; label: "main" }
  | {
      kind: "subagent";
      taskId: string;
      name: string;
      description: string;
      startedAt: string;
      /** When set, footer elapsed time stops ticking (agent finished). */
      endedAt?: string;
      childSessionId?: string;
    };

/** Live agent-kind tasks for the current main session (foreground + background). */
export function listManageableAgentTasks(tasks: readonly BackgroundTask[]): BackgroundTask[] {
  return tasks.filter((t) => t.kind === "agent" && !t.stopped);
}

export function canManageSessionAgents(tasks: readonly BackgroundTask[]): boolean {
  return listManageableAgentTasks(tasks).length > 0;
}

/**
 * True background agents only (`run_in_background` / ctrl+b).
 * Foreground Explore sets `blocking` and must not show "Waiting for N background…".
 */
export function countBackgroundWaitingAgents(tasks: readonly BackgroundTask[]): number {
  return tasks.filter((t) => t.kind === "agent" && !t.stopped && !t.blocking).length;
}

export function buildSessionAgentRows(tasks: readonly BackgroundTask[]): SessionAgentRow[] {
  const agents = listManageableAgentTasks(tasks);
  if (agents.length === 0) return [];
  return [
    { kind: "main", label: "main" },
    ...agents.map((t) => ({
      kind: "subagent" as const,
      taskId: t.id,
      name: t.subagentName?.trim() || "agent",
      description: t.description?.trim() || t.id,
      startedAt: t.startedAt,
      childSessionId: t.childSessionId,
    })),
  ];
}

export type SessionSubagentRow = Extract<SessionAgentRow, { kind: "subagent" }>;

export function subagentElapsedMs(row: SessionSubagentRow, now = Date.now()): number {
  const start = new Date(row.startedAt).getTime();
  const end = row.endedAt ? new Date(row.endedAt).getTime() : now;
  return Math.max(0, end - start);
}

/**
 * Pin row for Explore detail. Completed agents are deleted from the task store,
 * so we capture metadata at open time (or synthesize from childSessionId).
 */
export function resolveAgentDetailPinRow(
  tasks: readonly BackgroundTask[],
  childSessionId: string,
): SessionSubagentRow {
  const fromLive = buildSessionAgentRows(tasks).find(
    (r): r is SessionSubagentRow =>
      r.kind === "subagent" && r.childSessionId === childSessionId,
  );
  if (fromLive) return fromLive;

  const task = tasks.find((t) => t.kind === "agent" && t.childSessionId === childSessionId);
  return {
    kind: "subagent",
    taskId: task?.id ?? childSessionId,
    name: task?.subagentName?.trim() || "agent",
    description: task?.description?.trim() || childSessionId,
    startedAt: task?.startedAt ?? new Date().toISOString(),
    childSessionId,
  };
}

/**
 * While Explore detail is open, keep main + that child in the footer even after
 * the background task is removed on completion — otherwise the user cannot ↓/Enter
 * back to main.
 */
export function buildSessionAgentRowsWithDetailPin(
  tasks: readonly BackgroundTask[],
  pinned: SessionSubagentRow | null,
): SessionAgentRow[] {
  const live = buildSessionAgentRows(tasks);
  if (!pinned) return live;
  const already = live.some(
    (r) => r.kind === "subagent" && r.childSessionId === pinned.childSessionId,
  );
  if (already) return live;
  if (live.length === 0) {
    return [{ kind: "main", label: "main" }, pinned];
  }
  return [...live, pinned];
}

export function focusFromInputDown(canManage: boolean): SessionAgentFocus {
  return canManage ? "list" : "input";
}

/**
 * ↓ while browsing history: leaving the newest entry restores the live draft.
 * If that draft is already at the “↓ goes to agents” position (empty / cursor at end),
 * focus the agent list in the same keypress — avoid requiring an extra ↓.
 */
export function shouldFocusAgentListAfterLeavingHistory(opts: {
  leftHistory: boolean;
  canManageAgents: boolean;
  draft: string;
  cursor: number;
}): boolean {
  if (!opts.leftHistory || !opts.canManageAgents) return false;
  return shouldBrowseHistoryOnDown(opts.draft, opts.cursor);
}

/** ↑ on the first row returns focus to input; otherwise move selection up. */
export function focusAfterListUp(
  selected: number,
  _rowCount: number,
): { focus: SessionAgentFocus; selected: number } {
  if (selected <= 0) return { focus: "input", selected: 0 };
  return { focus: "list", selected: selected - 1 };
}

export function moveAgentSelection(selected: number, delta: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.max(0, Math.min(rowCount - 1, selected + delta));
}

/** When subagent detail is open, ← pops detail instead of opening Agents. */
export function shouldPopAgentDetailOnLeft(detailOpen: boolean): boolean {
  return detailOpen;
}

/**
 * ← opens Agents only from an empty compose box (cursor at start).
 * With draft text, ← must move the input caret — including mid-turn compose.
 */
export function shouldOpenAgentsOnCursorLeft(inputLength: number, cursor: number): boolean {
  return inputLength === 0 && cursor === 0;
}

/**
 * Whether the terminal block cursor should sit in the chat input.
 * True while awaiting a line, or while a turn is running (compose / click-to-focus).
 */
export function shouldShowChatInputCaret(opts: {
  listFocused: boolean;
  overlayActive: boolean;
  mouseSelecting: boolean;
  hasSelection: boolean;
  awaitingLine: boolean;
  turnInProgress: boolean;
}): boolean {
  if (opts.listFocused || opts.overlayActive) return false;
  if (opts.mouseSelecting || opts.hasSelection) return false;
  return opts.awaitingLine || opts.turnInProgress;
}

/**
 * Index of the session currently displayed in chat (main = 0).
 * When Explore detail is open, that subagent row is current.
 */
export function currentSessionAgentIndex(
  rows: readonly SessionAgentRow[],
  detailChildSessionId: string | null,
): number {
  if (!detailChildSessionId) return 0;
  const idx = rows.findIndex(
    (row) => row.kind === "subagent" && row.childSessionId === detailChildSessionId,
  );
  return idx >= 0 ? idx : 0;
}

/** Shortcuts while ↑/↓ focus is on the agent list (Claude Code-style). */
export function agentListShortcutsHint(): string {
  return `${ansi.muted}Enter to view · x to stop${ansi.reset}`;
}

function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
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

/** Indent for footer main / Explore rows (aligned with chat body indent). */
const AGENT_LIST_INDENT = "  ";

/**
 * Footer agent rows (Claude Code-style):
 * - Input focused: `● main` / `○ Explore` (no caret); input keeps the block cursor.
 * - List focused: bold white `>` on the selected row; selected label is white.
 * - Current view uses ●; others ○. Explore as current view uses a green ●.
 */
export function renderSessionAgentListLines(options: {
  rows: readonly SessionAgentRow[];
  selected: number;
  cols: number;
  now?: number;
  /** When true, keyboard focus is on the list — selected row shows `>`. */
  listFocused?: boolean;
  /** Row whose chat is currently displayed (●). Defaults to `selected` when omitted. */
  currentIndex?: number;
}): string[] {
  const {
    rows,
    selected,
    cols,
    now = Date.now(),
    listFocused = false,
    currentIndex = selected,
  } = options;
  // "> "/"  " + "● "/"○ "
  const prefixWidth = 4;
  const indentWidth = displayWidth(AGENT_LIST_INDENT) + prefixWidth;
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const isCurrent = i === currentIndex;
    const isSelected = listFocused && i === selected;
    // Bold white caret when the row has keyboard focus.
    const caret = isSelected
      ? `${ansi.bold}${ansi.text}> ${ansi.reset}`
      : "  ";
    const markerChar = isCurrent ? "●" : "○";
    // Explore (subagent) current view → green solid circle, matching chat Explore header.
    const marker =
      isCurrent && row.kind === "subagent"
        ? `${ansi.green}${markerChar}${ansi.reset} `
        : `${ansi.text}${markerChar}${ansi.reset} `;
    // Selected row (keyboard) or current view → white label; otherwise muted.
    const labelColor = isSelected || isCurrent ? ansi.text : ansi.muted;

    if (row.kind === "main") {
      const body = truncateToWidth(row.label, Math.max(4, cols - indentWidth));
      lines.push(
        `${AGENT_LIST_INDENT}${caret}${marker}${labelColor}${body}${ansi.reset}`,
      );
      continue;
    }

    const elapsed = formatDurationMs(subagentElapsedMs(row, now));
    const elapsedCol = ` ${elapsed}`;
    const budget = Math.max(8, cols - indentWidth - displayWidth(elapsedCol));
    const name = row.name.trim() || "agent";
    const desc = row.description.trim();
    const fullLabel = desc ? `${name} ${desc}` : name;
    const label = truncateToWidth(fullLabel, budget);
    // Keep agent kind (Explore) white when selected or current; description follows labelColor.
    if ((isSelected || isCurrent) && label.startsWith(name)) {
      const rest = label.slice(name.length);
      const restColor = isSelected ? ansi.text : labelColor;
      lines.push(
        `${AGENT_LIST_INDENT}${caret}${marker}` +
          `${ansi.text}${name}${ansi.reset}${restColor}${rest}${ansi.reset}` +
          `${ansi.muted}${elapsedCol}${ansi.reset}`,
      );
    } else {
      lines.push(
        `${AGENT_LIST_INDENT}${caret}${marker}` +
          `${labelColor}${label}${ansi.reset}${ansi.muted}${elapsedCol}${ansi.reset}`,
      );
    }
  }
  return lines;
}
