import type { BackgroundTask } from "@kako/core";
import type { SessionMeta } from "@kako/shared";
import { homedir } from "node:os";
import { ansi, displayWidth } from "./ansi.js";
import { formatDurationMs } from "./format-duration.js";
import { renderMultilineInput } from "./multiline-input.js";
import { formatAnswerDuration } from "./session-answer-duration.js";
import { agentsBucketEnteredAt } from "./agents-session-reads.js";
import { wrapContentLines } from "./text-wrap.js";
import { renderMiniHeader } from "./welcome.js";

export type AgentsBucket = "needs_input" | "working" | "completed";

/** Needs input / Completed unread until opened after entering the bucket. */
export function isAgentsSessionUnreadInBucket(
  meta: SessionMeta,
  bucket: AgentsBucket,
  visits: ReadonlyMap<string, number>,
): boolean {
  if (bucket === "working") return false;
  const openedAt = visits.get(meta.id);
  if (openedAt === undefined) return true;
  const enteredMs = Date.parse(agentsBucketEnteredAt(meta));
  if (Number.isNaN(enteredMs)) return true;
  return openedAt < enteredMs;
}

export interface AgentsSessionRow {
  kind: "session";
  sessionId: string;
  title: string;
  preview: string;
  cwd: string;
  updatedAt: string;
  /** Sum of model answer durations (ms), not session age. */
  answerDurationMs: number;
  bucket: AgentsBucket;
  /** completed + agentState failed → red icon; otherwise green for completed. */
  failed: boolean;
  /**
   * Needs input / Completed: true until chat is opened after entering that bucket
   * (glyph `·`). Working ignores this for its pulse icon.
   */
  unread: boolean;
  /** Preview is the session cwd (empty dialogue) — truncate from the front. */
  idleCwdPreview?: boolean;
}

export interface AgentsGroupRow {
  kind: "group";
  bucket: AgentsBucket;
  label: string;
  count: number;
  collapsed: boolean;
}

export interface AgentsBgRow {
  kind: "bg";
  taskId: string;
  label: string;
  detail: string;
}

export type AgentsListRow = AgentsSessionRow | AgentsGroupRow | AgentsBgRow;

export type AgentsDeleteArm =
  | null
  | { target: "session"; sessionId: string }
  | { target: "group"; bucket: AgentsBucket };

export interface AgentsPanelState {
  entryCwd: string;
  entrySessionId: string;
  modelLabel: string;
  agentName: string;
  version: string;
  rows: AgentsListRow[];
  selectedIndex: number;
  /** First visible visual list line (includes blank spacers between groups). */
  listScrollOffset: number;
  /** Frozen clock when Agents opened — relative times do not tick while open. */
  openedAt: number;
  /** Working-row icon animation frame (size pulse). */
  iconPulseFrame: number;
  composeBuffer: string;
  /** Cursor offset in composeBuffer (code units). */
  composeCursor: number;
  /** Scroll row for multiline compose (chat-parity). */
  composeScrollRow: number;
  /** True when bottom input owns keyboard (typing / arrow-to-edit). */
  composeFocus: boolean;
  deleteArm: AgentsDeleteArm;
  mode: "list" | "reply";
  replySessionId?: string;
  replyContext?: string;
  replyBuffer?: string;
  /** Cursor offset in replyBuffer (code units). */
  replyCursor: number;
  /** Scroll row for multiline reply input. */
  replyScrollRow: number;
  collapsed: Record<AgentsBucket, boolean>;
  bgTasks: BackgroundTask[];
  /** Sessions with in-flight agent/workflow background tasks → Working. */
  runningBgSessionIds: Set<string>;
  /**
   * Sessions with resumable interrupted BG checkpoints (process exit / crash).
   * Without a live handle these belong in Needs input, not Working.
   */
  interruptedSessionIds: Set<string>;
  /** sessionId → one-line preview */
  previews: Record<string, string>;
  /** sessionId → sum of model answer durations (ms). */
  answerDurations: Record<string, number>;
  /** sessionId → last chat open time (epoch ms). */
  sessionVisits: Map<string, number>;
}

const BUCKET_ORDER: AgentsBucket[] = ["needs_input", "working", "completed"];

const BUCKET_LABEL: Record<AgentsBucket, string> = {
  needs_input: "Needs input",
  working: "Working",
  completed: "Completed",
};

const DEFAULT_SESSION_TITLES = new Set(["New chat", "new chat", "new session", "New session"]);
const EMPTY_PREVIEW = "send a prompt to start";

/** Idle empty-session prompts — pick one stably per session id. */
const IDLE_PREVIEW_PROMPTS = [
  "send a prompt to start",
  "describe a task to begin",
  "type a message to start",
  "ask anything to begin",
  "write a first message",
] as const;

/** Fallback strip size when list mode compose is empty/unfocused. */
export const AGENTS_COMPOSE_ROWS = 4;

const COMPOSE_PLACEHOLDER = "describe a task for a new session";
const REPLY_PLACEHOLDER = "reply";
/** Max wrapped preview lines above `> reply` (Claude-style reply box). */
const REPLY_CONTEXT_MAX_LINES = 3;
/** Multiline input viewport in Agents compose (chat uses a larger budget). */
export const AGENTS_INPUT_MAX_VISIBLE_LINES = 6;

const BOX_H = "─";
const BOX_V = "│";
const BOX_TL = "┌";
const BOX_TR = "┐";
const BOX_BL = "└";
const BOX_BR = "┘";

const TIME_COL = 4;
const NAME_COL = 22;
const ICON_COL = 2; // "* "

export function classifySessionBucket(
  meta: SessionMeta,
  runningBgSessionIds?: ReadonlySet<string>,
  interruptedSessionIds?: ReadonlySet<string>,
): AgentsBucket {
  if (meta.status === "ended" && !interruptedSessionIds?.has(meta.id)) return "completed";
  const state = meta.agentState?.state;
  const liveBg = runningBgSessionIds?.has(meta.id) === true;
  // Waiting for AskUser / approval / present-report — Needs input even if BG still runs.
  if (state === "blocked") return "needs_input";
  // Live process owns work → Working (covers soft-resume while an old checkpoint remains).
  if (liveBg) return "working";
  // No live handle: interrupted checkpoints need Enter-to-resume (even if status ended).
  if (interruptedSessionIds?.has(meta.id)) return "needs_input";
  if (meta.status === "ended") return "completed";
  if (state === "working") return "working";
  if (state === "done" || state === "failed") return "completed";
  if (meta.status === "active") return "needs_input";
  return "completed";
}
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return `${Math.max(1, sec)}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (displayWidth(text) <= max) return text;
  const ellipsis = "…";
  const ellipsisW = displayWidth(ellipsis);
  const budget = Math.max(0, max - ellipsisW);
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = displayWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return `${out}${ellipsis}`;
}

/** Keep the end of a path; ellipsis at the front when too long. */
export function truncateStart(text: string, max: number): string {
  if (max <= 0) return "";
  if (displayWidth(text) <= max) return text;
  const ellipsis = "…";
  const ellipsisW = displayWidth(ellipsis);
  const budget = Math.max(0, max - ellipsisW);
  const chars = [...text];
  let out = "";
  let w = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i]!;
    const cw = displayWidth(ch);
    if (w + cw > budget) break;
    out = ch + out;
    w += cw;
  }
  return `${ellipsis}${out}`;
}

/** Home → `~`, then front-truncate so the tail of the path stays visible. */
export function formatAgentsCwdPreview(cwd: string, maxWidth = 60): string {
  const home = homedir();
  const display =
    home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  return truncateStart(display, maxWidth);
}

function hashSessionId(sessionId: string): number {
  let h = 2166136261;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function idlePreviewPrompt(sessionId: string): string {
  const idx = hashSessionId(sessionId) % IDLE_PREVIEW_PROMPTS.length;
  return IDLE_PREVIEW_PROMPTS[idx] ?? EMPTY_PREVIEW;
}

/**
 * Empty-session list preview: prompt + cwd (path front-truncated within budget).
 */
export function formatAgentsIdlePreview(
  sessionId: string,
  cwd: string,
  maxWidth = 60,
): string {
  const prompt = idlePreviewPrompt(sessionId);
  const sep = " · ";
  const fixed = displayWidth(prompt) + displayWidth(sep);
  if (fixed >= maxWidth) {
    return truncate(prompt, maxWidth);
  }
  const path = formatAgentsCwdPreview(cwd, maxWidth - fixed);
  return `${prompt}${sep}${path}`;
}

function isDefaultSessionTitle(value: string): boolean {
  return !value.trim() || DEFAULT_SESSION_TITLES.has(value.trim());
}

/**
 * Agents list title:
 * 1) entry session (came from) → "current session"
 * 2) still default / empty → "new session"
 * 3) otherwise → generated session title (fallback jobLabel)
 */
export function agentsSessionTitle(meta: SessionMeta, entrySessionId?: string): string {
  if (entrySessionId && meta.id === entrySessionId) return "current session";
  const title = (meta.title ?? "").trim();
  if (!isDefaultSessionTitle(title)) return title;
  const job = (meta.jobLabel ?? "").trim();
  if (job && !isDefaultSessionTitle(job)) return job;
  return "new session";
}

function normalizePreviewLine(raw: string | undefined, maxChars = 120): string {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return [...text].slice(0, maxChars).join("");
}

/**
 * One-line Agents preview from L1 summary.md.
 * Prefer Goal section body; for legacy digests that start with a Session Summary
 * title and role-labeled dialogue lines, take the first substantive dialogue line
 * — never the document title alone.
 */

/**
 * Protocol wakes are not user/model dialogue. Same markers as core
 * `isProtocolWakeText` (SYSTEM NOTIFICATION / stepped-away / task-notification).
 */
function isProtocolWakeText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    t.includes("[SYSTEM NOTIFICATION") ||
    t.includes("<stepped-away-recap") ||
    t.includes("<task-notification")
  );
}

export function summaryPreviewLine(summaryMarkdown: string | undefined): string {
  if (!summaryMarkdown?.trim()) return "";
  const withoutFm = summaryMarkdown.replace(/^---[\s\S]*?---\s*/m, "");

  const goal = withoutFm.match(/##\s*Goal\s*\n+([\s\S]*?)(?=\n##\s|\s*$)/i);
  if (goal?.[1]) {
    for (const line of goal[1].split("\n")) {
      const t = line.replace(/^[-*#>\s]+/, "").trim();
      if (!t || /^\(none\)$/i.test(t)) continue;
      if (isProtocolWakeText(t)) continue;
      return normalizePreviewLine(t, 60);
    }
  }

  for (const line of withoutFm.split("\n")) {
    const role = line.match(/^\*\*(user|assistant)\*\*\s*:\s*(.+)$/i);
    if (role?.[2]?.trim()) {
      if (isProtocolWakeText(role[2])) continue;
      return normalizePreviewLine(role[2], 60);
    }
  }

  for (const line of withoutFm.split("\n")) {
    const raw = line.trim();
    if (!raw || /^#+\s/.test(raw)) continue;
    const t = raw.replace(/^[-*>\s]+/, "").trim();
    if (!t || /^\(none\)$/i.test(t)) continue;
    if (/^session summary$/i.test(t)) continue;
    if (/^session:\s*/i.test(t)) continue;
    if (/^messages:\s*\d+/i.test(t)) continue;
    if (/^\*\*tool\*\*/i.test(raw)) continue;
    if (isProtocolWakeText(t)) continue;
    return normalizePreviewLine(t, 60);
  }
  return "";
}

/**
 * Agents list preview. Never uses agentState.detail (classifier status like
 * "turn finished" / "running turn") — that DetailLog is for runtime UI only.
 * Caller should pass loaded content: summary line or last substantive transcript.
 * `undefined` means not loaded yet — do not claim the session is empty.
 * Confirmed empty dialogue → idle prompt + working directory.
 */
export function agentsSessionPreview(
  meta: SessionMeta,
  contentPreview?: string | null,
): string {
  if (contentPreview === undefined || contentPreview === null) {
    return "…";
  }
  const text = normalizePreviewLine(contentPreview, 120);
  if (text) return text;
  return formatAgentsIdlePreview(meta.id, meta.cwd, 80);
}

/** One-line Agents cue for resumable interrupted background work. */
export function interruptedPreviewCue(
  items: Array<{ kind: string; name?: string; description?: string }>,
): string | undefined {
  if (items.length === 0) return undefined;
  const first = items[0]!;
  if (first.kind === "workflow") {
    return `interrupted · ${first.name?.trim() || "workflow"}`;
  }
  if (first.kind === "agent") {
    return `interrupted · agent: ${first.description?.trim() || "background"}`;
  }
  return `interrupted · ${items.length} task${items.length === 1 ? "" : "s"}`;
}

/**
 * Last substantive user/assistant line from a transcript (for Agents list).
 * Skips harness injections and protocol wakes; prefers visible content,
 * then non-notification llmText.
 */
export function lastSubstantiveTranscriptPreview(
  transcript: Array<{
    role: string;
    content?: string;
    attachments?: unknown[];
    metadata?: Record<string, unknown>;
  }>,
): string {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const msg = transcript[i];
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
    if (msg.metadata?.harnessInjected === true) continue;

    const content = (msg.content ?? "").replace(/\s+/g, " ").trim();
    if (content) {
      if (isProtocolWakeText(content)) continue;
      return [...content].slice(0, 60).join("");
    }

    if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
      return `[${msg.attachments.length} attachment(s)]`;
    }

    const llmText =
      typeof msg.metadata?.llmText === "string"
        ? msg.metadata.llmText.replace(/\s+/g, " ").trim()
        : "";
    if (!llmText || isProtocolWakeText(llmText)) continue;
    return [...llmText].slice(0, 60).join("");
  }
  return "";
}

/** Resolve list preview: last transcript line → summary Goal → idle prompt + cwd. */
export function resolveAgentsListPreview(options: {
  summaryMarkdown?: string;
  transcriptPreview?: string;
  cwd?: string;
  sessionId?: string;
}): string {
  const fromTx = normalizePreviewLine(options.transcriptPreview, 60);
  if (fromTx) return fromTx;
  const fromSummary = summaryPreviewLine(options.summaryMarkdown);
  if (fromSummary) return fromSummary;
  if (options.cwd && options.sessionId) {
    return formatAgentsIdlePreview(options.sessionId, options.cwd, 80);
  }
  if (options.cwd) return formatAgentsCwdPreview(options.cwd, 60);
  return EMPTY_PREVIEW;
}

export function buildAgentsRows(
  metas: SessionMeta[],
  previews: Record<string, string>,
  collapsed: Record<AgentsBucket, boolean>,
  bgTasks: BackgroundTask[],
  entrySessionId?: string,
  sessionVisits?: ReadonlyMap<string, number>,
  answerDurations?: Record<string, number>,
  runningBgSessionIds?: ReadonlySet<string>,
  interruptedSessionIds?: ReadonlySet<string>,
): AgentsListRow[] {
  const byBucket: Record<AgentsBucket, AgentsSessionRow[]> = {
    needs_input: [],
    working: [],
    completed: [],
  };
  const visits = sessionVisits ?? new Map<string, number>();
  const durations = answerDurations ?? {};
  const bgRunning = runningBgSessionIds ?? new Set<string>();
  const interrupted = interruptedSessionIds ?? new Set<string>();

  for (const meta of metas) {
    if (meta.parentSessionId) continue;
    const bucket = classifySessionBucket(meta, bgRunning, interrupted);
    const loaded = previews[meta.id];
    byBucket[bucket].push({
      kind: "session",
      sessionId: meta.id,
      title: agentsSessionTitle(meta, entrySessionId),
      preview: agentsSessionPreview(meta, loaded),
      cwd: meta.cwd,
      updatedAt: meta.updatedAt,
      answerDurationMs: durations[meta.id] ?? 0,
      bucket,
      failed: meta.agentState?.state === "failed",
      unread: isAgentsSessionUnreadInBucket(meta, bucket, visits),
      idleCwdPreview: loaded === "",
    });
  }

  const rows: AgentsListRow[] = [];
  for (const bucket of BUCKET_ORDER) {
    const sessions = byBucket[bucket];
    if (sessions.length === 0) continue;
    const isCollapsed = collapsed[bucket] === true;
    rows.push({
      kind: "group",
      bucket,
      label: BUCKET_LABEL[bucket],
      count: sessions.length,
      collapsed: isCollapsed,
    });
    if (!isCollapsed) {
      rows.push(...sessions);
    }
  }

  if (bgTasks.length > 0) {
    for (const task of bgTasks) {
      rows.push({
        kind: "bg",
        taskId: task.id,
        label: task.description?.trim() || task.subagentName?.trim() || task.id,
        detail: task.stopped ? "stopped" : "running",
      });
    }
  }

  return rows;
}

export function createAgentsPanelState(input: {
  entryCwd: string;
  entrySessionId: string;
  modelLabel: string;
  agentName?: string;
  version: string;
  metas: SessionMeta[];
  previews?: Record<string, string>;
  bgTasks?: BackgroundTask[];
  runningBgSessionIds?: Iterable<string>;
  interruptedSessionIds?: Iterable<string>;
  openedAt?: number;
  /** Prefer restoring this session row (e.g. returning from chat). */
  preferredSessionId?: string;
  listScrollOffset?: number;
  collapsed?: Record<AgentsBucket, boolean>;
  sessionVisits?: ReadonlyMap<string, number>;
  answerDurations?: Record<string, number>;
}): AgentsPanelState {
  const collapsed = input.collapsed ?? {
    needs_input: false,
    working: false,
    completed: false,
  };
  const previews = input.previews ?? {};
  const answerDurations = input.answerDurations ?? {};
  const bgTasks = input.bgTasks ?? [];
  const runningBgSessionIds = new Set(input.runningBgSessionIds ?? []);
  const interruptedSessionIds = new Set(input.interruptedSessionIds ?? []);
  const openedAt = input.openedAt ?? Date.now();
  const sessionVisits = new Map(input.sessionVisits ?? []);
  const rows = buildAgentsRows(
    input.metas,
    previews,
    collapsed,
    bgTasks,
    input.entrySessionId,
    sessionVisits,
    answerDurations,
    runningBgSessionIds,
    interruptedSessionIds,
  );
  const preferredIdx =
    input.preferredSessionId !== undefined
      ? rows.findIndex(
          (r) => r.kind === "session" && r.sessionId === input.preferredSessionId,
        )
      : -1;
  const entryIdx = rows.findIndex(
    (r) => r.kind === "session" && r.sessionId === input.entrySessionId,
  );
  const selectedIndex =
    preferredIdx >= 0 ? preferredIdx : entryIdx >= 0 ? entryIdx : 0;
  return {
    entryCwd: input.entryCwd,
    entrySessionId: input.entrySessionId,
    modelLabel: input.modelLabel,
    agentName: input.agentName ?? "main",
    version: input.version,
    rows,
    selectedIndex,
    listScrollOffset: Math.max(0, input.listScrollOffset ?? 0),
    openedAt,
    iconPulseFrame: 0,
    composeBuffer: "",
    composeCursor: 0,
    composeScrollRow: 0,
    composeFocus: false,
    deleteArm: null,
    mode: "list",
    replyCursor: 0,
    replyScrollRow: 0,
    collapsed,
    bgTasks,
    runningBgSessionIds,
    interruptedSessionIds,
    previews,
    answerDurations,
    sessionVisits,
  };
}

export function refreshAgentsPanelRows(
  state: AgentsPanelState,
  metas: SessionMeta[],
): AgentsPanelState {
  const prev = state.rows[state.selectedIndex];
  const rows = buildAgentsRows(
    metas,
    state.previews,
    state.collapsed,
    state.bgTasks,
    state.entrySessionId,
    state.sessionVisits,
    state.answerDurations,
    state.runningBgSessionIds,
    state.interruptedSessionIds,
  );
  let selectedIndex = Math.min(state.selectedIndex, Math.max(0, rows.length - 1));
  if (prev?.kind === "session") {
    const idx = rows.findIndex((r) => r.kind === "session" && r.sessionId === prev.sessionId);
    if (idx >= 0) selectedIndex = idx;
  } else if (prev?.kind === "group") {
    const idx = rows.findIndex((r) => r.kind === "group" && r.bucket === prev.bucket);
    if (idx >= 0) selectedIndex = idx;
  } else if (prev?.kind === "bg") {
    const idx = rows.findIndex((r) => r.kind === "bg" && r.taskId === prev.taskId);
    if (idx >= 0) selectedIndex = idx;
  }
  return { ...state, rows, selectedIndex };
}

export function agentsFooter(state: AgentsPanelState, exitHint = false): string {
  if (exitHint) {
    return `${ansi.muted}Press Ctrl+C again to exit${ansi.reset}`;
  }
  if (state.deleteArm) {
    return `${ansi.muted}ctrl+x to confirm${ansi.reset}`;
  }
  if (state.mode === "reply") {
    return `${ansi.muted}enter to send · space to close · ctrl+x to delete${ansi.reset}`;
  }
  const row = state.rows[state.selectedIndex];
  if (!row) {
    return `${ansi.muted}? for shortcuts${ansi.reset}`;
  }
  if (row.kind === "group") {
    const enter = row.collapsed ? "enter to expand" : "enter to collapse";
    return `${ansi.muted}${enter} · ctrl+x to delete all · ? for shortcuts${ansi.reset}`;
  }
  if (row.kind === "bg") {
    return `${ansi.muted}enter to open · ? for shortcuts${ansi.reset}`;
  }
  return `${ansi.muted}enter to open · space to reply · ctrl+x to delete · ? for shortcuts${ansi.reset}`;
}

function tallyFromMetas(
  metas: SessionMeta[],
  runningBgSessionIds?: ReadonlySet<string>,
  interruptedSessionIds?: ReadonlySet<string>,
): {
  awaiting: number;
  working: number;
  completed: number;
} {
  let awaiting = 0;
  let working = 0;
  let completed = 0;
  for (const meta of metas) {
    if (meta.parentSessionId) continue;
    const b = classifySessionBucket(meta, runningBgSessionIds, interruptedSessionIds);
    if (b === "needs_input") awaiting++;
    else if (b === "working") working++;
    else completed++;
  }
  return { awaiting, working, completed };
}

function padSelected(line: string, cols: number): string {
  // Clamp first so a too-wide row never wraps the terminal (kills rows below).
  const fitted = fitAnsiLine(line, cols);
  const plainLen = displayWidth(fitted);
  const pad = Math.max(0, cols - plainLen);
  const colored = fitted.replaceAll(ansi.reset, `${ansi.reset}${ansi.userMessageBg}`);
  return `${ansi.userMessageBg}${colored}${" ".repeat(pad)}${ansi.reset}`;
}

function padPlain(line: string, cols: number): string {
  const fitted = fitAnsiLine(line, cols);
  const pad = Math.max(0, cols - displayWidth(fitted));
  return pad > 0 ? `${fitted}${" ".repeat(pad)}` : fitted;
}

function padDisplay(text: string, width: number): string {
  const plain = truncate(text, width);
  const w = displayWidth(plain);
  if (w >= width) return plain;
  return `${plain}${" ".repeat(width - w)}`;
}

/** Truncate an ANSI-colored line to at most `cols` terminal columns (strip then rebuild). */
function fitAnsiLine(line: string, cols: number): string {
  if (cols <= 0) return "";
  if (displayWidth(line) <= cols) return line;
  // Drop ANSI and hard-truncate plain text — better than wrapping the TUI.
  return truncate(line.replace(/\x1b\[[0-9;]*m/g, ""), cols);
}

/** Fixed 1-col glyphs: small → large pulse across several star/dot shapes. */
const WORKING_PULSE_FRAMES = ["·", ".", "∙", "o", "*", "⋆", "*", "o"] as const;

export function workingSessionIcon(frame: number, unread = false): string {
  // Unread keeps a denser pulse; read uses the same shapes (color carries status).
  void unread;
  return WORKING_PULSE_FRAMES[frame % WORKING_PULSE_FRAMES.length]!;
}

/** Session list glyph: unread = "·", read = "*". Color follows bucket (completed failed → red). */
export function sessionListIcon(
  bucket: AgentsBucket,
  options?: { unread?: boolean; failed?: boolean; pulseFrame?: number },
): string {
  const unread = options?.unread === true;
  const glyph =
    bucket === "working"
      ? workingSessionIcon(options?.pulseFrame ?? 0, unread)
      : unread
        ? "·"
        : "*";
  if (bucket === "needs_input") return `${ansi.yellow}${glyph}${ansi.reset}`;
  if (bucket === "working") return `${ansi.muted}${glyph}${ansi.reset}`;
  if (options?.failed) return `${ansi.red}${glyph}${ansi.reset}`;
  return `${ansi.green}${glyph}${ansi.reset}`;
}

function formatAgentsTimeCol(ms: number): string {
  const raw = formatAnswerDuration(ms);
  if (!raw) return " ".repeat(TIME_COL);
  if (displayWidth(raw) > TIME_COL) return truncate(raw, TIME_COL);
  return raw.padStart(TIME_COL);
}

function renderSessionLine(
  row: AgentsSessionRow,
  selected: boolean,
  deleteArmed: boolean,
  cols: number,
  now: number,
  pulseFrame = 0,
): string {
  const time = formatAgentsTimeCol(row.answerDurationMs);
  const marker = sessionListIcon(row.bucket, {
    unread: row.unread,
    failed: row.failed,
    pulseFrame,
  });
  const nameWidth = Math.min(NAME_COL, Math.max(12, cols - ICON_COL - TIME_COL - 12));
  const previewBudget = Math.max(4, cols - ICON_COL - nameWidth - 1 - TIME_COL - 1);

  let nameText: string;
  let previewText: string;
  if (deleteArmed && selected) {
    nameText = truncate("ctrl+x again to delete", nameWidth);
    previewText = "";
  } else {
    nameText = truncate(row.title, nameWidth);
    previewText = row.idleCwdPreview
      ? formatAgentsIdlePreview(row.sessionId, row.cwd, previewBudget)
      : truncate(row.preview, previewBudget);
  }

  const nameColor =
    !(deleteArmed && selected) && row.title === "current session" ? ansi.blue : ansi.text;
  const nameCol = `${nameColor}${padDisplay(nameText, nameWidth)}${ansi.reset}`;
  const previewCol = previewText
    ? `${ansi.muted}${padDisplay(previewText, previewBudget)}${ansi.reset}`
    : padDisplay("", previewBudget);
  const line = `${marker} ${nameCol} ${previewCol} ${ansi.muted}${time}${ansi.reset}`;
  return selected ? padSelected(line, cols) : padPlain(line, cols);
}

function renderGroupLine(row: AgentsGroupRow, selected: boolean, cols: number): string {
  const text = row.collapsed
    ? `${ansi.text}${row.label}${ansi.reset} ${ansi.muted}${row.count}${ansi.reset}`
    : `${ansi.text}${ansi.bold}${row.label}${ansi.reset}`;
  return selected ? padSelected(text, cols) : padPlain(text, cols);
}

function renderBgLine(row: AgentsBgRow, selected: boolean, cols: number): string {
  const nameWidth = Math.min(NAME_COL, Math.max(12, cols - ICON_COL - TIME_COL - 12));
  const nameCol = `${ansi.text}${padDisplay(truncate(row.label, nameWidth), nameWidth)}${ansi.reset}`;
  const detailBudget = Math.max(4, cols - ICON_COL - nameWidth - 1 - TIME_COL - 1);
  const detailCol = `${ansi.muted}${padDisplay(truncate(row.detail, detailBudget), detailBudget)}${ansi.reset}`;
  const line = `${ansi.green}*${ansi.reset} ${nameCol} ${detailCol} ${ansi.muted}${" ".repeat(TIME_COL)}${ansi.reset}`;
  return selected ? padSelected(line, cols) : padPlain(line, cols);
}

interface VisualListLine {
  text: string;
  /** Index into `state.rows`, or null for spacers / section labels. */
  rowIndex: number | null;
}

function buildVisualList(
  state: AgentsPanelState,
  cols: number,
  now: number,
): VisualListLine[] {
  const out: VisualListLine[] = [];
  let firstGroup = true;
  let sawBg = false;

  for (let i = 0; i < state.rows.length; i++) {
    const row = state.rows[i]!;
    if (row.kind === "group") {
      if (!firstGroup) {
        out.push({ text: "", rowIndex: null });
      }
      firstGroup = false;
      const selected = i === state.selectedIndex && state.mode === "list";
      out.push({ text: renderGroupLine(row, selected, cols), rowIndex: i });
      continue;
    }

    if (row.kind === "bg") {
      if (!sawBg) {
        out.push({ text: "", rowIndex: null });
        out.push({
          text: padPlain(`${ansi.muted}Background agents${ansi.reset}`, cols),
          rowIndex: null,
        });
        sawBg = true;
      }
      const selected = i === state.selectedIndex && state.mode === "list";
      out.push({ text: renderBgLine(row, selected, cols), rowIndex: i });
      continue;
    }

    const selected = i === state.selectedIndex && state.mode === "list";
    const deleteArmed =
      state.deleteArm?.target === "session" && state.deleteArm.sessionId === row.sessionId;
    out.push({
      text: renderSessionLine(
        row,
        selected,
        Boolean(deleteArmed),
        cols,
        now,
        state.iconPulseFrame,
      ),
      rowIndex: i,
    });
  }

  return out;
}

/** Clamp list scroll to the valid range (does not pin selection into view). */
export function clampAgentsListScrollRange(
  scrollOffset: number,
  visualCount: number,
  viewportRows: number,
): number {
  const maxScroll = Math.max(0, visualCount - Math.max(1, viewportRows));
  return Math.max(0, Math.min(maxScroll, scrollOffset));
}

export function clampAgentsListScroll(
  scrollOffset: number,
  selectedVisualIndex: number,
  visualCount: number,
  viewportRows: number,
): number {
  let next = clampAgentsListScrollRange(scrollOffset, visualCount, viewportRows);
  if (selectedVisualIndex < 0) return next;
  if (selectedVisualIndex < next) next = selectedVisualIndex;
  if (selectedVisualIndex >= next + viewportRows) {
    next = selectedVisualIndex - viewportRows + 1;
  }
  return clampAgentsListScrollRange(next, visualCount, viewportRows);
}

function agentsPanelLayout(
  state: AgentsPanelState,
  cols: number,
  bodyRows: number,
  metasForTally: SessionMeta[],
  now = state.openedAt,
  slashLines: string[] = [],
): {
  headerRows: number;
  composeRows: number;
  middleRows: number;
  listScrollOffset: number;
  visual: VisualListLine[];
} {
  const header = renderHeaderLines(state, cols, metasForTally);
  const compose = renderComposeLines(state, cols, false, slashLines);
  const middleRows = Math.max(1, bodyRows - header.length - compose.length);
  const visual = buildVisualList(state, cols, now);
  const selectedVisual = visual.findIndex((v) => v.rowIndex === state.selectedIndex);
  const listScrollOffset = clampAgentsListScrollRange(
    state.listScrollOffset,
    visual.length,
    middleRows,
  );
  return {
    headerRows: header.length,
    composeRows: compose.length,
    middleRows,
    listScrollOffset,
    visual,
  };
}

/** Keep the selected navigable row visible; returns the next listScrollOffset. */
export function pinAgentsSelectionInView(
  state: AgentsPanelState,
  cols: number,
  bodyRows: number,
  metasForTally: SessionMeta[],
  now = state.openedAt,
): number {
  const layout = agentsPanelLayout(state, cols, bodyRows, metasForTally, now);
  const selectedVisual = layout.visual.findIndex((v) => v.rowIndex === state.selectedIndex);
  return clampAgentsListScroll(
    layout.listScrollOffset,
    selectedVisual,
    layout.visual.length,
    layout.middleRows,
  );
}

/** Map 1-based screen row to a navigable Agents list row index, or null. */
export function agentsPanelHitTest(
  state: AgentsPanelState,
  screenRow: number,
  cols: number,
  bodyRows: number,
  metasForTally: SessionMeta[],
  now = state.openedAt,
): number | null {
  const layout = agentsPanelLayout(state, cols, bodyRows, metasForTally, now);
  const middleStart = layout.headerRows + 1; // 1-based
  const middleEnd = middleStart + layout.middleRows - 1;
  if (screenRow < middleStart || screenRow > middleEnd) return null;
  const visualIndex = layout.listScrollOffset + (screenRow - middleStart);
  const hit = layout.visual[visualIndex];
  if (!hit || hit.rowIndex === null) return null;
  return hit.rowIndex;
}

function renderHeaderLines(
  state: AgentsPanelState,
  cols: number,
  metasForTally: SessionMeta[],
): string[] {
  const mini = renderMiniHeader(
    {
      version: state.version,
      agentName: state.agentName,
      modelLabel: state.modelLabel,
      cwd: state.entryCwd,
      sessionId: state.entrySessionId,
      sessionLabel: "",
      dataDir: "",
    },
    cols,
  )
    .split("\n")
    .map((line) => padPlain(line, cols));

  const tally = tallyFromMetas(
    metasForTally,
    state.runningBgSessionIds,
    state.interruptedSessionIds,
  );
  return [
    ...mini,
    padPlain(
      `${ansi.muted}${tally.awaiting} awaiting input · ${tally.working} working · ${tally.completed} completed${ansi.reset}`,
      cols,
    ),
    "",
  ];
}

function borderLine(cols: number): string {
  return padPlain(`${ansi.inputBorder}${"─".repeat(Math.max(0, cols))}${ansi.reset}`, cols);
}

function replyBoxTop(cols: number): string {
  const inner = Math.max(0, cols - 2);
  return padPlain(
    `${ansi.inputBorder}${BOX_TL}${BOX_H.repeat(inner)}${BOX_TR}${ansi.reset}`,
    cols,
  );
}

function replyBoxBottom(cols: number): string {
  const inner = Math.max(0, cols - 2);
  return padPlain(
    `${ansi.inputBorder}${BOX_BL}${BOX_H.repeat(inner)}${BOX_BR}${ansi.reset}`,
    cols,
  );
}

/** Wrap an inner ANSI line as `│ content │` fitted to `cols`. */
function replyBoxRow(inner: string, cols: number): string {
  const innerCols = Math.max(0, cols - 2);
  const fitted = fitAnsiLine(inner, innerCols);
  const pad = Math.max(0, innerCols - displayWidth(fitted));
  return padPlain(
    `${ansi.inputBorder}${BOX_V}${ansi.reset}${fitted}${" ".repeat(pad)}${ansi.inputBorder}${BOX_V}${ansi.reset}`,
    cols,
  );
}

function renderReplyContextLines(context: string, cols: number): string[] {
  const plain = context.replace(/\s+/g, " ").trim();
  if (!plain) return [];
  const wrapped = wrapContentLines(plain, Math.max(1, cols));
  return wrapped.slice(0, REPLY_CONTEXT_MAX_LINES).map((line) =>
    `${ansi.muted}${line}${ansi.reset}`,
  );
}

export interface AgentsComposePaint {
  lines: string[];
  /** Index of the first input row within `lines`. */
  inputLineIndex: number;
  cursorScreenRow: number;
  cursorScreenCol: number;
  scrollRow: number;
}

function agentsActiveBuffer(state: AgentsPanelState): {
  text: string;
  cursor: number;
  scrollRow: number;
  placeholder: string;
} {
  if (state.mode === "reply") {
    return {
      text: state.replyBuffer ?? "",
      cursor: state.replyCursor,
      scrollRow: state.replyScrollRow,
      placeholder: REPLY_PLACEHOLDER,
    };
  }
  return {
    text: state.composeBuffer,
    cursor: state.composeCursor,
    scrollRow: state.composeScrollRow,
    placeholder: COMPOSE_PLACEHOLDER,
  };
}

/** Build bottom compose/reply strip (optional slash menu above the input box). */
export function renderAgentsComposePaint(
  state: AgentsPanelState,
  cols: number,
  exitHint = false,
  slashLines: string[] = [],
): AgentsComposePaint {
  const { text, cursor, scrollRow, placeholder } = agentsActiveBuffer(state);
  const focused = state.composeFocus || text.length > 0;
  const replyMode = state.mode === "reply";
  const inputCols = replyMode ? Math.max(4, cols - 2) : cols;

  let inputRows: string[];
  let cursorScreenRow = 0;
  let cursorScreenCol = 1 + displayWidth("> ");
  let nextScroll = scrollRow;

  if (!text && !focused) {
    inputRows = [
      `${ansi.muted}> ${truncate(placeholder, Math.max(1, inputCols - 2))}${ansi.reset}`,
    ];
  } else {
    const rendered = renderMultilineInput({
      value: text,
      cursor,
      scrollRow,
      cols: inputCols,
      placeholder: text ? undefined : placeholder,
      maxVisibleLines: AGENTS_INPUT_MAX_VISIBLE_LINES,
    });
    inputRows = rendered.rows;
    cursorScreenRow = rendered.cursorScreenRow;
    cursorScreenCol = rendered.cursorScreenCol + (replyMode ? 1 : 0); // account for left `│`
    nextScroll = rendered.scrollRow;
  }

  const slashBlock =
    slashLines.length > 0
      ? [
          borderLine(cols),
          ...slashLines.map((line) => padPlain(line, cols)),
          borderLine(cols),
        ]
      : [];

  let boxLines: string[];
  let inputLineIndex: number;

  if (replyMode) {
    const contextInner = renderReplyContextLines(state.replyContext ?? "", inputCols);
    const contextRows =
      contextInner.length > 0
        ? contextInner.map((line) => replyBoxRow(line, cols))
        : [replyBoxRow("", cols)];
    const gapRow = replyBoxRow("", cols);
    const boxedInput = inputRows.map((row) => replyBoxRow(row, cols));
    boxLines = [
      replyBoxTop(cols),
      ...contextRows,
      gapRow,
      ...boxedInput,
      replyBoxBottom(cols),
    ];
    inputLineIndex = slashBlock.length + 1 + contextRows.length + 1; // top + context + gap
  } else {
    const paddedInput = inputRows.map((row) => padPlain(row, cols));
    boxLines = [borderLine(cols), ...paddedInput, borderLine(cols)];
    inputLineIndex = slashBlock.length + 1;
  }

  const lines = [
    ...slashBlock,
    ...boxLines,
    padPlain(agentsFooter(state, exitHint), cols),
  ];
  return {
    lines,
    inputLineIndex,
    cursorScreenRow,
    cursorScreenCol,
    scrollRow: nextScroll,
  };
}

function renderComposeLines(
  state: AgentsPanelState,
  cols: number,
  exitHint = false,
  slashLines: string[] = [],
): string[] {
  return renderAgentsComposePaint(state, cols, exitHint, slashLines).lines;
}

/** 1-based screen row of the first Agents compose/reply input line, or null. */
export function agentsComposeInputScreenRow(
  state: AgentsPanelState,
  cols: number,
  bodyRows: number,
  metasForTally: SessionMeta[],
  now = state.openedAt,
  slashLines: string[] = [],
): number | null {
  const layout = agentsPanelLayout(state, cols, bodyRows, metasForTally, now, slashLines);
  const paint = renderAgentsComposePaint(state, cols, false, slashLines);
  return layout.headerRows + layout.middleRows + paint.inputLineIndex + 1;
}

/** True when screenRow is inside the bottom compose/reply box (borders + input). */
export function agentsComposeHitTest(
  state: AgentsPanelState,
  screenRow: number,
  cols: number,
  bodyRows: number,
  metasForTally: SessionMeta[],
  now = state.openedAt,
  slashLines: string[] = [],
): boolean {
  const layout = agentsPanelLayout(state, cols, bodyRows, metasForTally, now, slashLines);
  const composeStart = layout.headerRows + layout.middleRows + 1; // 1-based
  const composeEnd = composeStart + layout.composeRows - 2; // exclude shortcuts footer
  return screenRow >= composeStart && screenRow <= composeEnd;
}

/**
 * Full-screen Agents UI: fixed mini-header + tally, scrollable list, fixed compose/footer.
 * Returns exactly `bodyRows` lines and the scroll offset used (selection kept in view).
 */
export function renderAgentsScreen(
  state: AgentsPanelState,
  cols: number,
  bodyRows: number,
  metasForTally: SessionMeta[],
  now = state.openedAt,
  options?: {
    exitHint?: boolean;
    pinSelection?: boolean;
    slashLines?: string[];
  },
): {
  lines: string[];
  listScrollOffset: number;
  composePaint: AgentsComposePaint;
  inputScreenRow: number;
} {
  const slashLines = options?.slashLines ?? [];
  const header = renderHeaderLines(state, cols, metasForTally);
  const composePaint = renderAgentsComposePaint(
    state,
    cols,
    options?.exitHint === true,
    slashLines,
  );
  const compose = composePaint.lines;
  const middleRows = Math.max(1, bodyRows - header.length - compose.length);

  const visual = buildVisualList(state, cols, now);
  const selectedVisual = visual.findIndex((v) => v.rowIndex === state.selectedIndex);
  const listScrollOffset =
    options?.pinSelection === false
      ? clampAgentsListScrollRange(state.listScrollOffset, visual.length, middleRows)
      : clampAgentsListScroll(
          state.listScrollOffset,
          selectedVisual,
          visual.length,
          middleRows,
        );

  const window = visual.slice(listScrollOffset, listScrollOffset + middleRows);
  const middle: string[] = window.map((v) => v.text);
  while (middle.length < middleRows) middle.push("");

  const lines = [...header, ...middle, ...compose];
  while (lines.length < bodyRows) lines.push("");
  const inputScreenRow =
    header.length + middleRows + composePaint.inputLineIndex + 1; // 1-based
  return {
    lines: lines.slice(0, bodyRows),
    listScrollOffset,
    composePaint,
    inputScreenRow,
  };
}

/** @deprecated compatibility for old imports */
export type AgentsPanelView = "list" | "detail";

export function renderAgentsPanelHeader(cols: number): string {
  const title = "Agents";
  const pad = Math.max(0, cols - title.length - 2);
  return `${ansi.planBorder}◉${ansi.reset} ${ansi.text}${title}${ansi.reset}${" ".repeat(pad)}`;
}

export function renderAgentsPanelBody(
  state: AgentsPanelState,
  cols: number,
  bodyRows: number,
): string[] {
  return renderAgentsScreen(state, cols, bodyRows, [], Date.now()).lines.slice(0, bodyRows);
}

export function renderAgentsPanelFooter(): string {
  return `${ansi.muted}enter to open · space to reply · ctrl+x to delete · ? for shortcuts${ansi.reset}`;
}

export function formatBgElapsed(task: BackgroundTask, now = Date.now()): string {
  return formatDurationMs(now - new Date(task.startedAt).getTime());
}
