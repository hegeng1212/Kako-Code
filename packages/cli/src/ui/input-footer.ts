import type { PermissionMode } from "@kako/shared";
import { ansi, visibleLength } from "./ansi.js";

const H = "─";

/** Indent so footer text starts under input body (after `> `). */
export const FOOTER_HINT_INDENT = "  ";

export interface PermissionModeFooterOptions {
  /** Main turn streaming/tools — plan idle uses ⏸ / busy ▶▶; auto always ▶▶. */
  busy?: boolean;
  /** At least one live/recent subagent in this session. */
  canManageAgents?: boolean;
  /** Show esc-to-interrupt hint (caller decides). */
  canInterrupt?: boolean;
  /** When > 0, show `← N agent(s)` like Claude Code. */
  agentCount?: number;
}

/** Cycle order for shift+tab (skips acceptEdits). */
export function nextPermissionMode(current: PermissionMode): PermissionMode {
  if (current === "plan") return "bypassPermissions";
  if (current === "bypassPermissions") return "default";
  return "plan";
}

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

/** Horizontal rule with optional right-aligned hint on the input top border. */
export function renderInputTopSeparator(cols: number, rightHint?: string): string {
  const hintWidth = rightHint ? visibleLength(rightHint) : 0;
  const dashes = Math.max(0, cols - hintWidth);
  return (
    `${ansi.inputBorder}${H.repeat(dashes)}${ansi.reset}` +
    (hintWidth > 0 ? `${ansi.muted}${rightHint}${ansi.reset}` : "")
  );
}

/** Right-aligned copy hint on the row above the input top border. */
export function renderInputCopyHint(cols: number, hint: string): string {
  const hintWidth = visibleLength(hint);
  const pad = Math.max(0, cols - hintWidth);
  return `${" ".repeat(pad)}${ansi.muted}${hint}${ansi.reset}`;
}

/**
 * Claude-style mode footer (indented under input body after `> `):
 * plan:   `  ⏸ plan mode on (shift+tab to cycle) · ← 1 agent` (cyan label)
 * auto:   `  ▶▶ auto mode on (shift+tab to cycle) · ← 1 agent` (yellow label, muted hints)
 * manual: `  ⏸ manual mode on · ? for shortcuts · ← for agents`
 */
export function renderPermissionModeFooterHint(
  mode: PermissionMode,
  opts: PermissionModeFooterOptions = {},
): string {
  const {
    busy = false,
    canManageAgents = false,
    canInterrupt = false,
    agentCount = 0,
  } = opts;
  const agents =
    agentCount > 0
      ? `← ${agentCount} agent${agentCount === 1 ? "" : "s"}`
      : "← for agents";
  const manage = canManageAgents ? " · ↓ to manage" : "";
  const interrupt = canInterrupt ? " · esc to interrupt" : "";
  const pad = FOOTER_HINT_INDENT;

  if (mode === "plan") {
    const icon = busy ? "▶▶" : "⏸";
    // Claude: cyan mode label; shift+tab + agents stay muted.
    return (
      `${pad}${ansi.planBorder}${icon} plan mode on${ansi.reset}` +
      `${ansi.muted} (shift+tab to cycle) · ${agents}${manage}${interrupt}${ansi.reset}`
    );
  }
  if (mode === "bypassPermissions") {
    // Claude auto: dual-play chevrons + yellow label; trailing hints muted like plan.
    return (
      `${pad}${ansi.yellow}▶▶ auto mode on${ansi.reset}` +
      `${ansi.muted} (shift+tab to cycle) · ${agents}${manage}${interrupt}${ansi.reset}`
    );
  }
  // Manual — muted pause icon + label (Claude Code).
  return (
    `${pad}${ansi.muted}⏸ manual mode on` +
    ` · ? for shortcuts · ${agents}${manage}${interrupt}${ansi.reset}`
  );
}

/** @deprecated Prefer renderPermissionModeFooterHint("plan"). */
export function renderPlanModeFooterHint(): string {
  return renderPermissionModeFooterHint("plan");
}
