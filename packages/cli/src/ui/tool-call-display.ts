import { getSystemSkillHandler, workflowCompletedSummary, type WorkflowRunRecord } from "@kako/core";
import { ansi } from "./ansi.js";
import { formatDurationSeconds } from "./format-duration.js";
import { renderPlanPreviewTreeLine } from "./plan-box.js";
import {
  countEditDiffStats,
  countSourceLines,
  fileBasenameFromDetail,
  isCodeFilePath,
  reconstructBeforeEdit,
  renderFilePreviewLines,
} from "./tool-content-preview.js";
import { wrapContentLines } from "./text-wrap.js";
import {
  formatToolInvocationLabel,
  isExecutionBashCommand,
  isPlanFileDetail,
  isWorkflowDetail,
  shellCommandStat,
  toolCallFailurePhrase,
  toolCallStatPhrase,
  toolCallSuccessPhrase,
  toolCallTimelinePhrase,
  toolCallWaitingPhrase,
  mergeActivityStatPhrases,
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
  /** Skill name detail visible when the user expands a Skill row. */
  skillExpanded?: boolean;
  /** Raw tool input — used for Write/Edit previews. */
  toolInput?: Record<string, unknown>;
  /** Pre-write file content — captured before Write overwrites an existing file. */
  priorContent?: string;
  /** True when this tool showed the approval UI before running. */
  approvalRequired?: boolean;
  /** User allowed (true) or denied (false) after approvalRequired. */
  approvalGranted?: boolean;
  /** 0–3 cycling frame for Waiting… animation */
  dotFrame: number;
  /** Waiting for user to approve a confirmation-gated tool (Write/Edit). */
  awaitingApproval?: boolean;
  /** Agent tool launched with run_in_background. */
  backgrounded?: boolean;
  /** Expanded background agent detail (ctrl+o). */
  agentExpanded?: boolean;
}

const WAITING_DOTS = ["", ".", "..", "..."] as const;

export function toolCallLabel(name: string, detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed || trimmed === "{}") return name;
  return `${name} ${trimmed}`;
}

function renderStatusDot(color: "green" | "red"): string {
  return color === "green" ? `${ansi.green}⏺${ansi.reset}` : `${ansi.red}⏺${ansi.reset}`;
}

function renderTimelineStatusLine(
  entry: ToolCallTimelineEntry,
  color: "green" | "red",
  opts?: { expandHint?: boolean },
): string {
  const phrase = toolCallTimelinePhrase(entry.name, entry.detail);
  const hint =
    opts?.expandHint && !entry.errorExpanded
      ? ` ${ansi.muted}(click to expand)${ansi.reset}`
      : "";
  return `${renderStatusDot(color)} ${ansi.muted}${phrase}${ansi.reset}${hint}`;
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
    return renderTimelineStatusLine(entry, "green");
  }

  return renderTimelineStatusLine(entry, "red", { expandHint: Boolean(entry.errorDetail) });
}

export function isPlanFileTool(entry: Pick<ToolCallTimelineEntry, "name" | "detail">): boolean {
  return (entry.name === "Write" || entry.name === "Edit") && isPlanFileDetail(entry.detail);
}

export function isFileWriteTool(entry: Pick<ToolCallTimelineEntry, "name" | "detail">): boolean {
  return entry.name === "Write" && !isPlanFileDetail(entry.detail);
}

export function isFileEditTool(entry: Pick<ToolCallTimelineEntry, "name" | "detail">): boolean {
  return entry.name === "Edit" && !isPlanFileDetail(entry.detail);
}

function writeContentFromEntry(entry: ToolCallTimelineEntry): string {
  const input = entry.toolInput;
  const fromInput = input?.content ?? input?.contents;
  if (typeof fromInput === "string") return fromInput;
  const fromOutput = entry.output?.trim() ?? "";
  if (fromOutput && !/^File (created|updated) successfully/.test(fromOutput)) {
    return fromOutput;
  }
  return fromOutput;
}

function editStringsFromEntry(entry: ToolCallTimelineEntry): {
  oldString: string;
  newString: string;
} {
  const input = entry.toolInput ?? {};
  return {
    oldString: typeof input.old_string === "string" ? input.old_string : "",
    newString: typeof input.new_string === "string" ? input.new_string : "",
  };
}

/** Line add/remove counts for Write/Edit tool rows. */
export function fileLineChangeStatsFromEntry(
  entry: ToolCallTimelineEntry,
): { added: number; removed: number } | null {
  if (entry.name !== "Write" && entry.name !== "Edit") return null;
  if (isPlanFileDetail(entry.detail)) return null;
  if (!shouldShowFileBodyInChat(entry.detail)) return null;

  const update = fileUpdateBeforeAfterFromEntry(entry);
  if (update) {
    return countEditDiffStats(update.before, update.after);
  }

  if (entry.name === "Write") {
    const content = writeContentFromEntry(entry);
    if (!content.trim()) return null;
    return { added: countSourceLines(content), removed: 0 };
  }

  const { oldString, newString } = editStringsFromEntry(entry);
  if (!oldString && !newString) return null;
  return countEditDiffStats(oldString, newString);
}

/** Inline +N -M suffix after Write/Update(file) labels. */
export function renderFileLineChangeSuffix(
  stats: { added: number; removed: number } | null,
): string {
  if (!stats || (stats.added === 0 && stats.removed === 0)) return "";
  const parts: string[] = [];
  if (stats.added > 0) {
    parts.push(`${ansi.diffAdd}+${stats.added}${ansi.reset}`);
  }
  if (stats.removed > 0) {
    parts.push(`${ansi.diffRemove}-${stats.removed}${ansi.reset}`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/** Green/red status dot for a single first-level tool row that required approval. */
export function renderEntryApprovalPrefix(entry: ToolCallTimelineEntry): string {
  if (!entry.approvalRequired) return "";
  const failed = entry.approvalGranted === false || entry.status === "error";
  return failed ? `${ansi.red}⏺${ansi.reset} ` : `${ansi.green}⏺${ansi.reset} `;
}

/** Green/red status dot for first-level activity rows that required approval. */
export function renderActivityApprovalPrefix(entries: ToolCallTimelineEntry[]): string {
  const gated = entries.filter((e) => e.approvalRequired);
  if (gated.length === 0) return "";
  const failed = gated.some(
    (e) => e.approvalGranted === false || e.status === "error",
  );
  return failed ? `${ansi.red}⏺${ansi.reset} ` : `${ansi.green}⏺${ansi.reset} `;
}

function editBeforeAfterFromEntry(entry: ToolCallTimelineEntry): {
  before: string;
  after: string;
} {
  const { oldString, newString } = editStringsFromEntry(entry);
  const replaceAll = entry.toolInput?.replace_all === true;
  const after = entry.output?.trim() ?? "";
  if (after && !/^Replaced \d+/.test(after)) {
    return {
      before: reconstructBeforeEdit(after, oldString, newString, replaceAll),
      after,
    };
  }
  return { before: oldString, after: newString };
}

/** Before/after pair for unified diff preview (Edit, or Write overwriting an existing file). */
export function fileUpdateBeforeAfterFromEntry(entry: ToolCallTimelineEntry): {
  before: string;
  after: string;
} | null {
  if (isFileEditTool(entry)) {
    return editBeforeAfterFromEntry(entry);
  }
  if (isFileWriteTool(entry) && entry.priorContent !== undefined) {
    const after = writeContentFromEntry(entry);
    if (entry.priorContent !== after) {
      return { before: entry.priorContent, after };
    }
  }
  return null;
}

export function isFileUpdateDisplay(
  entry: Pick<ToolCallTimelineEntry, "name" | "detail" | "priorContent" | "toolInput" | "output">,
): boolean {
  return fileUpdateBeforeAfterFromEntry(entry as ToolCallTimelineEntry) !== null;
}

/** First-level file update header (Claude Code): ⏺ Update(add.py) +3 -2 */
export function renderFileUpdateHeaderLine(
  entry: ToolCallTimelineEntry,
  fullExpanded = false,
): string {
  const file = fileBasenameFromDetail(entry.detail);
  const stats =
    entry.status === "success" ? fileLineChangeStatsFromEntry(entry) : null;
  const hint =
    shouldShowFileBodyInChat(entry.detail)
      ? ` ${ansi.muted}(${fullExpanded ? "click to collapse" : "click to expand"})${ansi.reset}`
      : "";
  return `${renderEntryApprovalPrefix(entry)}${ansi.text}Update(${file})${ansi.reset}${renderFileLineChangeSuffix(stats)}${hint}`;
}

/** First-level Write header (Claude Code): ⏺ Write(add.py) +12 */
export function renderWriteToolHeaderLine(
  entry: ToolCallTimelineEntry,
  fullExpanded = false,
): string {
  if (isFileUpdateDisplay(entry)) {
    return renderFileUpdateHeaderLine(entry, fullExpanded);
  }
  const file = fileBasenameFromDetail(entry.detail);
  const stats =
    entry.status === "success" ? fileLineChangeStatsFromEntry(entry) : null;
  const hint =
    shouldShowFileBodyInChat(entry.detail)
      ? ` ${ansi.muted}(${fullExpanded ? "click to collapse" : "click to expand"})${ansi.reset}`
      : "";
  return `${renderEntryApprovalPrefix(entry)}${ansi.text}Write(${file})${ansi.reset}${renderFileLineChangeSuffix(stats)}${hint}`;
}

/** First-level Edit header (Claude Code): ⏺ Update(add.py) */
export function renderEditToolHeaderLine(
  entry: ToolCallTimelineEntry,
  fullExpanded = false,
): string {
  return renderFileUpdateHeaderLine(entry, fullExpanded);
}

/** Inner Write row (expanded activity) — no status dot. */
export function renderWriteToolInvocationLine(entry: ToolCallTimelineEntry): string {
  const file = fileBasenameFromDetail(entry.detail);
  const stats =
    entry.status === "success" ? fileLineChangeStatsFromEntry(entry) : null;
  return `${ansi.text}Write(${file})${ansi.reset}${renderFileLineChangeSuffix(stats)}`;
}

/** Inner Edit row (expanded activity) — no status dot. */
export function renderEditToolInvocationLine(entry: ToolCallTimelineEntry): string {
  const file = fileBasenameFromDetail(entry.detail);
  const stats =
    entry.status === "success" ? fileLineChangeStatsFromEntry(entry) : null;
  return `${ansi.text}Update(${file})${ansi.reset}${renderFileLineChangeSuffix(stats)}`;
}

export function renderFileDiffSummaryLine(
  entry: Pick<ToolCallTimelineEntry, "approvalRequired">,
  before: string,
  after: string,
): string {
  const { added, removed } = countEditDiffStats(before, after);
  const addWord = added === 1 ? "line" : "lines";
  const removeWord = removed === 1 ? "line" : "lines";
  const branch = entry.approvalRequired ? "   └ " : "└ ";
  return `${ansi.muted}${branch}Added ${added} ${addWord}, removed ${removed} ${removeWord}${ansi.reset}`;
}

export function renderWriteToolSummaryLine(entry: ToolCallTimelineEntry): string {
  const update = fileUpdateBeforeAfterFromEntry(entry);
  if (update) {
    return renderFileDiffSummaryLine(entry, update.before, update.after);
  }
  const file = fileBasenameFromDetail(entry.detail);
  const lines = countSourceLines(writeContentFromEntry(entry));
  const lineWord = lines === 1 ? "line" : "lines";
  const branch = entry.approvalRequired ? "   └ " : "└ ";
  return `${ansi.muted}${branch}Wrote ${lines} ${lineWord} to ${ansi.bold}${ansi.text}${file}${ansi.reset}`;
}

export function renderEditToolSummaryLine(entry: ToolCallTimelineEntry): string {
  const update = fileUpdateBeforeAfterFromEntry(entry);
  if (!update) return "";
  return renderFileDiffSummaryLine(entry, update.before, update.after);
}

/** Column for `└` / diff body — header base + 3 when ⏺ approval prefix is shown. */
export function fileToolContentIndent(
  entry: Pick<ToolCallTimelineEntry, "approvalRequired">,
  parentIndent = 4,
): number {
  return parentIndent + (entry.approvalRequired ? 3 : 0);
}

export function shouldShowFileBodyInChat(filePath: string): boolean {
  return isCodeFilePath(filePath);
}

/** Expanded Write detail lines (invocation + summary + code) — no first-level status dot. */
export function renderWriteToolDetailLines(
  entry: ToolCallTimelineEntry,
  width: number,
  branchIndent: number,
): string[] {
  const lines: string[] = [renderWriteToolInvocationLine(entry)];
  if (!shouldShowFileBodyInChat(entry.detail)) return lines;
  const content = writeContentFromEntry(entry);
  const update = fileUpdateBeforeAfterFromEntry(entry);
  if (update) {
    lines.push(
      ...renderFilePreviewLines(update.before, update.after, width, {
        indent: branchIndent,
        expanded: false,
        filePath: entry.detail,
      }),
    );
  } else if (content.trim()) {
    lines.push(
      ...renderFilePreviewLines("", content, width, {
        indent: branchIndent,
        expanded: false,
        filePath: entry.detail,
      }),
    );
  }
  return lines;
}

function renderFileUpdateBodyLines(
  entry: ToolCallTimelineEntry,
  width: number,
  contentStart: number,
  fullExpanded: boolean,
): string[] {
  if (!shouldShowFileBodyInChat(entry.detail)) return [];
  const update = fileUpdateBeforeAfterFromEntry(entry);
  if (!update) return [];
  return renderFilePreviewLines(update.before, update.after, width, {
    indent: contentStart,
    expanded: fullExpanded,
    filePath: entry.detail,
  });
}

/** Expanded Edit detail lines (invocation + summary + diff) — no first-level status dot. */
export function renderEditToolDetailLines(
  entry: ToolCallTimelineEntry,
  width: number,
  branchIndent: number,
): string[] {
  const lines: string[] = [renderEditToolInvocationLine(entry)];
  lines.push(...renderFileUpdateBodyLines(entry, width, branchIndent, false));
  return lines;
}

export function renderWriteToolLines(
  entry: ToolCallTimelineEntry,
  width: number,
  contentStart: number,
  fullExpanded: boolean,
): string[] {
  const lines: string[] = [renderWriteToolHeaderLine(entry, fullExpanded)];
  const showBody = shouldShowFileBodyInChat(entry.detail);
  if (entry.status === "success") {
    if (showBody) {
      const update = fileUpdateBeforeAfterFromEntry(entry);
      if (update) {
        lines.push(
          ...renderFilePreviewLines(update.before, update.after, width, {
            indent: contentStart,
            expanded: fullExpanded,
            filePath: entry.detail,
          }),
        );
      } else {
        const content = writeContentFromEntry(entry);
        if (content.trim()) {
          lines.push(
            ...renderFilePreviewLines("", content, width, {
              indent: contentStart,
              expanded: fullExpanded,
              collapsed: !fullExpanded,
              filePath: entry.detail,
            }),
          );
        }
      }
    }
  } else if (entry.status === "waiting") {
    if (entry.awaitingApproval) {
      lines[0] = `${ansi.yellow}Approve?${ansi.reset} ${ansi.muted}Write ${entry.detail.trim()}${ansi.reset}`;
    } else {
      const dots = WAITING_DOTS[entry.dotFrame % WAITING_DOTS.length]!;
      lines[0] = `${ansi.red}Waiting${dots}${ansi.reset} ${ansi.muted}${toolCallWaitingPhrase(entry.name, entry.detail)}${ansi.reset}`;
    }
  } else {
    lines[0] = renderTimelineStatusLine(entry, "red", {
      expandHint: Boolean(entry.errorDetail),
    });
  }
  return lines;
}

export function renderEditToolLines(
  entry: ToolCallTimelineEntry,
  width: number,
  contentStart: number,
  fullExpanded: boolean,
): string[] {
  const lines: string[] = [renderEditToolHeaderLine(entry, fullExpanded)];
  const showBody = shouldShowFileBodyInChat(entry.detail);
  if (entry.status === "success") {
    if (showBody) {
      lines.push(...renderFileUpdateBodyLines(entry, width, contentStart, fullExpanded));
    }
  } else if (entry.status === "waiting") {
    if (entry.awaitingApproval) {
      lines[0] = `${ansi.yellow}Approve?${ansi.reset} ${ansi.muted}Edit ${entry.detail.trim()}${ansi.reset}`;
    } else {
      const dots = WAITING_DOTS[entry.dotFrame % WAITING_DOTS.length]!;
      lines[0] = `${ansi.red}Waiting${dots}${ansi.reset} ${ansi.muted}${toolCallWaitingPhrase(entry.name, entry.detail)}${ansi.reset}`;
    }
  } else {
    lines[0] = renderTimelineStatusLine(entry, "red", {
      expandHint: Boolean(entry.errorDetail),
    });
  }
  return lines;
}

export function isSkillTool(entry: Pick<ToolCallTimelineEntry, "name">): boolean {
  return entry.name === "Skill";
}

export function isAgentTool(entry: Pick<ToolCallTimelineEntry, "name">): boolean {
  return entry.name === "Agent";
}

function formatSubagentDisplayName(subagentType: string): string {
  const normalized = subagentType.trim().toLowerCase();
  if (normalized === "general-purpose") return "General-purpose";
  if (!normalized) return "Agent";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function agentDescriptionFromEntry(entry: ToolCallTimelineEntry): string {
  const input = entry.toolInput ?? {};
  if (typeof input.description === "string" && input.description.trim()) {
    return input.description.trim();
  }
  return entry.detail.trim() || "agent task";
}

function agentSubagentTypeFromEntry(entry: ToolCallTimelineEntry): string {
  const input = entry.toolInput ?? {};
  if (typeof input.subagent_type === "string" && input.subagent_type.trim()) {
    return input.subagent_type.trim();
  }
  return "general-purpose";
}

export function renderAgentToolLines(entry: ToolCallTimelineEntry): string[] {
  const subagent = formatSubagentDisplayName(agentSubagentTypeFromEntry(entry));
  const description = agentDescriptionFromEntry(entry);
  const lines = [`${ansi.green}⏺${ansi.reset} ${ansi.text}${subagent}(${description})${ansi.reset}`];
  if (entry.backgrounded) {
    lines.push(
      `${ansi.muted}└ Backgrounded agent (↓ to manage · ctrl+o to expand)${ansi.reset}`,
    );
  }
  return lines;
}

/** Tree line when a subagent completes — Agent "…" finished */
export function renderAgentFinishedEventLine(description: string): string {
  const label = description.trim() || "agent task";
  return `${ansi.muted}└ ${ansi.reset}Agent "${ansi.text}${label}${ansi.reset}" finished`;
}

/** Tree line when a dynamic workflow completes — not user input. */
export function renderWorkflowFinishedEventLine(record: WorkflowRunRecord): string {
  return `${ansi.muted}└ ${ansi.reset}${workflowCompletedSummary(record)}`;
}

function skillDisplayName(detail: string): string {
  const trimmed = detail.trim();
  return trimmed || "skill";
}

/** Collapsed / expanded Skill activation row. */
export function renderSkillToolLines(entry: ToolCallTimelineEntry): string[] {
  const lines: string[] = [];
  const skillName = skillDisplayName(entry.detail);
  const hint =
    !entry.skillExpanded && entry.status === "success"
      ? ` ${ansi.muted}(click to expand)${ansi.reset}`
      : "";
  if (entry.status === "waiting") {
    const dots = WAITING_DOTS[entry.dotFrame % WAITING_DOTS.length]!;
    lines.push(
      `${ansi.red}Waiting${dots}${ansi.reset} ${ansi.muted}Skill(${skillName})${ansi.reset}`,
    );
    return lines;
  }
  const color = entry.status === "success" ? "green" : "red";
  lines.push(
    `${renderStatusDot(color)} ${ansi.text}Skill(${skillName})${ansi.reset}${hint}`,
  );
  if (entry.skillExpanded && entry.status === "success") {
    lines.push(`${ansi.muted}└ Successfully loaded skill${ansi.reset}`);
  }
  if (entry.skillExpanded && entry.status === "error" && entry.errorDetail?.trim()) {
    const wrapWidth = 72;
    const short =
      entry.errorDetail.trim().length > wrapWidth
        ? `${entry.errorDetail.trim().slice(0, wrapWidth - 1)}…`
        : entry.errorDetail.trim();
    lines.push(`${ansi.red}   ✘ ${short}${ansi.reset}`);
  }
  return lines;
}

export function isWorkflowTool(entry: Pick<ToolCallTimelineEntry, "name" | "detail">): boolean {
  return entry.name === "Workflow";
}

function renderWorkflowsSlashLink(): string {
  return `${ansi.planBorder}/workflows${ansi.reset}`;
}

export function workflowDisplayName(entry: Pick<ToolCallTimelineEntry, "detail">): string {
  return isWorkflowDetail(entry.detail)
    ? workflowNameFromDetail(entry.detail)
    : entry.detail.trim() || "workflow";
}

export function isDynamicWorkflowSkillName(name: string): boolean {
  return getSystemSkillHandler(name.trim()) === "dynamic-workflow";
}

export function renderWorkflowViewHintLine(): string {
  return `${ansi.muted}└ ${renderWorkflowsSlashLink()} ${ansi.muted}to view dynamic workflow runs${ansi.reset}`;
}

export function renderWorkflowToolLines(entry: ToolCallTimelineEntry): string[] {
  const wfName = workflowDisplayName(entry);
  if (isDynamicWorkflowSkillName(wfName)) {
    return renderSkillToolLines(entry);
  }
  const header = `${ansi.green}⏺${ansi.reset} ${ansi.text}Workflow(${wfName})${ansi.reset}`;
  if (entry.status === "error") {
    const detail = entry.errorDetail?.trim() || toolCallFailurePhrase(entry.name, entry.detail, entry.errorDetail);
    return [header, `${ansi.red}└ ${detail}${ansi.reset}`];
  }
  if (entry.status === "waiting" || entry.status === "success") {
    const hint =
      !entry.skillExpanded && entry.status === "success"
        ? ` ${ansi.muted}(click to expand)${ansi.reset}`
        : "";
    const lines = [`${header}${hint}`];
    if (entry.skillExpanded || entry.status === "waiting") {
      lines.push(renderWorkflowViewHintLine());
    }
    return lines;
  }
  return [renderToolCallStatusLine(entry)];
}

/** Collapsed activity summary: Thought for 10s, listed 1 directory, read 2 files */
export function renderActivitySummaryLine(
  thoughtSeconds: number | undefined,
  stats: string[],
  expanded: boolean,
  entries: ToolCallTimelineEntry[] = [],
): string {
  const parts: string[] = [];
  if (thoughtSeconds && thoughtSeconds > 0) {
    parts.push(`Thought for ${formatDurationSeconds(thoughtSeconds)}`);
  }
  parts.push(...stats);
  const summary = parts.length ? parts.join(", ") : "Finished tool calls";
  const chevron = expanded ? "▾" : "▸";
  const hint = expanded ? "click to collapse" : "click to expand";
  const prefix = renderActivityApprovalPrefix(entries);
  return `${prefix}${ansi.muted}${summary}${ansi.reset} ${ansi.muted}${chevron} (${hint})${ansi.reset}`;
}

/** Full Bash command from timeline entry (detail may be truncated). */
export function bashCommandFromEntry(entry: ToolCallTimelineEntry): string {
  const fromInput = entry.toolInput?.command;
  if (typeof fromInput === "string" && fromInput.trim()) return fromInput.trim();
  return entry.detail.trim();
}

export function isExecutionBashEntry(entry: Pick<ToolCallTimelineEntry, "name" | "detail" | "toolInput">): boolean {
  if (entry.name !== "Bash") return false;
  return isExecutionBashCommand(bashCommandFromEntry(entry as ToolCallTimelineEntry));
}

/** Expanded tool invocation header, e.g. Bash(ls -la /path) — no status dot. */
export function renderToolInvocationLine(entry: ToolCallTimelineEntry): string {
  if (entry.name === "Bash") {
    return `${ansi.text}Bash(${bashCommandFromEntry(entry)})${ansi.reset}`;
  }
  const label = formatToolInvocationLabel(entry.name, entry.detail);
  return `${ansi.text}${label}${ansi.reset}`;
}

/** Bash execution stdout/stderr under the invocation line. */
export function renderBashOutputLines(
  entry: ToolCallTimelineEntry,
  width: number,
  contentStart = 4,
): string[] {
  const raw = entry.output?.trim();
  if (!raw) return [];
  const wrapWidth = Math.max(20, width - contentStart - 2);
  return wrapContentLines(raw, wrapWidth).map(
    (line) => `${ansi.text}${line}${ansi.reset}`,
  );
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
  let executionBashCount = 0;

  const flushExecutionBash = (): void => {
    if (executionBashCount <= 0) return;
    stats.push(shellCommandStat(executionBashCount));
    executionBashCount = 0;
  };

  for (const entry of entries) {
    if (entry.status === "waiting") continue;
    if (isPlanFileTool(entry) || isFileWriteTool(entry) || isFileEditTool(entry) || isWorkflowTool(entry) || isSkillTool(entry) || isAgentTool(entry)) {
      flushExecutionBash();
      continue;
    }
    if (isExecutionBashEntry(entry)) {
      executionBashCount++;
      continue;
    }
    flushExecutionBash();
    const stat = toolCallStatPhrase(entry.name, entry.detail, entry.output);
    if (stat) stats.push(stat);
  }
  flushExecutionBash();
  return mergeActivityStatPhrases(stats);
}

export function isSkillToolToggleLine(meta?: { kind?: string }): boolean {
  return meta?.kind === "skill-tool-toggle";
}

export function isAgentToolToggleLine(meta?: { kind?: string }): boolean {
  return meta?.kind === "agent-tool-toggle";
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

export function isWriteToolToggleLine(meta?: { kind?: string }): boolean {
  return meta?.kind === "write-tool-toggle";
}

export function isEditToolToggleLine(meta?: { kind?: string }): boolean {
  return meta?.kind === "edit-tool-toggle";
}
