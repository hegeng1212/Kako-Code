import type { AskUserQuestionOption } from "@kako/shared";
import { ansi, displayWidth, stripAnsi, visibleLength } from "./ansi.js";
import {
  renderChoiceGroupLines,
  renderChoiceOptionLine,
  renderChoiceSummaryLine,
} from "./ask-user-question-display.js";
import { renderRichContentLines } from "./markdown-render.js";
import { renderSlashInputText } from "./slash-suggest.js";
import {
  collectActivityStats,
  fileToolContentIndent,
  isFileEditTool,
  isFileWriteTool,
  isPlanFileTool,
  isPlanToolToggleLine,
  isSkillTool,
  isSkillToolToggleLine,
  isAgentTool,
  renderAgentToolLines,
  isWorkflowTool,
  isDynamicWorkflowSkillName,
  workflowDisplayName,
  renderActivitySummaryLine,
  renderBashOutputLines,
  renderEditToolLines,
  renderPlanPreviewHint,
  renderSkillToolLines,
  renderToolCallErrorLines,
  renderToolCallStatusLine,
  renderToolInvocationLine,
  isExecutionBashEntry,
  renderToolOutputLines,
  renderWorkflowToolLines,
  renderWriteToolLines,
  shouldShowFileBodyInChat,
  type ToolCallTimelineEntry,
} from "./tool-call-display.js";
import { toolCallWaitingPhrase } from "./tool-call-phrases.js";
import { renderPlanBoxLines, renderCurrentPlanTreeLine, renderPlanPathLine } from "./plan-box.js";
import { wrapContentLines } from "./text-wrap.js";
import {
  renderAnswerPulsingPrefix,
  renderBreathingRedPrefix,
  renderBreathingRedText,
  renderMutedPulsingPrefix,
} from "./stream-pulse.js";
import { extractDisplayFilePaths, formatFileBranchLabel } from "./file-path-display.js";
import { formatDurationSeconds } from "./format-duration.js";
import { extractImageLabelsInOrder } from "./image-markers.js";
import {
  activityFormFromTasks,
  renderTaskListBlockLines,
  type TaskListItemView,
} from "./task-list-display.js";

export interface RenderTurnOptions {
  now?: number;
  /** True when rendering the in-progress turn (enables live pulse). */
  isActive?: boolean;
}

export type { ToolCallTimelineEntry } from "./tool-call-display.js";

export interface ChoiceGroupItem {
  header: string;
  question: string;
  answer: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
  declined?: boolean;
}

export interface ChoiceGroupTimelineEntry {
  type: "choice-group";
  id: string;
  items: ChoiceGroupItem[];
}

export interface PlanPreviewTimelineEntry {
  type: "plan-preview";
  planPath: string;
  planText: string;
}

export interface ChoiceTimelineEntry {
  type: "choice";
  id: string;
  header: string;
  question: string;
  answer: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
  declined?: boolean;
}

export type TurnTimelineEntry =
  | {
      type: "thinking";
      text: string;
      startedAt: number;
      /** Updated on each reasoning chunk — used to freeze duration at stream end. */
      lastChunkAt: number;
      endedAt: number | null;
    }
  | { type: "answer"; text: string }
  | { type: "event"; lines: string[] }
  | { type: "task-list"; items: TaskListItemView[] }
  | PlanPreviewTimelineEntry
  | ToolCallTimelineEntry
  | ChoiceTimelineEntry
  | ChoiceGroupTimelineEntry;

export interface ChatTurn {
  id: string;
  userText: string;
  /** Current streaming answer segment (mirrors the open timeline answer entry). */
  answerText: string;
  thinkingStartedAt: number;
  thinkingEndedAt: number | null;
  finishedAt: number | null;
  /** Past-tense completion verb, e.g. "Cooked" — set once when the turn finishes. */
  doneVerb: string | null;
  /** Present-participle status verb, e.g. "Working" — set once when the turn starts. */
  generatingVerb: string | null;
  outputTokens: number;
  phase: "thinking" | "answering" | "done";
  /** Chronological stream: thinking, tools, choices, answer segments. */
  timeline: TurnTimelineEntry[];
  /** Expanded thinking entries (timeline index → visible). */
  expandedThoughts: Set<number>;
  /** Expanded adjacent tool-call groups (groupId → visible). */
  expandedToolGroups: Set<string>;
  /** Expanded AskUserQuestion choice blocks (choiceId → visible). */
  expandedChoices: Set<string>;
  /** Animation frame for streaming icon pulse (0–3). */
  pulseFrame: number;
  /** Plan mode turn — uses fixed "Worked" verb and optional recap. */
  planMode?: boolean;
  /** Harness-only turn (/plan enter, shift+tab) — no done duration line. */
  harnessOnly?: boolean;
  /**
   * Protocol wake with no chat chrome (stepped-away recap).
   * Thinking/answer must not appear in the timeline; results update data only.
   */
  silentChat?: boolean;
  recapText?: string;
}

export interface RenderLine {
  text: string;
  meta?: {
    turnId: string;
    kind:
      | "thought-summary"
      | "thought-toggle"
      | "thought-body"
      | "tool-error-toggle"
      | "tool-group-toggle"
      | "plan-tool-toggle"
      | "write-tool-toggle"
      | "edit-tool-toggle"
      | "skill-tool-toggle"
      | "agent-tool-toggle"
      | "choice-toggle";
    toolId?: string;
    groupId?: string;
    choiceId?: string;
    /** Timeline index of the thinking entry for thought-* click targets. */
    thoughtIndex?: number;
  };
}

export const CHAT_TIPS = [
  "Tip: Running multiple Kako sessions? Use /sessions and /resume to switch between them.",
  "Tip: Edit ~/.kako/KAKO.md for global instructions.",
  "Tip: Add KAKO.md in your project for project-specific context.",
];

const LINE_INDENT = 2;
/** Blank lines inserted between consecutive answer content rows. */
const ANSWER_LINE_GAP = 1;
/** Body text column — after a 2-char prefix (`> `, `● `, `∴ `). */
const BODY_START = LINE_INDENT + 2;
/** Common prefix width: `> `, `⏺ `, `* `, `◐ `, etc. */
const PREFIX_WIDTH = 2;

function indent(text: string, spaces: number): string {
  return " ".repeat(spaces) + text;
}

/** Indent `└`/`│` branches so they align with the parent line's body text, not its icon. */
function treeBranchIndent(parentIndent: number, parentPrefixWidth = PREFIX_WIDTH): number {
  return parentIndent + parentPrefixWidth;
}

function gap(): string {
  return "";
}

type ThinkingEntry = Extract<TurnTimelineEntry, { type: "thinking" }>;

type ActivityBatchItem =
  | { type: "thinking"; entry: ThinkingEntry; index: number }
  | { type: "tool"; entry: ToolCallTimelineEntry }
  | { type: "event"; lines: string[] };

function activityGroupId(turnId: string, batchStart: number): string {
  return `${turnId}:activity:${batchStart}`;
}

function activityBranchPrefix(isLast: boolean): string {
  return isLast ? "└ " : "│ ";
}

function activityBodyPrefix(parentIsLast: boolean): string {
  return parentIsLast ? "   " : "│  ";
}

function isLiveWaitingTool(entry: ToolCallTimelineEntry): boolean {
  return entry.status === "waiting" && !entry.awaitingApproval;
}

/** Waiting… status pinned above * Refining (not in the scroll timeline). Static dots — no animation. */
export function renderLiveWaitingPinLine(entry: ToolCallTimelineEntry): string {
  return indent(
    `${ansi.red}Waiting...${ansi.reset} ${ansi.muted}${toolCallWaitingPhrase(entry.name, entry.detail)}${ansi.reset}`,
    LINE_INDENT,
  );
}

export function collectLiveWaitingPinLines(turn: ChatTurn): string[] {
  const lines: string[] = [];
  for (const entry of turn.timeline) {
    // Foreground Agent/Explore renders in the chat timeline (Claude-style), not as a pin.
    if (entry.type === "tool" && isLiveWaitingTool(entry) && !isAgentTool(entry)) {
      lines.push(renderLiveWaitingPinLine(entry));
    }
  }
  return lines;
}

function renderActivityExpandedTree(
  items: ActivityBatchItem[],
  width: number,
  now: number,
  hideLiveWaiting = false,
): string[] {
  const lines: string[] = [];
  const baseIndent = treeBranchIndent(BODY_START);
  const visibleItems = items.filter((item) => {
    if (item.type !== "tool") return true;
    if (isPlanFileTool(item.entry)) return false;
    if (hideLiveWaiting && item.entry.status === "waiting") return false;
    return true;
  });

  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i]!;
    const isLast = i === visibleItems.length - 1;
    const branch = activityBranchPrefix(isLast);
    const bodyPrefix = activityBodyPrefix(isLast);
    const contentIndent = baseIndent + branch.length;
    const wrapWidth = Math.max(20, width - contentIndent - 2);

    if (item.type === "thinking") {
      const secs = thoughtEntrySeconds(item.entry, now);
      lines.push(
        indent(
          `${ansi.muted}${branch}Thought for ${formatDurationSeconds(secs)}${ansi.reset}`,
          baseIndent,
        ),
      );
      const plain = item.entry.text.trim() || "(no thinking content)";
      for (const [j, line] of wrapContentLines(plain, wrapWidth).entries()) {
        const marker = j === 0 ? "∴ " : "  ";
        lines.push(
          indent(
            `${ansi.muted}${bodyPrefix}${marker}${line}${ansi.reset}`,
            baseIndent,
          ),
        );
      }
      continue;
    }

    if (item.type === "tool") {
      if (item.entry.status === "waiting") {
        const dots = ["", ".", "..", "..."][item.entry.dotFrame % 4]!;
        lines.push(
          indent(
            `${ansi.muted}${branch}${ansi.red}Waiting${dots}${ansi.reset} ${ansi.muted}${toolCallWaitingPhrase(item.entry.name, item.entry.detail)}${ansi.reset}`,
            baseIndent,
          ),
        );
        continue;
      }
      lines.push(
        indent(`${ansi.muted}${branch}${ansi.reset}${renderToolInvocationLine(item.entry)}`, baseIndent),
      );
      const outputLines = isExecutionBashEntry(item.entry)
        ? renderBashOutputLines(item.entry, width, contentIndent)
        : renderToolOutputLines(item.entry, width, contentIndent);
      for (const line of outputLines) {
        lines.push(indent(`${ansi.muted}${bodyPrefix}${ansi.reset}${line}`, baseIndent));
      }
      continue;
    }

    if (item.type === "event") {
      for (let j = 0; j < item.lines.length; j++) {
        const line = item.lines[j]!;
        const eventBranch = j === item.lines.length - 1 ? branch : "│ ";
        lines.push(indent(`${ansi.muted}${eventBranch}${ansi.reset}${line}`, baseIndent));
      }
    }
  }

  return lines;
}

function thoughtEntrySeconds(entry: ThinkingEntry, now = Date.now(), live = false): number {
  const end = entry.endedAt ?? (live ? now : entry.lastChunkAt);
  const secs = Math.max(0, Math.floor((end - entry.startedAt) / 1000));
  // Never show "Thought for 0s" — minimum 1s once thinking is visible.
  if (entry.text.trim() || live) return Math.max(1, secs);
  return secs;
}

export function renderThoughtSummaryForEntry(
  entry: ThinkingEntry,
  now = Date.now(),
  live = false,
  pulseFrame = 0,
): string {
  const secs = thoughtEntrySeconds(entry, now, live);
  const prefix = renderMutedPulsingPrefix("◐", pulseFrame, live);
  const label = live
    ? `Thinking for ${formatDurationSeconds(secs)}...`
    : `Thought for ${formatDurationSeconds(secs)}`;
  return indent(`${prefix}${ansi.muted}${label}${ansi.reset}`, LINE_INDENT);
}

function turnElapsedSeconds(turn: ChatTurn, now = Date.now()): number {
  const end = turn.finishedAt ?? now;
  const ms = Math.max(0, end - turn.thinkingStartedAt);
  if (ms <= 0) return 0;
  // Floor would show "0s" for real sub-second turns; round up to at least 1s.
  return Math.max(1, Math.round(ms / 1000));
}

/** Exported for tests. */
export { turnElapsedSeconds };

export function turnHasThinking(turn: ChatTurn): boolean {
  return turn.timeline.some((e) => e.type === "thinking" && e.text.trim().length > 0);
}

/** Live status label shown in the pinned footer during an in-progress turn. */
export function resolveLiveActivityPhase(
  turn: ChatTurn,
): "tools" | "waiting" | "thinking" | "writing" {
  if (turn.timeline.some((e) => e.type === "tool" && e.status === "waiting")) {
    return "tools";
  }
  if (turn.phase === "answering") {
    return "writing";
  }
  const hasOpenThinking = turn.timeline.some(
    (e) => e.type === "thinking" && e.endedAt === null && e.text.trim().length > 0,
  );
  if (hasOpenThinking) {
    return "thinking";
  }
  if (turn.timeline.some((e) => e.type === "tool")) {
    return "waiting";
  }
  return "thinking";
}

export function renderSmooshingLine(turn: ChatTurn, now = Date.now()): string {
  const elapsed = turnElapsedSeconds(turn, now);
  const tokens = turn.outputTokens || estimateTokens(turn);
  const phase = resolveLiveActivityPhase(turn);
  const taskList = [...turn.timeline].reverse().find((e) => e.type === "task-list");
  const taskVerb =
    taskList?.type === "task-list" ? activityFormFromTasks(taskList.items) : undefined;
  const verb = taskVerb ?? turn.generatingVerb ?? "Working";
  const live = turn.phase !== "done";
  const star = renderBreathingRedPrefix("*", turn.pulseFrame, live);
  const verbText = renderBreathingRedText(`${verb}…`, turn.pulseFrame, live);
  const meta = `${ansi.text}(${formatDurationSeconds(elapsed)} · ↓ ${tokens} tokens · ${phase})${ansi.reset}`;
  return indent(`${star}${verbText} ${meta}`, LINE_INDENT);
}

export const GENERATING_VERBS = [
  "Working",
  "Cooking",
  "Crunching",
  "Cogitating",
  "Pondering",
  "Whirring",
  "Musing",
  "Synthesizing",
  "Refining",
  "Deliberating",
  "Smooshing",
] as const;

export function pickGeneratingVerb(): string {
  const verbs = GENERATING_VERBS;
  return verbs[Math.floor(Math.random() * verbs.length)] ?? "Working";
}

export const DONE_VERBS = [
  "Cooked",
  "Crunched",
  "Cogitated",
  "Worked",
  "Pondered",
  "Whirred",
  "Mused",
  "Synthesized",
  "Refined",
  "Deliberated",
] as const;

export function pickDoneVerb(): string {
  const verbs = DONE_VERBS;
  return verbs[Math.floor(Math.random() * verbs.length)] ?? "Worked";
}

export function renderDoneStatus(turn: ChatTurn, now = Date.now()): string {
  if (!turn.finishedAt) return "";
  const verb = turn.planMode ? "Worked" : (turn.doneVerb ?? "Worked");
  return indent(
    `${ansi.muted}* ${verb} for ${formatDurationSeconds(turnElapsedSeconds(turn, now))}${ansi.reset}`,
    LINE_INDENT,
  );
}

export function renderRecapLine(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return indent(`${ansi.muted}* recap: ${trimmed}${ansi.reset}`, LINE_INDENT);
}

export function renderThoughtBodyForEntry(entry: ThinkingEntry, width: number): string[] {
  const plain = entry.text.trim() || "(no thinking content)";
  const wrapWidth = Math.max(20, width - BODY_START - 2);
  const wrapped = wrapContentLines(plain, wrapWidth);
  return wrapped.map((line, i) =>
    indent(
      i === 0
        ? `${ansi.muted}∴ ${line}${ansi.reset}`
        : `${ansi.muted}${line}${ansi.reset}`,
      i === 0 ? treeBranchIndent(LINE_INDENT) : treeBranchIndent(LINE_INDENT) + 2,
    ),
  );
}

/** Live stream body: └ first line, continuation indented under the branch. */
export function renderLiveThinkingBodyForEntry(entry: ThinkingEntry, width: number): string[] {
  const plain = entry.text.trim();
  if (!plain) return [];
  const wrapWidth = Math.max(20, width - BODY_START - 2);
  const wrapped = wrapContentLines(plain, wrapWidth);
  return wrapped.map((line, i) =>
    indent(
      i === 0
        ? `${ansi.muted}└ ${line}${ansi.reset}`
        : `${ansi.muted}${line}${ansi.reset}`,
      i === 0 ? treeBranchIndent(LINE_INDENT) : treeBranchIndent(LINE_INDENT) + 2,
    ),
  );
}

/** Box-drawing / table chrome — must stay contiguous (no inserted blank rows). */
function isTableChromeLine(line: string): boolean {
  const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
  return /[┌┬┐├┼┤└┴┘│]/.test(plain);
}

function isAsciiBoxLine(line: string): boolean {
  const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
  if (isTableChromeLine(plain)) return true;
  // Keep ASCII |…| / underscore boxes tight (same as table chrome).
  return /^\s*\|.*\|\s*$/.test(plain) || /^\s*[_=-]{6,}\s*$/.test(plain);
}

function expandLineSpacing(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    out.push(line);
    if (line === "") continue;
    const next = lines[i + 1];
    if (next === undefined || next === "") continue;
    // Keep markdown tables / ASCII boxes tight so right borders stay aligned.
    if (isAsciiBoxLine(line) && isAsciiBoxLine(next)) continue;
    for (let g = 0; g < ANSWER_LINE_GAP; g++) {
      out.push("");
    }
  }
  return out;
}

export function renderAnswerTextLines(
  text: string,
  width: number,
  opts?: { pulseFrame?: number; pulseLive?: boolean },
): string[] {
  if (!text.trim()) return [];
  const wrapWidth = Math.max(20, width - BODY_START - 2);
  const wrapped = expandLineSpacing(renderRichContentLines(text.trim(), wrapWidth));
  let seenContent = false;
  const pulseFrame = opts?.pulseFrame ?? 0;
  const pulseLive = opts?.pulseLive ?? false;
  return wrapped.map((line) => {
    if (line === "") return "";
    const isFirst = !seenContent;
    seenContent = true;
    const bullet = renderAnswerPulsingPrefix("●", pulseFrame, pulseLive && isFirst);
    return indent(
      isFirst
        ? `${bullet}${ansi.text}${line}${ansi.reset}`
        : `${"  "}${ansi.text}${line}${ansi.reset}`,
      LINE_INDENT,
    );
  });
}

export function renderAnswerLines(
  turn: ChatTurn,
  width: number,
  opts?: { pulseLive?: boolean },
): string[] {
  return renderAnswerTextLines(turn.answerText, width, {
    pulseFrame: turn.pulseFrame,
    pulseLive: opts?.pulseLive,
  });
}

function formatUserMessageLine(lineText: string, isFirst: boolean): string {
  // Chat history user bar: white text on dark background (input box stays muted).
  const body = renderSlashInputText(lineText, { tone: "bright" });
  if (isFirst) {
    return `${ansi.text}> ${body}`;
  }
  return `  ${body}`;
}

/** Inner `ansi.reset` clears background; re-apply the strip after each nested reset. */
function withPersistentUserMessageBg(promptLine: string): string {
  if (!promptLine.includes(ansi.reset)) return promptLine;
  return promptLine.replaceAll(ansi.reset, `${ansi.reset}${ansi.userMessageBg}`);
}

/** Full-width dark strip for user input in chat history (Claude Code style). */
export function padUserMessageLine(promptLine: string, cols: number): string {
  const inner = `${ansi.userMessageBg}${withPersistentUserMessageBg(promptLine)}`;
  const w = displayWidth(inner);
  const pad = Math.max(0, cols - w);
  return `${inner}${" ".repeat(pad)}${ansi.reset}`;
}

export function renderUserMessage(
  userText: string,
  cols: number,
  options?: { trailingGap?: boolean },
): string[] {
  const imageLabels = extractImageLabelsInOrder(userText);
  const filePaths = extractDisplayFilePaths(userText);
  const logicalLines = userText.length ? userText.split("\n") : [""];
  const lines = [gap()];
  for (let i = 0; i < logicalLines.length; i++) {
    lines.push(padUserMessageLine(formatUserMessageLine(logicalLines[i]!, i === 0), cols));
  }
  for (const label of imageLabels) {
    lines.push(
      indent(
        `${ansi.muted}└ ${ansi.reset}${ansi.text}${label}${ansi.reset}`,
        treeBranchIndent(LINE_INDENT),
      ),
    );
  }
  for (const filePath of filePaths) {
    lines.push(
      indent(
        `${ansi.muted}└ ${ansi.planBorder}📄 ${formatFileBranchLabel(filePath)}${ansi.reset}`,
        treeBranchIndent(LINE_INDENT),
      ),
    );
  }
  if (options?.trailingGap !== false) {
    lines.push(gap());
  }
  return lines;
}

function lastThinkingIndex(timeline: TurnTimelineEntry[]): number {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]?.type === "thinking") return i;
  }
  return -1;
}

function lastAnswerTimelineIndex(timeline: TurnTimelineEntry[]): number {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]?.type === "answer") return i;
  }
  return -1;
}

function renderThinkingEntry(
  turn: ChatTurn,
  entry: ThinkingEntry,
  index: number,
  width: number,
  now: number,
  isActive: boolean,
): RenderLine[] {
  if (!entry.text.trim()) return [];

  const expanded = turn.expandedThoughts.has(index);
  const isLive =
    isActive &&
    entry.endedAt === null &&
    turn.phase !== "done" &&
    index === lastThinkingIndex(turn.timeline);
  const out: RenderLine[] = [...timelineBlockGaps()];

  // Live stream: Thinking for Ns... + └ body (ignore expand set for layout).
  if (isLive) {
    out.push({
      text: renderThoughtSummaryForEntry(entry, now, true, turn.pulseFrame),
      meta: { turnId: turn.id, kind: "thought-summary", thoughtIndex: index },
    });
    const body = renderLiveThinkingBodyForEntry(entry, width);
    body.forEach((text, i) => {
      out.push({
        text,
        meta: {
          turnId: turn.id,
          kind: i === 0 ? "thought-toggle" : "thought-body",
          thoughtIndex: index,
        },
      });
    });
    out.push(...timelineBlockGaps());
    return out;
  }

  if (expanded) {
    const body = renderThoughtBodyForEntry(entry, width);
    body.forEach((text, i) => {
      out.push({
        text,
        meta: {
          turnId: turn.id,
          kind: i === 0 ? "thought-toggle" : "thought-body",
          thoughtIndex: index,
        },
      });
    });
  } else {
    out.push({
      text: renderThoughtSummaryForEntry(entry, now, false, turn.pulseFrame),
      meta: { turnId: turn.id, kind: "thought-summary", thoughtIndex: index },
    });
  }
  out.push(...timelineBlockGaps());
  return out;
}

function timelineBlockGaps(): RenderLine[] {
  const lines: RenderLine[] = [];
  for (let g = 0; g < ANSWER_LINE_GAP; g++) {
    lines.push({ text: gap() });
  }
  return lines;
}

function isBlankRenderLine(line: RenderLine): boolean {
  return line.text.replace(/\x1b\[[0-9;]*m/g, "").trim() === "";
}

/** Keep exactly one blank between timeline blocks (collapse tool/thought double gaps). */
function collapseConsecutiveBlankRenderLines(lines: RenderLine[]): RenderLine[] {
  const out: RenderLine[] = [];
  for (const line of lines) {
    if (
      isBlankRenderLine(line) &&
      out.length > 0 &&
      isBlankRenderLine(out[out.length - 1]!)
    ) {
      continue;
    }
    out.push(line);
  }
  return out;
}

/** Explore / activity / tool tree children — stay tight under their parent. */
function isNestedChatLine(line: RenderLine): boolean {
  const plain = stripAnsi(line.text);
  if (/^\s+[└│]/.test(plain)) return true;
  if (/^\s+\(ctrl\+b/i.test(plain)) return true;
  if (/^\s+Running\.\.\./i.test(plain)) return true;
  return false;
}

/**
 * Top-level chat blocks (answer, tools, Thought, * Done, * recap, activity summary…).
 * Answer continuations and nested └ children are not starts.
 */
function isMainBlockStart(line: RenderLine): boolean {
  if (isBlankRenderLine(line) || isNestedChatLine(line)) return false;
  const kind = line.meta?.kind;
  if (
    kind === "thought-summary" ||
    kind === "thought-toggle" ||
    kind === "tool-group-toggle" ||
    kind === "agent-tool-toggle" ||
    kind === "skill-tool-toggle" ||
    kind === "write-tool-toggle" ||
    kind === "edit-tool-toggle" ||
    kind === "plan-tool-toggle" ||
    kind === "tool-error-toggle"
  ) {
    return true;
  }
  const plain = stripAnsi(line.text).trimStart();
  if (!plain) return false;
  if (/^[>●○⏺*]/.test(plain)) return true;
  if (/^Thought for\b/.test(plain)) return true;
  if (/\(click to (?:expand|collapse)\)/.test(plain)) return true;
  if (/^\[.+\]/.test(plain)) return true; // AskUserQuestion headers
  return false;
}

/**
 * Main chat messages must not sit flush — one blank between blocks.
 * Nested Explore/activity children (└ / │) stay compact.
 */
function ensureMainMessageGaps(lines: RenderLine[]): RenderLine[] {
  const out: RenderLine[] = [];
  for (const line of lines) {
    if (
      out.length > 0 &&
      isMainBlockStart(line) &&
      !isBlankRenderLine(out[out.length - 1]!)
    ) {
      const prev = out[out.length - 1]!;
      // Keep markdown / ASCII box rows tight (same as answer line spacing).
      if (!(isAsciiBoxLine(stripAnsi(prev.text)) && isAsciiBoxLine(stripAnsi(line.text)))) {
        out.push({ text: gap() });
      }
    }
    out.push(line);
  }
  return collapseConsecutiveBlankRenderLines(out);
}

function pushThoughtPreamble(out: RenderLine[], thoughtSeconds?: number): void {
  if (thoughtSeconds == null) return;
  out.push({
    text: indent(
      `${ansi.muted}Thought for ${formatDurationSeconds(thoughtSeconds)}${ansi.reset}`,
      LINE_INDENT,
    ),
  });
  out.push(...timelineBlockGaps());
}

function toolGroupId(turnId: string, timelineStartIndex: number): string {
  return `${turnId}:tools:${timelineStartIndex}`;
}

function renderToolEntry(
  turn: ChatTurn,
  entry: ToolCallTimelineEntry,
  width: number,
): RenderLine[] {
  const out: RenderLine[] = [...timelineBlockGaps()];
  out.push({
    text: indent(renderToolCallStatusLine(entry), BODY_START),
    meta:
      entry.status === "error" && entry.errorDetail
        ? { turnId: turn.id, kind: "tool-error-toggle", toolId: entry.id }
        : undefined,
  });
  for (const line of renderToolCallErrorLines(entry, width, BODY_START)) {
    out.push({ text: indent(line, BODY_START) });
  }
  out.push(...timelineBlockGaps());
  return out;
}

function renderWorkflowToolEntry(
  turn: ChatTurn,
  entry: ToolCallTimelineEntry,
  thoughtSeconds?: number,
): RenderLine[] {
  if (isDynamicWorkflowSkillName(workflowDisplayName(entry))) {
    return renderSkillToolEntry(turn, entry, thoughtSeconds);
  }
  const out: RenderLine[] = [...timelineBlockGaps()];
  if (thoughtSeconds != null) {
    pushThoughtPreamble(out, thoughtSeconds);
  }
  const lines = renderWorkflowToolLines(entry);
  for (let i = 0; i < lines.length; i++) {
    out.push({
      text: indent(lines[i]!, i === 0 ? BODY_START : treeBranchIndent(BODY_START)),
      meta:
        i === 0 && entry.status === "success"
          ? { turnId: turn.id, kind: "skill-tool-toggle", toolId: entry.id }
          : undefined,
    });
  }
  out.push(...timelineBlockGaps());
  return out;
}

function renderPlanPreviewEntry(entry: PlanPreviewTimelineEntry, width: number): RenderLine[] {
  const out: RenderLine[] = [...timelineBlockGaps()];
  out.push({
    text: indent(renderCurrentPlanTreeLine(), treeBranchIndent(BODY_START)),
  });
  out.push({
    text: indent(renderPlanPathLine(entry.planPath), treeBranchIndent(BODY_START)),
  });
  const boxLines = renderPlanBoxLines({
    planText: entry.planText,
    width,
    indent: BODY_START,
  });
  for (const line of boxLines) {
    out.push({ text: line });
  }
  out.push(...timelineBlockGaps());
  return out;
}

function renderPlanToolEntry(
  turn: ChatTurn,
  entry: ToolCallTimelineEntry,
  width: number,
): RenderLine[] {
  const boxCollapsed = turn.expandedToolGroups.has(`plan:${entry.id}`);
  const out: RenderLine[] = [...timelineBlockGaps()];

  out.push({
    text: indent(renderToolCallStatusLine(entry), BODY_START),
    meta: { turnId: turn.id, kind: "plan-tool-toggle", toolId: entry.id },
  });
  out.push({
    text: indent(renderPlanPreviewHint(), treeBranchIndent(BODY_START)),
  });

  if (!boxCollapsed && entry.output?.trim()) {
    const boxLines = renderPlanBoxLines({
      planText: entry.output,
      width,
      indent: BODY_START,
    });
    for (const line of boxLines) {
      out.push({ text: line });
    }
  }

  out.push(...timelineBlockGaps());
  return out;
}

function renderWriteToolEntry(
  turn: ChatTurn,
  entry: ToolCallTimelineEntry,
  width: number,
  thoughtSeconds?: number,
): RenderLine[] {
  const fullExpanded = turn.expandedToolGroups.has(`write:${entry.id}`);
  const contentIndent = fileToolContentIndent(entry, BODY_START);
  const out: RenderLine[] = [...timelineBlockGaps()];
  pushThoughtPreamble(out, thoughtSeconds);
  const lines = renderWriteToolLines(entry, width, contentIndent, fullExpanded);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const text = i === 0 ? indent(line, BODY_START) : line;
    out.push({
      text,
      meta:
        i === 0 && entry.status === "success" && shouldShowFileBodyInChat(entry.detail)
          ? { turnId: turn.id, kind: "write-tool-toggle", toolId: entry.id }
          : i === 0 && entry.status === "error" && entry.errorDetail
            ? { turnId: turn.id, kind: "tool-error-toggle", toolId: entry.id }
            : undefined,
    });
  }
  if (entry.status === "error") {
    for (const line of renderToolCallErrorLines(entry, width, BODY_START)) {
      out.push({ text: indent(line, BODY_START) });
    }
  }
  out.push(...timelineBlockGaps());
  return out;
}

function renderEditToolEntry(
  turn: ChatTurn,
  entry: ToolCallTimelineEntry,
  width: number,
  thoughtSeconds?: number,
): RenderLine[] {
  const fullExpanded = turn.expandedToolGroups.has(`edit:${entry.id}`);
  const contentIndent = fileToolContentIndent(entry, BODY_START);
  const out: RenderLine[] = [...timelineBlockGaps()];
  pushThoughtPreamble(out, thoughtSeconds);
  const lines = renderEditToolLines(entry, width, contentIndent, fullExpanded);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const text = i === 0 ? indent(line, BODY_START) : line;
    out.push({
      text,
      meta:
        i === 0 && entry.status === "success" && shouldShowFileBodyInChat(entry.detail)
          ? { turnId: turn.id, kind: "edit-tool-toggle", toolId: entry.id }
          : i === 0 && entry.status === "error" && entry.errorDetail
            ? { turnId: turn.id, kind: "tool-error-toggle", toolId: entry.id }
            : undefined,
    });
  }
  if (entry.status === "error") {
    for (const line of renderToolCallErrorLines(entry, width, BODY_START)) {
      out.push({ text: indent(line, BODY_START) });
    }
  }
  out.push(...timelineBlockGaps());
  return out;
}

function renderAgentToolEntry(
  turn: ChatTurn,
  entry: ToolCallTimelineEntry,
  thoughtSeconds?: number,
): RenderLine[] {
  const out: RenderLine[] = [...timelineBlockGaps()];
  pushThoughtPreamble(out, thoughtSeconds);
  const lines = renderAgentToolLines(entry);
  // Never dump Explore/Agent result body into the chat timeline — only tool tree / Done.
  const collapsedDone = entry.status === "success" && entry.agentExpanded !== true;
  for (let i = 0; i < lines.length; i++) {
    const isHeader = i === 0;
    const isDoneSummary = collapsedDone && i === 1;
    out.push({
      text: indent(lines[i]!, isHeader ? BODY_START : treeBranchIndent(BODY_START)),
      meta:
        isHeader || isDoneSummary
          ? { turnId: turn.id, kind: "agent-tool-toggle", toolId: entry.id }
          : undefined,
    });
  }
  out.push(...timelineBlockGaps());
  return out;
}

function renderSkillToolEntry(
  turn: ChatTurn,
  entry: ToolCallTimelineEntry,
  thoughtSeconds?: number,
): RenderLine[] {
  const out: RenderLine[] = [...timelineBlockGaps()];
  pushThoughtPreamble(out, thoughtSeconds);
  const lines = renderSkillToolLines(entry);
  for (let i = 0; i < lines.length; i++) {
    out.push({
      text: indent(lines[i]!, i === 0 ? BODY_START : treeBranchIndent(BODY_START)),
      meta:
        i === 0
          ? { turnId: turn.id, kind: "skill-tool-toggle", toolId: entry.id }
          : undefined,
    });
  }
  out.push(...timelineBlockGaps());
  return out;
}

function isMcpTool(entry: Pick<ToolCallTimelineEntry, "name">): boolean {
  return entry.name.startsWith("mcp/");
}

function isTaskTool(entry: Pick<ToolCallTimelineEntry, "name">): boolean {
  return entry.name === "TaskCreate" || entry.name === "TaskUpdate";
}

function turnHasTaskList(turn: ChatTurn): boolean {
  return turn.timeline.some((e) => e.type === "task-list");
}

function isCompactActivityTool(entry: ToolCallTimelineEntry): boolean {
  return (
    (entry.status === "success" || entry.status === "waiting") &&
    !isMcpTool(entry) &&
    !isPlanFileTool(entry) &&
    !isFileWriteTool(entry) &&
    !isFileEditTool(entry) &&
    !isWorkflowTool(entry) &&
    !isSkillTool(entry) &&
    !isAgentTool(entry) &&
    !isTaskTool(entry)
  );
}

function isStandaloneTool(entry: ToolCallTimelineEntry): boolean {
  return entry.status === "waiting" || entry.status === "error" || !isCompactActivityTool(entry);
}

function nextSignificantTimelineIndex(timeline: TurnTimelineEntry[], start: number): number {
  for (let j = start; j < timeline.length; j++) {
    const entry = timeline[j]!;
    if (entry.type === "thinking" && entry.text.trim()) return j;
    if (entry.type === "tool") return j;
    if (entry.type === "answer" && entry.text.trim()) return j;
    if (entry.type === "choice" || entry.type === "choice-group" || entry.type === "plan-preview") {
      return j;
    }
    if (entry.type === "event") return j;
  }
  return -1;
}

/** Short narration before more tools in the same burst — hidden and splits activity batches. */
function isTransitionalAnswer(timeline: TurnTimelineEntry[], index: number): boolean {
  const entry = timeline[index];
  if (entry?.type !== "answer" || !entry.text.trim()) return false;

  const nextIdx = nextSignificantTimelineIndex(timeline, index + 1);
  if (nextIdx < 0) return false;

  const next = timeline[nextIdx]!;
  if (next.type === "thinking") return false;
  // Compact-capable tools stay transitional even while waiting (waiting is otherwise "standalone").
  if (next.type === "tool" && isCompactActivityTool(next)) return true;
  if (next.type === "tool" && isStandaloneTool(next)) return false;
  if (next.type === "choice" || next.type === "choice-group") return false;
  if (next.type === "event") return false;
  if (next.type === "answer") return isTransitionalAnswer(timeline, nextIdx);
  return false;
}

/** Same assistant text later in the turn — keep the later *visible* copy only. */
function isDuplicateEarlierAnswer(timeline: TurnTimelineEntry[], index: number): boolean {
  const entry = timeline[index];
  if (entry?.type !== "answer") return false;
  const text = entry.text.trim();
  if (!text) return false;
  for (let j = index + 1; j < timeline.length; j++) {
    const later = timeline[j]!;
    if (later.type !== "answer" || later.text.trim() !== text) continue;
    // Only suppress this copy when a later one will actually paint.
    if (!isTransitionalAnswer(timeline, j)) return true;
  }
  return false;
}

/** Max compact tools folded into one collapsed activity summary line. */
const MAX_ACTIVITY_TOOLS_PER_BATCH = 4;

function isPrimaryBreaker(
  entry: TurnTimelineEntry,
  timeline: TurnTimelineEntry[],
  index: number,
): boolean {
  if (entry.type === "choice" || entry.type === "choice-group" || entry.type === "plan-preview") {
    return true;
  }
  if (entry.type === "tool" && isStandaloneTool(entry)) {
    return true;
  }
  if (entry.type === "answer" && entry.text.trim()) {
    return !isTransitionalAnswer(timeline, index);
  }
  return false;
}

/** Foldable only when adjacent in the timeline — thinking and compact tools. */
function isSystemEntry(entry: TurnTimelineEntry): boolean {
  if (entry.type === "thinking" && entry.text.trim()) return true;
  if (entry.type === "tool" && isCompactActivityTool(entry)) return true;
  return false;
}

function canStartActivityBatch(entry: TurnTimelineEntry): boolean {
  return isSystemEntry(entry);
}

/** Collect thinking + compact tools; events merge only after thinking in the same batch. */
function collectActivityBatch(
  timeline: TurnTimelineEntry[],
  start: number,
): { items: ActivityBatchItem[]; end: number } {
  const items: ActivityBatchItem[] = [];
  let hasThinkingInBatch = false;
  let toolCount = 0;
  let i = start;

  while (i < timeline.length) {
    const entry = timeline[i]!;

    if (entry.type === "thinking" && entry.text.trim()) {
      hasThinkingInBatch = true;
      items.push({ type: "thinking", entry, index: i });
      i++;
      continue;
    }

    if (entry.type === "tool" && isCompactActivityTool(entry)) {
      if (toolCount >= MAX_ACTIVITY_TOOLS_PER_BATCH) break;
      items.push({ type: "tool", entry });
      toolCount++;
      i++;
      continue;
    }

    if (entry.type === "event" && hasThinkingInBatch) {
      items.push({ type: "event", lines: entry.lines });
      i++;
      continue;
    }

    break;
  }

  return { items, end: i };
}

function renderActivityBatchItems(
  turn: ChatTurn,
  batchItems: ActivityBatchItem[],
  batchStart: number,
  width: number,
  now: number,
  isActive: boolean,
): RenderLine[] {
  const tools = batchItems
    .filter((item): item is Extract<ActivityBatchItem, { type: "tool" }> => item.type === "tool")
    .map((item) => item.entry);
  const groupId = activityGroupId(turn.id, batchStart);

  if (tools.length > 0) {
    return renderActivityGroup(turn, batchItems, batchStart, width, now, groupId, isActive);
  }

  const out: RenderLine[] = [];
  for (const item of batchItems) {
    if (item.type === "thinking") {
      out.push(...renderThinkingEntry(turn, item.entry, item.index, width, now, isActive));
    } else if (item.type === "event") {
      for (const text of item.lines) {
        out.push({ text: indent(text, LINE_INDENT) });
      }
    }
  }
  return out;
}

function sumThinkingSeconds(entries: ThinkingEntry[], now: number): number | undefined {
  const total = entries.reduce((sum, entry) => sum + thoughtEntrySeconds(entry, now), 0);
  return total > 0 ? total : undefined;
}

function renderStandaloneTool(
  turn: ChatTurn,
  entry: ToolCallTimelineEntry,
  width: number,
  isActive: boolean,
): RenderLine[] {
  // Agent/Explore must stay in the chat stream while waiting (header + nested tools).
  // Other waiting tools (including approval gates) stay off the timeline — live
  // status is shown on the * Whirring… footer line only.
  if (isAgentTool(entry)) return renderAgentToolEntry(turn, entry);
  if (isActive && entry.status === "waiting") {
    return [];
  }
  // Claude-style checklist supersedes generic TaskCreate/Update tool rows.
  if (isTaskTool(entry) && turnHasTaskList(turn) && entry.status === "success") {
    return [];
  }
  if (entry.status === "waiting" || entry.status === "error") {
    return renderToolEntry(turn, entry, width);
  }
  if (isWorkflowTool(entry)) return renderWorkflowToolEntry(turn, entry);
  if (isPlanFileTool(entry)) return renderPlanToolEntry(turn, entry, width);
  if (isFileWriteTool(entry)) return renderWriteToolEntry(turn, entry, width);
  if (isFileEditTool(entry)) return renderEditToolEntry(turn, entry, width);
  if (isSkillTool(entry)) return renderSkillToolEntry(turn, entry);
  return renderToolEntry(turn, entry, width);
}

function renderTimelineToLines(
  turn: ChatTurn,
  width: number,
  now: number,
  isActive: boolean,
): RenderLine[] {
  const streamingAnswerIdx =
    isActive && turn.phase !== "done" ? lastAnswerTimelineIndex(turn.timeline) : -1;
  const out: RenderLine[] = turn.userText.trim()
    ? renderUserMessage(turn.userText, width, {
        trailingGap: !turn.harnessOnly,
      }).map((text) => ({ text }))
    : [];

  const timeline = turn.timeline;
  let i = 0;
  while (i < timeline.length) {
    const entry = timeline[i]!;

    if (canStartActivityBatch(entry)) {
      const batchStart = i;
      const { items: batchItems, end } = collectActivityBatch(timeline, i);
      i = end;
      out.push(...renderActivityBatchItems(turn, batchItems, batchStart, width, now, isActive));
      continue;
    }

    if (entry.type === "thinking") {
      out.push(...renderThinkingEntry(turn, entry, i, width, now, isActive));
      i++;
      continue;
    }
    if (entry.type === "answer") {
      if (isTransitionalAnswer(timeline, i) || isDuplicateEarlierAnswer(timeline, i)) {
        i++;
        continue;
      }
      for (const text of renderAnswerTextLines(entry.text, width, {
        pulseFrame: turn.pulseFrame,
        pulseLive: isActive && turn.phase !== "done" && i === streamingAnswerIdx,
      })) {
        out.push({ text });
      }
      out.push(...timelineBlockGaps());
      i++;
      continue;
    }
    if (entry.type === "choice-group") {
      out.push(...renderChoiceGroupEntry(entry));
      i++;
      continue;
    }
    if (entry.type === "choice") {
      out.push(...renderChoiceEntry(turn, entry));
      i++;
      continue;
    }
    if (entry.type === "event") {
      for (const text of entry.lines) {
        out.push({ text: indent(text, LINE_INDENT) });
      }
      i++;
      continue;
    }
    if (entry.type === "plan-preview") {
      out.push(...renderPlanPreviewEntry(entry, width));
      i++;
      continue;
    }
    if (entry.type === "task-list") {
      out.push(...timelineBlockGaps());
      for (const line of renderTaskListBlockLines(entry.items)) {
        out.push({ text: indent(line, BODY_START) });
      }
      out.push(...timelineBlockGaps());
      i++;
      continue;
    }
    if (entry.type === "tool" && isPrimaryBreaker(entry, timeline, i)) {
      out.push(...renderStandaloneTool(turn, entry, width, isActive));
      i++;
      continue;
    }

    i++;
  }

  const last = timeline[timeline.length - 1];
  const answerFallback = turn.answerText.trim();
  if (
    last?.type !== "answer" &&
    answerFallback &&
    // Timeline already carries this text (possibly transitional/hidden) — do not paint twice.
    !timeline.some((e) => e.type === "answer" && e.text.trim() === answerFallback)
  ) {
    for (const text of renderAnswerLines(turn, width, {
      pulseLive: isActive && turn.phase !== "done",
    })) {
      out.push({ text });
    }
    out.push(...timelineBlockGaps());
  }

  if (turn.phase === "done" && turn.finishedAt && !turn.harnessOnly) {
    // One blank line between the answer/body and * Cooked / * recap.
    if (out.length === 0 || !isBlankRenderLine(out[out.length - 1]!)) {
      out.push({ text: gap() });
    }
    out.push({ text: renderDoneStatus(turn, now) });
    if (turn.recapText) {
      // Never stack * Cooked and * recap — one blank between status lines.
      out.push({ text: gap() });
      out.push({ text: renderRecapLine(turn.recapText) });
    }
    out.push({ text: gap() });
  }

  return ensureMainMessageGaps(out);
}

function renderActivityGroup(
  turn: ChatTurn,
  items: ActivityBatchItem[],
  timelineStartIndex: number,
  width: number,
  now: number,
  groupIdOverride?: string,
  isActive = false,
): RenderLine[] {
  const groupId = groupIdOverride ?? toolGroupId(turn.id, timelineStartIndex);
  const expanded = turn.expandedToolGroups.has(groupId);
  const tools = items
    .filter((item): item is Extract<ActivityBatchItem, { type: "tool" }> => item.type === "tool")
    .map((item) => item.entry);
  const thinkingEntries = items
    .filter(
      (item): item is Extract<ActivityBatchItem, { type: "thinking" }> => item.type === "thinking",
    )
    .map((item) => item.entry);
  const thoughtSeconds = sumThinkingSeconds(thinkingEntries, now);
  const stats = collectActivityStats(tools);
  const out: RenderLine[] = [...timelineBlockGaps()];
  out.push({
    text: indent(renderActivitySummaryLine(thoughtSeconds, stats, expanded, tools), BODY_START),
    meta: { turnId: turn.id, kind: "tool-group-toggle", groupId },
  });
  if (expanded) {
    for (const text of renderActivityExpandedTree(items, width, now, isActive)) {
      out.push({ text });
    }
  }
  out.push(...timelineBlockGaps());
  return out;
}

function renderChoiceGroupEntry(entry: ChoiceGroupTimelineEntry): RenderLine[] {
  const out: RenderLine[] = [...timelineBlockGaps()];
  const lines = renderChoiceGroupLines(
    entry.items.map((item) => ({
      question: item.question,
      answer: item.answer,
      declined: item.declined,
    })),
  );
  for (let i = 0; i < lines.length; i++) {
    const lineIndent = i === 0 ? BODY_START : treeBranchIndent(BODY_START);
    out.push({ text: indent(lines[i]!, lineIndent) });
  }
  out.push(...timelineBlockGaps());
  return out;
}

function renderChoiceEntry(turn: ChatTurn, entry: ChoiceTimelineEntry): RenderLine[] {
  const expanded = turn.expandedChoices.has(entry.id);
  const out: RenderLine[] = [...timelineBlockGaps()];
  out.push({
    text: indent(
      renderChoiceSummaryLine(
        {
          header: entry.header,
          question: entry.question,
          options: entry.options,
          multiSelect: entry.multiSelect,
          answer: entry.answer,
          declined: entry.declined,
        },
        expanded,
      ),
      BODY_START,
    ),
    meta: { turnId: turn.id, kind: "choice-toggle", choiceId: entry.id },
  });
  if (expanded) {
    for (let i = 0; i < entry.options.length; i++) {
      const opt = entry.options[i]!;
      out.push({
        text: indent(renderChoiceOptionLine(opt, i, entry.multiSelect), treeBranchIndent(BODY_START)),
      });
    }
  }
  out.push(...timelineBlockGaps());
  return out;
}

function renderToolGroup(
  turn: ChatTurn,
  entries: ToolCallTimelineEntry[],
  timelineStartIndex: number,
  width: number,
): RenderLine[] {
  return renderActivityGroup(
    turn,
    entries.map((entry) => ({ type: "tool" as const, entry })),
    timelineStartIndex,
    width,
    Date.now(),
  );
}

export function renderTurnToLines(
  turn: ChatTurn,
  width: number,
  nowOrOpts: number | RenderTurnOptions = Date.now(),
  maybeOpts?: RenderTurnOptions,
): RenderLine[] {
  // Stepped-away recap wake: never paint thinking/answer into chat.
  if (turn.silentChat) return [];
  const now = typeof nowOrOpts === "number" ? nowOrOpts : (nowOrOpts.now ?? Date.now());
  const opts = typeof nowOrOpts === "number" ? maybeOpts : nowOrOpts;
  const isActive = opts?.isActive ?? turn.phase !== "done";
  return renderTimelineToLines(turn, width, now, isActive);
}

export function renderGeneratingStatus(
  _turn: ChatTurn,
  _now = Date.now(),
): string {
  return `${ansi.muted}esc to interrupt · /help${ansi.reset}`;
}

export function renderTipLine(tip: string): string {
  const body = tip.startsWith("Tip: ") ? tip.slice(5) : tip;
  return indent(`${ansi.muted}└ Tip: ${body}${ansi.reset}`, treeBranchIndent(LINE_INDENT));
}

export function estimateTokens(turn: ChatTurn): number {
  let chars = 0;
  for (const entry of turn.timeline) {
    if (entry.type === "thinking") chars += entry.text.length;
    if (entry.type === "answer") chars += entry.text.length;
  }
  chars += turn.answerText.length;
  return Math.max(1, Math.ceil(chars / 4));
}

export function isThoughtSummaryLine(line: RenderLine): boolean {
  const kind = line.meta?.kind;
  return (
    kind === "thought-summary" ||
    kind === "thought-toggle" ||
    kind === "thought-body"
  );
}

export function toggleThoughtExpanded(turn: ChatTurn, thoughtIndex: number): void {
  if (turn.expandedThoughts.has(thoughtIndex)) {
    turn.expandedThoughts.delete(thoughtIndex);
  } else {
    turn.expandedThoughts.add(thoughtIndex);
  }
}

export function toggleToolGroupExpanded(turn: ChatTurn, groupId: string): void {
  if (turn.expandedToolGroups.has(groupId)) {
    turn.expandedToolGroups.delete(groupId);
  } else {
    turn.expandedToolGroups.add(groupId);
  }
}

export function toggleChoiceExpanded(turn: ChatTurn, choiceId: string): void {
  if (turn.expandedChoices.has(choiceId)) {
    turn.expandedChoices.delete(choiceId);
  } else {
    turn.expandedChoices.add(choiceId);
  }
}

export function visibleLineLength(line: RenderLine): number {
  return visibleLength(line.text);
}
