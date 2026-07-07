import type { AskUserQuestionOption } from "@kako/shared";
import { ansi, visibleLength } from "./ansi.js";
import {
  renderChoiceGroupLines,
  renderChoiceOptionLine,
  renderChoiceSummaryLine,
} from "./ask-user-question-display.js";
import { renderRichContentLines } from "./markdown-render.js";
import {
  collectActivityStats,
  isPlanFileTool,
  isPlanToolToggleLine,
  renderActivitySummaryLine,
  renderPlanPreviewHint,
  renderToolCallErrorLines,
  renderToolCallStatusLine,
  renderToolInvocationLine,
  renderToolOutputLines,
  type ToolCallTimelineEntry,
} from "./tool-call-display.js";
import { renderPlanBoxLines } from "./plan-box.js";
import { wrapContentLines } from "./text-wrap.js";
import { renderPulsingPrefix } from "./stream-pulse.js";
import { extractImageLabelsInOrder } from "./image-markers.js";

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
  | ToolCallTimelineEntry
  | ChoiceTimelineEntry
  | ChoiceGroupTimelineEntry;

export interface ChatTurn {
  id: string;
  userText: string;
  /** Current streaming answer segment (mirrors the open timeline answer entry). */
  answerText: string;
  thinkingExpanded: boolean;
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
  /** Expanded adjacent tool-call groups (groupId → visible). */
  expandedToolGroups: Set<string>;
  /** Expanded AskUserQuestion choice blocks (choiceId → visible). */
  expandedChoices: Set<string>;
  /** Animation frame for streaming icon pulse (0–3). */
  pulseFrame: number;
}

export interface RenderLine {
  text: string;
  meta?: {
    turnId: string;
    kind: "thought-summary" | "thought-toggle" | "thought-body" | "tool-error-toggle" | "tool-group-toggle" | "choice-toggle";
    toolId?: string;
    groupId?: string;
    choiceId?: string;
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
  const prefix = renderPulsingPrefix("◐", pulseFrame, live);
  return indent(`${prefix}${ansi.muted}Thought for ${secs}s${ansi.reset}`, LINE_INDENT);
}

function turnElapsedSeconds(turn: ChatTurn, now = Date.now()): number {
  const end = turn.finishedAt ?? now;
  return Math.max(0, Math.floor((end - turn.thinkingStartedAt) / 1000));
}

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
  const verb = turn.generatingVerb ?? "Working";
  const live = turn.phase !== "done";
  const star = renderPulsingPrefix("*", turn.pulseFrame, live);
  return indent(
    `${star}${ansi.accent}${verb}… (${elapsed}s · ↓ ${tokens} tokens · ${phase})${ansi.reset}`,
    LINE_INDENT,
  );
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
  const verb = turn.doneVerb ?? "Worked";
  return indent(
    `${ansi.muted}* ${verb} for ${turnElapsedSeconds(turn, now)}s${ansi.reset}`,
    LINE_INDENT,
  );
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

function expandLineSpacing(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    out.push(line);
    if (line === "") continue;
    const next = lines[i + 1];
    if (next === undefined || next === "") continue;
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
    const bullet = renderPulsingPrefix("●", pulseFrame, pulseLive && isFirst);
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

export function renderUserMessage(userText: string): string[] {
  const imageLabels = extractImageLabelsInOrder(userText);
  const lines = [
    gap(),
    indent(
      `${ansi.muted}> ${ansi.reset}${ansi.text}${userText}${ansi.reset}`,
      LINE_INDENT,
    ),
  ];
  for (const label of imageLabels) {
    lines.push(
      indent(
        `${ansi.muted}└ ${ansi.reset}${ansi.text}${label}${ansi.reset}`,
        treeBranchIndent(LINE_INDENT),
      ),
    );
  }
  lines.push(gap());
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

  const expanded =
    turn.thinkingExpanded && index === lastThinkingIndex(turn.timeline);
  const isLive =
    isActive &&
    entry.endedAt === null &&
    turn.phase !== "done" &&
    index === lastThinkingIndex(turn.timeline);
  const out: RenderLine[] = [];

  if (expanded) {
    const body = renderThoughtBodyForEntry(entry, width);
    body.forEach((text, i) => {
      out.push({
        text,
        meta: {
          turnId: turn.id,
          kind: i === 0 ? "thought-toggle" : "thought-body",
        },
      });
    });
  } else {
    out.push({
      text: renderThoughtSummaryForEntry(entry, now, isLive, turn.pulseFrame),
      meta: { turnId: turn.id, kind: "thought-summary" },
    });
  }
  out.push({ text: gap() });
  return out;
}

function timelineBlockGaps(): RenderLine[] {
  const lines: RenderLine[] = [];
  for (let g = 0; g < ANSWER_LINE_GAP; g++) {
    lines.push({ text: gap() });
  }
  return lines;
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
      width: width - BODY_START,
      indent: BODY_START,
    });
    for (const line of boxLines) {
      out.push({ text: line });
    }
  }

  out.push(...timelineBlockGaps());
  return out;
}

function renderActivityGroup(
  turn: ChatTurn,
  entries: ToolCallTimelineEntry[],
  timelineStartIndex: number,
  width: number,
  thoughtSeconds?: number,
): RenderLine[] {
  const groupId = toolGroupId(turn.id, timelineStartIndex);
  const expanded = turn.expandedToolGroups.has(groupId);
  const stats = collectActivityStats(entries);
  const out: RenderLine[] = [...timelineBlockGaps()];
  out.push({
    text: indent(renderActivitySummaryLine(thoughtSeconds, stats, expanded), BODY_START),
    meta: { turnId: turn.id, kind: "tool-group-toggle", groupId },
  });
  if (expanded) {
    for (const entry of entries) {
      if (isPlanFileTool(entry)) continue;
      out.push({
        text: indent(renderToolInvocationLine(entry), treeBranchIndent(BODY_START, 0)),
      });
      for (const line of renderToolOutputLines(entry, width, treeBranchIndent(BODY_START, 0))) {
        out.push({ text: indent(line, treeBranchIndent(BODY_START)) });
      }
    }
  }
  out.push(...timelineBlockGaps());
  return out;
}

function renderToolRun(
  turn: ChatTurn,
  entries: ToolCallTimelineEntry[],
  timelineStartIndex: number,
  width: number,
  precedingThinking?: ThinkingEntry,
): RenderLine[] {
  const thoughtSeconds = precedingThinking
    ? thoughtEntrySeconds(precedingThinking)
    : undefined;

  const out: RenderLine[] = [];
  let k = 0;
  while (k < entries.length) {
    const entry = entries[k]!;
    if (entry.status === "waiting" || entry.status === "error") {
      out.push(...renderToolEntry(turn, entry, width));
      k++;
      continue;
    }

    if (isPlanFileTool(entry)) {
      out.push(...renderPlanToolEntry(turn, entry, width));
      k++;
      continue;
    }

    let m = k;
    while (m < entries.length) {
      const next = entries[m]!;
      if (next.status !== "success" || isPlanFileTool(next)) break;
      m++;
    }
    const activityBatch = entries.slice(k, m);
    if (activityBatch.length > 0) {
      out.push(
        ...renderActivityGroup(turn, activityBatch, timelineStartIndex + k, width, thoughtSeconds),
      );
      // Only attach thought duration to the first activity batch in a run.
      precedingThinking = undefined;
    }
    k = m;
  }
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
  return renderActivityGroup(turn, entries, timelineStartIndex, width);
}

export function renderTurnToLines(
  turn: ChatTurn,
  width: number,
  nowOrOpts: number | RenderTurnOptions = Date.now(),
  maybeOpts?: RenderTurnOptions,
): RenderLine[] {
  const now = typeof nowOrOpts === "number" ? nowOrOpts : (nowOrOpts.now ?? Date.now());
  const opts = typeof nowOrOpts === "number" ? maybeOpts : nowOrOpts;
  const isActive = opts?.isActive ?? false;
  const streamingAnswerIdx =
    isActive && turn.phase !== "done" ? lastAnswerTimelineIndex(turn.timeline) : -1;

  const out: RenderLine[] = renderUserMessage(turn.userText).map((text) => ({
    text,
  }));

  for (let i = 0; i < turn.timeline.length; ) {
    const entry = turn.timeline[i]!;
    if (entry.type === "thinking") {
      const next = turn.timeline[i + 1];
      if (next?.type === "tool") {
        i++;
        continue;
      }
      out.push(...renderThinkingEntry(turn, entry, i, width, now, isActive));
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
    if (entry.type === "tool") {
      let j = i;
      while (j < turn.timeline.length && turn.timeline[j]?.type === "tool") j++;
      const toolRun = turn.timeline.slice(i, j) as ToolCallTimelineEntry[];
      const prev = i > 0 ? turn.timeline[i - 1] : undefined;
      const precedingThinking =
        prev?.type === "thinking" ? (prev as ThinkingEntry) : undefined;
      out.push(...renderToolRun(turn, toolRun, i, width, precedingThinking));
      i = j;
      continue;
    }
    for (const text of renderAnswerTextLines(entry.text, width, {
      pulseFrame: turn.pulseFrame,
      pulseLive: isActive && i === streamingAnswerIdx,
    })) {
      out.push({ text });
    }
    i++;
  }

  const last = turn.timeline[turn.timeline.length - 1];
  if (last?.type !== "answer" && turn.answerText.trim()) {
    for (const text of renderAnswerLines(turn, width, {
      pulseLive: isActive && turn.phase !== "done",
    })) {
      out.push({ text });
    }
  }

  if (turn.phase === "done" && turn.finishedAt) {
    out.push({ text: gap() });
    out.push({ text: renderDoneStatus(turn, now) });
    out.push({ text: gap() });
  }

  return out;
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
