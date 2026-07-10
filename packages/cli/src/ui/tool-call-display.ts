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

/** First-level file update header (Claude Code): ⏺ Update(add.py) */
export function renderFileUpdateHeaderLine(entry: ToolCallTimelineEntry): string {
  const file = fileBasenameFromDetail(entry.detail);
  return `${renderEntryApprovalPrefix(entry)}${ansi.text}Update(${file})${ansi.reset}`;
}

/** First-level Write header (Claude Code): ⏺ Write(add.py) */
export function renderWriteToolHeaderLine(entry: ToolCallTimelineEntry): string {
  if (isFileUpdateDisplay(entry)) {
    return renderFileUpdateHeaderLine(entry);
  }
  const file = fileBasenameFromDetail(entry.detail);
  return `${renderEntryApprovalPrefix(entry)}${ansi.text}Write(${file})${ansi.reset}`;
}

/** First-level Edit header (Claude Code): ⏺ Update(add.py) */
export function renderEditToolHeaderLine(entry: ToolCallTimelineEntry): string {
  return renderFileUpdateHeaderLine(entry);
}

/** Inner Write row (expanded activity) — no status dot. */
export function renderWriteToolInvocationLine(entry: ToolCallTimelineEntry): string {
  const file = fileBasenameFromDetail(entry.detail);
  return `${ansi.text}Write(${file})${ansi.reset}`;
}

/** Inner Edit row (expanded activity) — no status dot. */
export function renderEditToolInvocationLine(entry: ToolCallTimelineEntry): string {
  const file = fileBasenameFromDetail(entry.detail);
  return `${ansi.text}Update(${file})${ansi.reset}`;
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
  const lines: string[] = [
    renderWriteToolInvocationLine(entry),
    renderWriteToolSummaryLine(entry),
  ];
  if (!shouldShowFileBodyInChat(entry.detail)) return lines;
  const content = writeContentFromEntry(entry);
  const update = fileUpdateBeforeAfterFromEntry(entry);
  if (update) {
    lines.push(
      ...renderFilePreviewLines(update.before, update.after, width, {
        indent: branchIndent,
        collapsed: true,
        filePath: entry.detail,
      }),
    );
  } else if (content.trim()) {
    lines.push(
      ...renderFilePreviewLines("", content, width, {
        indent: branchIndent,
        collapsed: true,
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
  collapsed: boolean,
): string[] {
  if (!shouldShowFileBodyInChat(entry.detail)) return [];
  const update = fileUpdateBeforeAfterFromEntry(entry);
  if (!update) return [];
  return renderFilePreviewLines(update.before, update.after, width, {
    indent: contentStart,
    collapsed,
    filePath: entry.detail,
  });
}

/** Expanded Edit detail lines (invocation + summary + diff) — no first-level status dot. */
export function renderEditToolDetailLines(
  entry: ToolCallTimelineEntry,
  width: number,
  branchIndent: number,
): string[] {
  const lines: string[] = [
    renderEditToolInvocationLine(entry),
    renderEditToolSummaryLine(entry),
  ];
  lines.push(...renderFileUpdateBodyLines(entry, width, branchIndent, false));
  return lines;
}

export function renderWriteToolLines(
  entry: ToolCallTimelineEntry,
  width: number,
  contentStart: number,
  collapsed: boolean,
): string[] {
  const lines: string[] = [renderWriteToolHeaderLine(entry)];
  const showBody = shouldShowFileBodyInChat(entry.detail);
  if (entry.status === "success") {
    if (!showBody || !collapsed) {
      lines.push(renderWriteToolSummaryLine(entry));
    }
    if (showBody && !collapsed) {
      const update = fileUpdateBeforeAfterFromEntry(entry);
      if (update) {
        lines.push(
          ...renderFilePreviewLines(update.before, update.after, width, {
            indent: contentStart,
            collapsed: false,
            filePath: entry.detail,
          }),
        );
      } else {
        const content = writeContentFromEntry(entry);
        if (content.trim()) {
          lines.push(
            ...renderFilePreviewLines("", content, width, {
              indent: contentStart,
              collapsed: false,
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
    const hint =
      entry.errorDetail && !entry.errorExpanded
        ? ` ${ansi.muted}(click to expand)${ansi.reset}`
        : "";
    lines[0] = `${ansi.red}${toolCallFailurePhrase(entry.name, entry.detail, entry.errorDetail)}${ansi.reset}${hint}`;
  }
  return lines;
}

export function renderEditToolLines(
  entry: ToolCallTimelineEntry,
  width: number,
  contentStart: number,
  collapsed: boolean,
): string[] {
  const lines: string[] = [renderEditToolHeaderLine(entry)];
  const showBody = shouldShowFileBodyInChat(entry.detail);
  if (entry.status === "success") {
    if (!showBody || !collapsed) {
      lines.push(renderEditToolSummaryLine(entry));
    }
    if (showBody && !collapsed) {
      lines.push(...renderFileUpdateBodyLines(entry, width, contentStart, false));
    }
  } else if (entry.status === "waiting") {
    if (entry.awaitingApproval) {
      lines[0] = `${ansi.yellow}Approve?${ansi.reset} ${ansi.muted}Edit ${entry.detail.trim()}${ansi.reset}`;
    } else {
      const dots = WAITING_DOTS[entry.dotFrame % WAITING_DOTS.length]!;
      lines[0] = `${ansi.red}Waiting${dots}${ansi.reset} ${ansi.muted}${toolCallWaitingPhrase(entry.name, entry.detail)}${ansi.reset}`;
    }
  } else {
    const hint =
      entry.errorDetail && !entry.errorExpanded
        ? ` ${ansi.muted}(click to expand)${ansi.reset}`
        : "";
    lines[0] = `${ansi.red}${toolCallFailurePhrase(entry.name, entry.detail, entry.errorDetail)}${ansi.reset}${hint}`;
  }
  return lines;
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
    if (isPlanFileTool(entry) || isFileWriteTool(entry) || isFileEditTool(entry) || isWorkflowTool(entry)) {
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

export function isWriteToolToggleLine(meta?: { kind?: string }): boolean {
  return meta?.kind === "write-tool-toggle";
}

export function isEditToolToggleLine(meta?: { kind?: string }): boolean {
  return meta?.kind === "edit-tool-toggle";
}
