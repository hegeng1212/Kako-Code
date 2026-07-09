import { ansi } from "./ansi.js";
import { formatDurationSeconds } from "./format-duration.js";
import { renderPlanPreviewTreeLine } from "./plan-box.js";
import { wrapContentLines } from "./text-wrap.js";
import {
  formatToolInvocationLabel,
  isPlanFileDetail,
  isWorkflowDetail,
  toolCallFailurePhrase,
  toolCallStatPhrase,
  toolCallSuccessPhrase,
  toolCallWaitingPhrase,
  workflowNameFromDetail,
} from "./tool-call-phrases.js";

export type ToolCallStatus = "waiting" | "success" | "error";

export interface ToolCallTimelineEntry {
  type: "tool";
  id: string;
  name: string;
  detail: string;
  status: ToolCallStatus;
  output?: string;
  errorDetail?: string;
  errorExpanded?: boolean;
  /** 0–3 cycling frame for Waiting… animation */
  dotFrame: number;
  /** Waiting for user to approve a confirmation-gated tool (Write/Edit). */
  awaitingApproval?: boolean;
}

const WAITING_DOTS = ["", ".", "..", "..."] as const;

export function toolCallLabel(name: string, detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed || trimmed === "{}") return name;
  return `${name} ${trimmed}`;
}

function renderPhraseLine(phrase: string, color: "green" | "red" | "yellow"): string {
  const styled =
    color === "green"
      ? ansi.green
      : color === "red"
        ? ansi.red
        : ansi.yellow;
  return `${styled}${phrase}${ansi.reset}`;
}

/** Single-line tool status (waiting / completed / failed header). */
export function renderToolCallStatusLine(entry: ToolCallTimelineEntry): string {
  const label = toolCallLabel(entry.name, entry.detail);

  if (entry.status === "waiting") {
    if (entry.awaitingApproval) {
      return `${ansi.yellow}Approve?${ansi.reset} ${ansi.muted}${label}${ansi.reset}`;
    }
    const dots = WAITING_DOTS[entry.dotFrame % WAITING_DOTS.length]!;
    const phrase = toolCallWaitingPhrase(entry.name, entry.detail);
    return `${ansi.red}Waiting${dots}${ansi.reset} ${ansi.muted}${phrase}${ansi.reset}`;
  }

  if (entry.status === "success") {
    if (isPlanFileTool(entry)) {
      return `${ansi.green}⏺${ansi.reset} ${ansi.text}Updated plan${ansi.reset}`;
    }
    return renderPhraseLine(toolCallSuccessPhrase(entry.name, entry.detail), "green");
  }

  const hint =
    entry.errorDetail && !entry.errorExpanded
      ? ` ${ansi.muted}(click to expand)${ansi.reset}`
      : "";
  return `${renderPhraseLine(toolCallFailurePhrase(entry.name, entry.detail, entry.errorDetail), "red")}${hint}`;
}

export function isPlanFileTool(entry: Pick<ToolCallTimelineEntry, "name" | "detail">): boolean {
  return (entry.name === "Write" || entry.name === "Edit") && isPlanFileDetail(entry.detail);
}

export function isWorkflowTool(entry: Pick<ToolCallTimelineEntry, "name" | "detail">): boolean {
  return entry.name === "Workflow";
}

function renderWorkflowsSlashLink(): string {
  return `${ansi.planBorder}/workflows${ansi.reset}`;
}

export function renderWorkflowViewHintLine(): string {
  return `${ansi.muted}   └ ${renderWorkflowsSlashLink()} ${ansi.muted}to view dynamic workflow runs${ansi.reset}`;
}

export function renderWorkflowToolLines(entry: ToolCallTimelineEntry): string[] {
  const wfName = isWorkflowDetail(entry.detail)
    ? workflowNameFromDetail(entry.detail)
    : entry.detail.trim() || "workflow";
  const header = `${ansi.green}⏺${ansi.reset} ${ansi.text}Workflow(dynamic workflow: ${wfName})${ansi.reset}`;
  if (entry.status === "error") {
    const detail = entry.errorDetail?.trim() || toolCallFailurePhrase(entry.name, entry.detail, entry.errorDetail);
    return [header, `${ansi.red}   ✘ ${detail}${ansi.reset}`];
  }
  if (entry.status === "waiting" || entry.status === "success") {
    return [header, renderWorkflowViewHintLine()];
  }
  return [renderToolCallStatusLine(entry)];
}

/** Collapsed activity summary: Thought for 10s, listed 1 directory, read 2 files */
export function renderActivitySummaryLine(
  thoughtSeconds: number | undefined,
  stats: string[],
  expanded: boolean,
): string {
  const parts: string[] = [];
  if (thoughtSeconds && thoughtSeconds > 0) {
    parts.push(`Thought for ${formatDurationSeconds(thoughtSeconds)}`);
  }
  parts.push(...stats);
  const summary = parts.length ? parts.join(", ") : "Finished tool calls";
  const chevron = expanded ? "▾" : "▸";
  const hint = expanded ? "click to collapse" : "click to expand";
  return `${ansi.muted}${summary}${ansi.reset} ${ansi.muted}${chevron} (${hint})${ansi.reset}`;
}

/** Expanded tool invocation header, e.g. ⏺ Bash(ls -la /path). */
export function renderToolInvocationLine(entry: ToolCallTimelineEntry): string {
  const label = formatToolInvocationLabel(entry.name, entry.detail);
  return `${ansi.green}⏺${ansi.reset} ${ansi.text}${label}${ansi.reset}`;
}

/** Tool output body lines when activity group is expanded. */
export function renderToolOutputLines(
  entry: ToolCallTimelineEntry,
  width: number,
  contentStart = 4,
): string[] {
  const raw = entry.output?.trim();
  if (!raw) return [];
  const wrapWidth = Math.max(20, width - contentStart - 2);
  return wrapContentLines(raw, wrapWidth).map(
    (line) => `${ansi.muted}${line}${ansi.reset}`,
  );
}

/** Hint under Updated plan — /plan to preview (Claude Code-style). */
export function renderPlanPreviewHint(): string {
  return renderPlanPreviewTreeLine();
}

/** Wrapped error body when expanded. */
export function renderToolCallErrorLines(
  entry: ToolCallTimelineEntry,
  width: number,
  contentStart = 4,
): string[] {
  if (entry.status !== "error" || !entry.errorExpanded || !entry.errorDetail?.trim()) {
    return [];
  }
  const wrapWidth = Math.max(20, width - contentStart - 2);
  return wrapContentLines(entry.errorDetail.trim(), wrapWidth).map(
    (line) => `${ansi.red}${line}${ansi.reset}`,
  );
}

/** @deprecated Use renderActivitySummaryLine */
export function renderToolGroupSummaryLine(count: number, expanded: boolean): string {
  return renderActivitySummaryLine(undefined, [`finished ${count} tool calls`], expanded);
}

/** @deprecated Use renderToolInvocationLine */
export function renderToolGroupDetailLine(entry: ToolCallTimelineEntry): string {
  return `${ansi.muted}${toolCallSuccessPhrase(entry.name, entry.detail)}${ansi.reset}`;
}

export function collectActivityStats(entries: ToolCallTimelineEntry[]): string[] {
  const stats: string[] = [];
  for (const entry of entries) {
    if (isPlanFileTool(entry) || isWorkflowTool(entry)) continue;
    const stat = toolCallStatPhrase(entry.name, entry.detail, entry.output);
    if (stat) stats.push(stat);
  }
  return stats;
}

export function isToolErrorToggleLine(meta?: {
  kind?: string;
}): boolean {
  return meta?.kind === "tool-error-toggle";
}

export function isToolGroupToggleLine(meta?: {
  kind?: string;
}): boolean {
  return meta?.kind === "tool-group-toggle";
}

export function isPlanToolToggleLine(meta?: { kind?: string }): boolean {
  return meta?.kind === "plan-tool-toggle";
}
