import {
  aggregateWorkflowJournal,
  countRunningWorkflows,
  findLeadingAbsolutePath,
  isImagePath,
  loadWorkflowMetaFromScriptPath,
  loadWorkflowRuns,
  normalizeClipboardPath,
  primaryRunningWorkflow,
  readClipboardImage,
  readClipboardText,
  readJournalEntries,
  saveWorkflowArtifact,
  stopWorkflowByRunId,
  storeClipboardImage,
  storeUserAttachment,
  type SystemSkillEntry,
  type WorkflowMeta,
  type WorkflowRunRecord,
} from "@kako/core";
import type { AskUserQuestionItem, AskUserQuestionResult, UserAttachment } from "@kako/shared";
import { extractImageLabelsInOrder, formatImageMarker, nextImageIndexFromText } from "./image-markers.js";
import type { ClaudeFooterParts } from "./box.js";
import { renderClaudeInputLine } from "./box.js";
import {
  CHAT_TIPS,
  isThoughtSummaryLine,
  renderGeneratingStatus,
  renderSmooshingLine,
  pickDoneVerb,
  pickGeneratingVerb,
  renderTipLine,
  renderTurnToLines,
  toggleToolGroupExpanded,
  toggleChoiceExpanded,
  type ChatTurn,
  type ChoiceTimelineEntry,
  type ChoiceGroupTimelineEntry,
  type RenderLine,
  type ToolCallTimelineEntry,
  type TurnTimelineEntry,
} from "./chat-blocks.js";
import { isToolErrorToggleLine, isToolGroupToggleLine, isPlanToolToggleLine } from "./tool-call-display.js";
import { isChoiceToggleLine } from "./ask-user-question-display.js";
import { wrapContentLines } from "./text-wrap.js";
import { renderRichContentLines } from "./markdown-render.js";
import {
  CHOICE_HINT,
  MULTI_SELECT_CHOICE_HINT,
  buildChoiceRows,
  buildWizardReviewRows,
  type ChoiceRow,
  choicePanelRowCount,
  padChoiceLine,
  parseChoiceInputActions,
  questionWizardPanelRowCount,
  renderChoicePanelLines,
  renderQuestionWizardPanelLines,
} from "./choice-picker.js";
import {
  buildPlanReviewRows,
  padPlanReviewLines,
  PLAN_REVIEW_HINT,
  PLAN_REVIEW_INTRO,
  planActionFromRow,
  planReviewPanelRowCount,
  renderPlanReviewPanelLines,
  type PlanReviewDecision,
} from "./plan-review.js";
import { openFileInEditor, openPlanInEditor, readPlanFileText } from "./open-editor.js";
import { renderHistorySeparator, renderPlanModeFooterHint } from "./input-footer.js";
import {
  completeSlashSuggestion,
  filterSlashSuggestions,
  planSlashSuggestFooter,
  renderSlashSuggestLines,
  resolveSlashSubmitValue,
  shouldShowSlashMenu,
  slashSuggestQuery,
  SLASH_SUGGEST_HINT,
} from "./slash-suggest.js";
import {
  renderWorkflowFooterLine,
  renderWorkflowWaitingLine,
  type WorkflowFooterState,
} from "./workflow-footer.js";
import {
  buildWorkflowConfirmChoiceRows,
  padWorkflowConfirmLines,
  renderWorkflowConfirmContentLines,
  renderWorkflowConfirmPanelLines,
  WORKFLOW_CONFIRM_HINT,
  workflowConfirmDecisionFromRow,
  workflowConfirmOptionIndexFromRow,
  workflowConfirmPanelRowCount,
  workflowConfirmToggleScript,
  type WorkflowConfirmDecision,
  type WorkflowConfirmViewState,
} from "./workflow-confirm.js";
import {
  renderWorkflowsFullScreen,
  sortWorkflowRuns,
  type WorkflowsPanelState,
} from "./workflows-panel.js";
import { InputHistory } from "./input-history.js";
import type { ChatHeaderMode } from "./cli-usage.js";
import {
  renderChatHeader,
  resolveEffectiveHeaderMode,
  type WelcomeScreenOptions,
} from "./welcome.js";
import { ansi, displayWidth, visibleLength } from "./ansi.js";
import type { PermissionMode } from "@kako/shared";

const H = "─";

/** Enter isolated alternate screen — no scrollback to pre-kako shell history. */
const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[3J\x1b[H\x1b[2J";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_SCROLLBACK = "\x1b[3J";
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const ENABLE_BRACKETED_PASTE = "\x1b[?2004h";
const DISABLE_BRACKETED_PASTE = "\x1b[?2004l";
/** xterm focus-in/out reporting — repaint after hide/show or tab switch. */
const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
/** Disable all mouse tracking including motion (preserves drag-to-select). */
const DISABLE_MOUSE = "\x1b[?1003l\x1b[?1002l\x1b[?1006l\x1b[?1000l";

const CTRL_C_EXIT_MS = 2000;
const EXIT_HINT_MS = 1000;
const EXIT_HINT = "Press Ctrl+C again to exit";

/** Blank line padding at top/bottom of the scrollable chat area. */
const CHAT_EDGE_LINE: RenderLine = { text: "" };

/** Footer rows: topSep, input, bottomSep, shortcuts */
export const CHAT_FOOTER_HEIGHT = 4;

export class ExitRequestedError extends Error {
  constructor() {
    super("exit");
    this.name = "ExitRequestedError";
  }
}

export class ChoiceCancelledError extends Error {
  constructor() {
    super("Question cancelled");
    this.name = "ChoiceCancelledError";
  }
}

export interface ReadChoiceOptions {
  header: string;
  question: string;
  rows: ChoiceRow[];
  questionIndex?: number;
  questionTotal?: number;
  /** When true, Enter toggles option checkboxes; Submit confirms selection. */
  multiSelect?: boolean;
}

export function getTerminalSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

function moveTo(row: number, col = 1): string {
  return `\x1b[${row};${col}H`;
}

function clearLine(): string {
  return "\x1b[2K";
}

function padToWidth(line: string, width: number): string {
  const len = visibleLength(line);
  if (len >= width) return line;
  return line + " ".repeat(width - len);
}

/** Word-wrap plain or ANSI text to fit terminal columns. */
export { wrapContentLines } from "./text-wrap.js";

type InputAction =
  | { type: "char"; char: string }
  | { type: "enter" }
  | { type: "backspace" }
  | { type: "cursorLeft" }
  | { type: "cursorRight" }
  | { type: "cursorHome" }
  | { type: "cursorEnd" }
  | { type: "historyUp" }
  | { type: "historyDown" }
  | { type: "tab" }
  | { type: "shiftTab" }
  | { type: "paste" }
  | { type: "pasteText"; text: string }
  | { type: "scroll"; delta: number }
  | { type: "click"; row: number; col: number }
  | { type: "focusIn" }
  | { type: "interrupt" };

function prevCodePointIndex(text: string, index: number): number {
  if (index <= 0) return 0;
  const cp = text.codePointAt(index - 1);
  return index - (cp !== undefined && cp > 0xffff ? 2 : 1);
}

function nextCodePointIndex(text: string, index: number): number {
  if (index >= text.length) return text.length;
  const cp = text.codePointAt(index);
  return index + (cp !== undefined && cp > 0xffff ? 2 : 1);
}

/** Parse raw stdin chunks into logical input actions. */
export function parseInputActions(data: string): { actions: InputAction[]; rest: string } {
  const actions: InputAction[] = [];
  let i = 0;

  while (i < data.length) {
    if (data.startsWith(BRACKETED_PASTE_START, i)) {
      const contentStart = i + BRACKETED_PASTE_START.length;
      const end = data.indexOf(BRACKETED_PASTE_END, contentStart);
      if (end === -1) {
        return { actions, rest: data.slice(i) };
      }
      actions.push({ type: "pasteText", text: data.slice(contentStart, end) });
      i = end + BRACKETED_PASTE_END.length;
      continue;
    }

    const ch = data[i]!;

    if (ch === "\r" || ch === "\n") {
      actions.push({ type: "enter" });
      i++;
      continue;
    }
    if (ch === "\u0003") {
      actions.push({ type: "interrupt" });
      i++;
      continue;
    }
    if (ch === "\u0016") {
      actions.push({ type: "paste" });
      i++;
      continue;
    }
    if (ch === "\u007f" || ch === "\b") {
      actions.push({ type: "backspace" });
      i++;
      continue;
    }

    if (ch === "\x1b") {
      const rest = data.slice(i);
      if (rest.startsWith("\x1b[I")) {
        actions.push({ type: "focusIn" });
        i += 3;
        continue;
      }
      if (rest.startsWith("\x1b[O")) {
        i += 3;
        continue;
      }

      const x10 = rest.match(/^\x1b\[M([\x20-\x7e])([\x21-\x7e])([\x21-\x7e])/);
      if (x10) {
        const btn = x10[1]!.charCodeAt(0) - 32;
        if (btn === 64) {
          actions.push({ type: "scroll", delta: -3 });
        } else if (btn === 65) {
          actions.push({ type: "scroll", delta: 3 });
        } else if (btn !== 3) {
          actions.push({
            type: "click",
            col: x10[2]!.charCodeAt(0) - 32,
            row: x10[3]!.charCodeAt(0) - 32,
          });
        }
        i += x10[0].length;
        continue;
      }

      const sgr = rest.match(/^\x1b\[<(\d+);(\d+);(\d+)([mM])/);
      if (sgr) {
        const btn = Number(sgr[1]);
        const col = Number(sgr[2]);
        const row = Number(sgr[3]);
        const release = sgr[4] === "m";
        if (btn === 64) {
          actions.push({ type: "scroll", delta: -3 });
        } else if (btn === 65) {
          actions.push({ type: "scroll", delta: 3 });
        } else if (!release) {
          const modifiers = btn & (4 | 8 | 16);
          const button = btn & 3;
          // Ignore shift/alt/ctrl clicks so the terminal can select text.
          if (modifiers === 0 && button === 0) {
            actions.push({ type: "click", col, row });
          }
        }
        i += sgr[0].length;
        continue;
      }

      const wheel = rest.match(/^\x1b\[<(\d+);/);
      if (wheel) {
        const btn = Number(wheel[1]);
        if (btn === 64) actions.push({ type: "scroll", delta: -3 });
        if (btn === 65) actions.push({ type: "scroll", delta: 3 });
        i += wheel[0].length;
        while (i < data.length && data[i] !== "M" && data[i] !== "m") i++;
        if (i < data.length) i++;
        continue;
      }

      const csi = rest.match(/^\x1b\[([0-9;]*)([~A-Za-z])/);
      if (csi) {
        const params = csi[1];
        const code = csi[2];
        if (code === "~") {
          if (params === "5") actions.push({ type: "scroll", delta: -1 });
          if (params === "6") actions.push({ type: "scroll", delta: 1 });
          if (params === "1") actions.push({ type: "cursorHome" });
          if (params === "4") actions.push({ type: "cursorEnd" });
        } else if (code === "A") {
          actions.push({ type: "historyUp" });
        } else if (code === "B") {
          actions.push({ type: "historyDown" });
        } else if (code === "C") {
          actions.push({ type: "cursorRight" });
        } else if (code === "D") {
          actions.push({ type: "cursorLeft" });
        } else if (code === "I") {
          actions.push({ type: "focusIn" });
        } else if (code === "O") {
          // focus out — ignore
        } else if (code === "Z") {
          actions.push({ type: "shiftTab" });
        }
        i += csi[0].length;
        continue;
      }

      i++;
      continue;
    }

    if (ch === "\t") {
      actions.push({ type: "tab" });
      i++;
      continue;
    }

    if (ch >= " ") {
      actions.push({ type: "char", char: ch });
    }
    i++;
  }

  return { actions, rest: data.slice(i) };
}

/** Coalesce char/enter bursts that look like unbracketed terminal paste. */
export async function coalescePasteActions(actions: InputAction[]): Promise<InputAction[]> {
  if (actions.length >= 2 && actions.every((action) => action.type === "char")) {
    const text = actions.map((action) => (action.type === "char" ? action.char : "")).join("");
    return [{ type: "pasteText", text }];
  }
  if (
    actions.length >= 3 &&
    actions.some((action) => action.type === "enter") &&
    actions.every((action) => action.type === "char" || action.type === "enter")
  ) {
    let text = "";
    for (const action of actions) {
      if (action.type === "char") text += action.char;
      else if (action.type === "enter") text += "\n";
    }
    if (text.includes("\n")) {
      return [{ type: "pasteText", text }];
    }
  }
  return actions;
}

function footerSeparator(cols: number): string {
  return `${ansi.line}${H.repeat(cols)}${ansi.reset}`;
}

function inputFooterSeparator(cols: number): string {
  return `${ansi.inputBorder}${H.repeat(cols)}${ansi.reset}`;
}

export class ChatLayout {
  private getWelcomeOpts: () => WelcomeScreenOptions;
  private footerParts: ClaudeFooterParts;
  private readonly preferredHeaderMode: ChatHeaderMode;
  private lastEffectiveHeaderMode: ChatHeaderMode | null = null;
  private plainLines: string[] = [];
  private turns: ChatTurn[] = [];
  private activeTurn: ChatTurn | null = null;
  private tipText: string | null = null;
  private turnTickTimer: ReturnType<typeof setInterval> | null = null;
  private scrollOffset = 0;
  /** When true, new content keeps the viewport pinned to the bottom. Cleared by scrolling up. */
  private followBottom = true;
  private readonly defaultFooterHeight = CHAT_FOOTER_HEIGHT;

  get footerHeight(): number {
    return this.activeFooterHeight;
  }
  private shortcutsOverride: string | null = null;
  private exitHintTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeListener: (() => void) | null = null;
  private resumeListener: (() => void) | null = null;
  private redrawDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPaintedHeaderLines = 0;
  /** Set when the terminal may have cleared the alt-screen buffer (focus/resume). */
  private viewportNeedsFullRedraw = false;
  private inputListener: ((chunk: string) => void) | null = null;
  private inputResolve: ((value: string) => void) | null = null;
  private inputReject: ((reason: ExitRequestedError) => void) | null = null;
  private inputBuffer = "";
  private inputCursor = 0;
  private stdinRest = "";
  private inputRow = 0;
  private readingLine = false;
  private readingConfirm = false;
  private confirmResolve: ((allowed: boolean) => void) | null = null;
  private readingChoice = false;
  private readLinePlain = false;
  private readLinePlaceholder: string | undefined;
  private active = false;
  private lastCtrlCAt = 0;
  /** Set when user presses Ctrl+C during an active turn (streaming, not in a picker). */
  private turnExitRequested = false;
  private activeFooterHeight = CHAT_FOOTER_HEIGHT;
  private choiceResolve: ((row: ChoiceRow) => void) | null = null;
  private choiceReject: ((reason: Error) => void) | null = null;
  private choiceHeader = "";
  private choiceQuestion = "";
  private choiceRows: ChoiceRow[] = [];
  private choiceSelected = 0;
  private choiceQuestionIndex = 0;
  private choiceQuestionTotal = 1;
  /** Single-question picker: header chip hidden until user presses ↑/↓. */
  private choiceShowHeader = false;
  private choiceMultiSelect = false;
  private choiceCheckedOptions = new Set<number>();
  private wizardMode = false;
  private wizardQuestions: AskUserQuestionItem[] = [];
  private wizardAnswers: Record<string, string> = {};
  private wizardAnnotations: NonNullable<AskUserQuestionResult["annotations"]> = {};
  private wizardFocus = 0;
  private wizardResolve: ((result: AskUserQuestionResult) => void) | null = null;
  private wizardReject: ((reason: Error) => void) | null = null;

  private planReviewMode = false;
  private sessionId = "";
  private pendingImages: Array<{ index: number; attachment: UserAttachment }> = [];
  private nextImageIndex = 1;
  private planReviewPath = "";
  private planReviewText = "";
  private planReviewSelected = 0;
  private planReviewResolve: ((decision: PlanReviewDecision) => void) | null = null;

  private slashInvokableSkills: SystemSkillEntry[] = [];
  private slashSuggestSelected = 0;
  private lastSlashSuggestQuery = "";
  /** Tracks last painted slash-menu footer extent for clearing shrink leftovers. */
  private slashFooterDrawExtent = { top: 0, rows: 0 };
  /** maxVisible passed to renderSlashSuggestLines — kept in sync with footer budget. */
  private slashSuggestMaxVisible = 4;

  private workflowFooter: WorkflowFooterState | null = null;
  private workflowWaitingCount = 0;
  private workflowPollTimer: ReturnType<typeof setInterval> | null = null;
  private workflowPollSessionId = "";

  private readingWorkflowsPanel = false;
  private workflowsPanelState: WorkflowsPanelState = {
    view: "list",
    runs: [],
    selectedIndex: 0,
    selectedPhaseIndex: 0,
    selectedAgentIndex: 0,
    phases: [],
  };
  private workflowsPanelSessionId = "";
  private workflowsPanelResolve: (() => void) | null = null;

  private workflowConfirmMode = false;
  private workflowConfirmMeta: WorkflowMeta | null = null;
  private workflowConfirmArgs: unknown;
  private workflowConfirmScriptSource = "";
  private workflowConfirmScriptPath = "";
  private workflowConfirmView: WorkflowConfirmViewState = {
    scriptVisible: false,
    scriptToggled: false,
    selectedIndex: 0,
  };
  private workflowConfirmResolve: ((decision: WorkflowConfirmDecision) => void) | null = null;

  private inputHistory = new InputHistory();
  private permissionMode: PermissionMode = "default";
  private onPermissionModeChange?: (mode: PermissionMode) => void;

  /** Sync CLI permission mode with the agent runtime (shift+tab, EnterPlanMode, etc.). */
  setPermissionModeChangeHandler(handler: (mode: PermissionMode) => void): void {
    this.onPermissionModeChange = handler;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
    if (this.readingLine && this.active) {
      this.drawFooter(this.inputBuffer, this.readLinePlaceholder);
    }
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  private cyclePermissionMode(): void {
    const next: PermissionMode = this.permissionMode === "plan" ? "default" : "plan";
    this.onPermissionModeChange?.(next);
  }

  private allWizardQuestionsAnswered(): boolean {
    return this.wizardQuestions.every((q) => Boolean(this.wizardAnswers[q.question]));
  }

  private completeWizard(): void {
    const resolve = this.wizardResolve;
    const answers = { ...this.wizardAnswers };
    const annotations =
      Object.keys(this.wizardAnnotations).length > 0
        ? { ...this.wizardAnnotations }
        : undefined;
    this.finishWizard();
    resolve?.({
      answers,
      ...(annotations ? { annotations } : {}),
    });
  }

  /** All questions answered — show review screen before final submit. */
  private goToWizardReview(): void {
    this.wizardFocus = this.wizardQuestions.length;
    this.choiceSelected = 0;
    this.syncWizardRows();
    this.redrawWizardPanel();
  }

  private cancelWizardReview(): void {
    const resolve = this.wizardResolve;
    const answers = { ...this.wizardAnswers };
    const annotations =
      Object.keys(this.wizardAnnotations).length > 0
        ? { ...this.wizardAnnotations }
        : undefined;
    this.finishWizard();
    resolve?.({
      answers,
      declined: true,
      ...(annotations ? { annotations } : {}),
    });
  }

  /** Cached visible content rows — skip unchanged lines so text stays selectable. */
  private lastContentRendered: string[] = [];

  constructor(
    getWelcomeOpts: () => WelcomeScreenOptions,
    footerParts: ClaudeFooterParts,
    preferredHeaderMode: ChatHeaderMode = "standard",
  ) {
    this.getWelcomeOpts = getWelcomeOpts;
    this.footerParts = footerParts;
    this.preferredHeaderMode = preferredHeaderMode;
  }

  private effectiveHeaderMode(): ChatHeaderMode {
    return resolveEffectiveHeaderMode(this.preferredHeaderMode, getTerminalSize());
  }

  get headerText(): string {
    const { cols } = getTerminalSize();
    return renderChatHeader(this.getWelcomeOpts(), this.effectiveHeaderMode(), cols);
  }

  get headerLines(): string[] {
    const lines = this.headerText.split("\n");
    if (this.effectiveHeaderMode() === "mini") return lines;
    return lines.filter((line, index) => !(index === 0 && line === ""));
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    this.nextImageIndex = 1;
    this.pendingImages = [];
  }

  setSlashInvokableSkills(skills: SystemSkillEntry[]): void {
    this.slashInvokableSkills = skills;
  }

  isTurnInProgress(): boolean {
    return Boolean(this.activeTurn && this.activeTurn.phase !== "done");
  }

  appendWorkflowCompletedEvent(text: string): void {
    this.appendTurnTimeline(text);
  }

  startWorkflowPolling(sessionId: string): void {
    this.stopWorkflowPolling();
    this.workflowPollSessionId = sessionId;
    void this.refreshWorkflowFooter(sessionId);
    this.workflowPollTimer = setInterval(() => {
      void this.refreshWorkflowFooter(this.workflowPollSessionId);
    }, 1000);
  }

  stopWorkflowPolling(): void {
    if (this.workflowPollTimer) {
      clearInterval(this.workflowPollTimer);
      this.workflowPollTimer = null;
    }
    this.workflowPollSessionId = "";
  }

  async refreshWorkflowFooter(sessionId: string): Promise<void> {
    if (!sessionId) return;
    try {
      const runs = await loadWorkflowRuns(sessionId);
      const primary = primaryRunningWorkflow(runs);
      if (primary && (primary.status === "running" || primary.status === "pending")) {
        const start = new Date(primary.startedAt).getTime();
        this.workflowFooter = {
          name: primary.name,
          description: primary.description,
          agentsDone: primary.agentsDone,
          agentsTotal: primary.agentsTotal,
          agentsFailed: primary.agentsFailed,
          elapsedMs: Date.now() - start,
          status: primary.status === "pending" ? "pending" : "running",
          currentPhase: primary.currentPhase,
        };
      } else {
        this.workflowFooter = null;
      }
      this.workflowWaitingCount = this.isTurnInProgress() ? countRunningWorkflows(runs) : 0;
      if (this.readingWorkflowsPanel && this.workflowsPanelSessionId === sessionId) {
        this.workflowsPanelState = {
          ...this.workflowsPanelState,
          runs: sortWorkflowRuns(runs),
        };
      }
      if (!this.active) return;
      if (this.readingWorkflowsPanel && this.workflowsPanelSessionId === sessionId) {
        if (this.workflowsPanelState.view === "detail" || this.workflowsPanelState.view === "agent") {
          const run = this.workflowsPanelState.runs[this.workflowsPanelState.selectedIndex];
          if (run) await this.loadWorkflowsPanelPhases(run);
        }
        this.drawWorkflowsPanel();
        return;
      }
      if (this.readingLine && !this.inputBuffer.length) {
        this.drawFooter(this.inputBuffer, this.readLinePlaceholder);
      } else {
        this.invalidateContentCache();
        this.redrawContent();
      }
    } catch {
      // Ignore transient read errors during polling.
    }
  }

  async openWorkflowsPanel(sessionId: string): Promise<void> {
    const runs = sortWorkflowRuns(await loadWorkflowRuns(sessionId));
    this.workflowsPanelSessionId = sessionId;
    this.workflowsPanelState = {
      view: "list",
      runs,
      selectedIndex: 0,
      selectedPhaseIndex: 0,
      selectedAgentIndex: 0,
      phases: [],
    };
    this.readingWorkflowsPanel = true;
    this.invalidateContentCache();
    this.drawWorkflowsPanel();

    return new Promise((resolve) => {
      this.workflowsPanelResolve = resolve;
    });
  }

  consumePendingAttachments(text: string): UserAttachment[] {
    const indices = new Set(
      extractImageLabelsInOrder(text).map((label) => Number(label.match(/#(\d+)/)?.[1])),
    );
    const sorted = [...this.pendingImages]
      .filter((entry) => indices.has(entry.index))
      .sort((a, b) => a.index - b.index);
    const used = new Set(sorted.map((entry) => entry.index));
    this.pendingImages = this.pendingImages.filter((entry) => !used.has(entry.index));
    return sorted.map((entry) => entry.attachment);
  }

  get headerHeight(): number {
    return this.effectiveHeaderMode() === "standard" ? this.headerLines.length : 0;
  }

  get contentHeight(): number {
    const { rows } = getTerminalSize();
    return Math.max(1, rows - this.headerHeight - this.footerHeight);
  }

  get footerTop(): number {
    const { rows } = getTerminalSize();
    return rows - this.footerHeight + 1;
  }

  /** Footer height capped so input/slash menu never overlaps the welcome header. */
  private maxFooterHeight(): number {
    const { rows } = getTerminalSize();
    return Math.max(this.defaultFooterHeight, rows - this.headerHeight - 1);
  }

  private clampFooterHeight(requested: number): number {
    return Math.min(requested, this.maxFooterHeight());
  }

  start(): void {
    this.active = true;
    process.stdout.write(ENTER_ALT_SCREEN);
    process.stdout.write(HIDE_CURSOR);
    this.attachInput();
    this.resizeListener = () => this.scheduleFullRedraw();
    process.stdout.on("resize", this.resizeListener);
    if (process.platform !== "win32") {
      this.resumeListener = () => this.scheduleFullRedraw();
      process.on("SIGCONT", this.resumeListener);
    }
    this.redraw();
  }

  stop(): void {
    if (!this.active) return;
    this.stopTurnTick();
    this.stopWorkflowPolling();
    this.clearExitHint();
    this.detachInput();
    if (this.resizeListener) {
      process.stdout.off("resize", this.resizeListener);
      this.resizeListener = null;
    }
    if (this.resumeListener) {
      process.off("SIGCONT", this.resumeListener);
      this.resumeListener = null;
    }
    if (this.redrawDebounceTimer) {
      clearTimeout(this.redrawDebounceTimer);
      this.redrawDebounceTimer = null;
    }
    process.stdout.write(LEAVE_ALT_SCREEN);
    process.stdout.write(SHOW_CURSOR);
    this.active = false;
  }

  private scheduleFullRedraw(): void {
    if (!this.active) return;
    this.viewportNeedsFullRedraw = true;
    if (this.redrawDebounceTimer) clearTimeout(this.redrawDebounceTimer);
    this.redrawDebounceTimer = setTimeout(() => {
      this.redrawDebounceTimer = null;
      this.redraw();
    }, 32);
  }

  private attachInput(): void {
    if (this.inputListener) return;
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    if (process.stdout.isTTY) {
      process.stdout.write(ENABLE_MOUSE);
      process.stdout.write(ENABLE_BRACKETED_PASTE);
      process.stdout.write(ENABLE_FOCUS_REPORTING);
    }
    this.inputListener = (chunk: string) => this.onInput(chunk);
    process.stdin.on("data", this.inputListener);
  }

  private detachInput(): void {
    if (this.inputListener) {
      process.stdin.off("data", this.inputListener);
      this.inputListener = null;
    }
    this.teardownInput();
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    if (process.stdout.isTTY) {
      process.stdout.write(DISABLE_MOUSE);
      process.stdout.write(DISABLE_BRACKETED_PASTE);
      process.stdout.write(DISABLE_FOCUS_REPORTING);
    }
  }

  private onInput(chunk: string): void {
    if (!this.active) return;
    if (this.workflowConfirmMode) {
      void this.handleWorkflowConfirmInput(chunk);
      return;
    }
    if (this.planReviewMode) {
      void this.handlePlanReviewInput(chunk);
      return;
    }
    if (this.readingWorkflowsPanel) {
      void this.handleWorkflowsPanelInput(chunk);
      return;
    }
    if (this.readingChoice) {
      this.handleChoiceInput(chunk);
      return;
    }
    if (this.readingConfirm) {
      this.handleConfirmInput(chunk);
      return;
    }

    const combined = this.stdinRest + chunk;
    const { actions, rest } = parseInputActions(combined);
    this.stdinRest = rest;

    void this.dispatchInputActions(actions);
  }

  private async dispatchInputActions(actions: InputAction[]): Promise<void> {
    const expanded = await this.coalesceCharPasteActions(actions);

    for (const action of expanded) {
      if (action.type === "click") {
        this.handleClick(action.row, action.col);
        continue;
      }
      if (action.type === "focusIn") {
        this.scheduleFullRedraw();
        continue;
      }
      if (action.type === "scroll") {
        this.scrollBy(action.delta);
        this.redrawContent();
        continue;
      }
      if (action.type === "interrupt") {
        if (this.readingLine) {
          this.handleReadLineAction(action);
          continue;
        }
        if (this.activeTurn) {
          this.turnExitRequested = true;
          continue;
        }
        continue;
      }
      if (this.readingLine) {
        this.handleReadLineAction(action);
      }
    }
  }

  /** Terminals without bracketed paste may deliver a file path as one chunk of char actions. */
  private async coalesceCharPasteActions(actions: InputAction[]): Promise<InputAction[]> {
    if (actions.length < 2 || !actions.every((action) => action.type === "char")) {
      return actions;
    }
    const text = actions.map((action) => (action.type === "char" ? action.char : "")).join("");
    if (!text.startsWith("/")) {
      return actions;
    }
    const leading = await findLeadingAbsolutePath(text);
    if (!leading) {
      return actions;
    }
    return [{ type: "pasteText", text }];
  }

  private handleConfirmInput(chunk: string): void {
    const { actions } = parseInputActions(chunk);
    for (const action of actions) {
      if (action.type === "char") {
        const key = action.char.toLowerCase();
        if (key === "y") {
          this.finishConfirm(true);
          return;
        }
        if (key === "n") {
          this.finishConfirm(false);
          return;
        }
      }
      if (action.type === "enter") {
        this.finishConfirm(false);
        return;
      }
      if (action.type === "interrupt") {
        this.finishConfirm(false);
        return;
      }
    }
  }

  private finishConfirm(allowed: boolean): void {
    const resolve = this.confirmResolve;
    this.confirmResolve = null;
    this.readingConfirm = false;
    this.shortcutsOverride = null;
    const entry = this.findLastWaitingToolEntry();
    if (entry) entry.awaitingApproval = false;
    this.updateGeneratingFooter();
    this.invalidateContentCache();
    this.redrawContent();
    resolve?.(allowed);
  }

  private handleChoiceInput(chunk: string): void {
    if (this.wizardMode) {
      this.handleWizardInput(chunk);
      return;
    }
    const { actions } = parseChoiceInputActions(chunk);
    for (const action of actions) {
      if (action.type === "interrupt") {
        const reject = this.choiceReject;
        this.finishChoice();
        reject?.(new ExitRequestedError());
        return;
      }
      if (action.type === "escape") {
        const reject = this.choiceReject;
        this.finishChoice();
        reject?.(new ChoiceCancelledError());
        return;
      }
      if (action.type === "up") {
        this.choiceShowHeader = true;
        this.choiceSelected = Math.max(0, this.choiceSelected - 1);
        this.redrawChoicePanel();
      }
      if (action.type === "down") {
        this.choiceShowHeader = true;
        this.choiceSelected = Math.min(this.choiceRows.length - 1, this.choiceSelected + 1);
        this.redrawChoicePanel();
      }
      if (action.type === "enter") {
        const row = this.choiceRows[this.choiceSelected];
        if (!row) return;

        if (this.choiceMultiSelect) {
          if (row.kind === "option" && row.optionIndex !== undefined) {
            if (this.choiceCheckedOptions.has(row.optionIndex)) {
              this.choiceCheckedOptions.delete(row.optionIndex);
            } else {
              this.choiceCheckedOptions.add(row.optionIndex);
            }
            this.redrawChoicePanel();
            return;
          }
          if (row.kind === "submit") {
            if (this.choiceCheckedOptions.size === 0) return;
            const labels = [...this.choiceCheckedOptions]
              .sort((a, b) => a - b)
              .map((i) => this.choiceRows.find((r) => r.optionIndex === i)?.label)
              .filter((l): l is string => Boolean(l));
            const resolve = this.choiceResolve;
            this.finishChoice();
            resolve?.({ kind: "submit", label: labels.join(", ") });
            return;
          }
          if (row.kind === "custom") {
            void this.promptChoiceCustomText();
            return;
          }
          if (row.kind === "chat") {
            const reject = this.choiceReject;
            this.finishChoice();
            reject?.(new ChoiceCancelledError());
            return;
          }
          return;
        }

        const resolve = this.choiceResolve;
        this.finishChoice();
        resolve?.(row);
        return;
      }
    }
  }

  private handleWizardInput(chunk: string): void {
    const { actions } = parseChoiceInputActions(chunk);
    for (const action of actions) {
      if (action.type === "interrupt") {
        const reject = this.wizardReject;
        this.finishWizard();
        reject?.(new ExitRequestedError());
        return;
      }
      if (action.type === "escape") {
        const resolve = this.wizardResolve;
        const answers = { ...this.wizardAnswers };
        const annotations =
          Object.keys(this.wizardAnnotations).length > 0
            ? { ...this.wizardAnnotations }
            : undefined;
        this.finishWizard();
        resolve?.({
          answers,
          declined: true,
          ...(annotations ? { annotations } : {}),
        });
        return;
      }
      if (action.type === "left") {
        if (this.wizardFocus > 0) {
          this.wizardFocus--;
        } else if (this.wizardFocus === this.wizardQuestions.length) {
          this.wizardFocus = this.wizardQuestions.length - 1;
        }
        this.choiceSelected = 0;
        this.syncWizardRows();
        this.redrawWizardPanel();
      }
      if (action.type === "right") {
        if (this.wizardFocus < this.wizardQuestions.length - 1) {
          this.wizardFocus++;
        } else if (this.allWizardQuestionsAnswered()) {
          this.wizardFocus = this.wizardQuestions.length;
        }
        this.choiceSelected = 0;
        this.syncWizardRows();
        this.redrawWizardPanel();
      }
      if (action.type === "up") {
        if (this.wizardFocus < this.wizardQuestions.length) {
          this.choiceSelected = Math.max(0, this.choiceSelected - 1);
          this.redrawWizardPanel();
        } else if (this.allWizardQuestionsAnswered()) {
          this.choiceSelected = Math.max(0, this.choiceSelected - 1);
          this.redrawWizardPanel();
        }
      }
      if (action.type === "down") {
        if (this.wizardFocus < this.wizardQuestions.length) {
          this.choiceSelected = Math.min(this.choiceRows.length - 1, this.choiceSelected + 1);
          this.redrawWizardPanel();
        } else if (this.allWizardQuestionsAnswered()) {
          this.choiceSelected = Math.min(this.choiceRows.length - 1, this.choiceSelected + 1);
          this.redrawWizardPanel();
        }
      }
      if (action.type === "enter") {
        if (this.wizardFocus >= this.wizardQuestions.length) {
          if (!this.allWizardQuestionsAnswered()) return;
          const row = this.choiceRows[this.choiceSelected];
          if (!row) return;
          if (row.kind === "submit") {
            this.completeWizard();
          } else if (row.kind === "chat") {
            this.cancelWizardReview();
          }
          return;
        }

        const row = this.choiceRows[this.choiceSelected];
        if (!row) return;

        if (row.kind === "chat") {
          const resolve = this.wizardResolve;
          const answers = { ...this.wizardAnswers };
          const annotations =
            Object.keys(this.wizardAnnotations).length > 0
              ? { ...this.wizardAnnotations }
              : undefined;
          this.finishWizard();
          resolve?.({
            answers,
            declined: Object.keys(answers).length === 0 ? true : undefined,
            ...(annotations ? { annotations } : {}),
          });
          return;
        }

        if (row.kind === "custom") {
          void this.promptWizardCustomText();
          return;
        }

        const item = this.wizardQuestions[this.wizardFocus]!;
        this.wizardAnswers[item.question] = row.label;
        if (row.preview) {
          this.wizardAnnotations[item.question] = { preview: row.preview };
        }
        const nextUnanswered = this.wizardQuestions.findIndex(
          (q) => !this.wizardAnswers[q.question],
        );
        if (nextUnanswered === -1) {
          this.goToWizardReview();
          return;
        }
        this.wizardFocus = nextUnanswered;
        this.choiceSelected = 0;
        this.syncWizardRows();
        this.redrawWizardPanel();
      }
    }
  }

  private syncWizardRows(): void {
    if (this.wizardFocus >= this.wizardQuestions.length) {
      this.choiceRows = this.allWizardQuestionsAnswered() ? buildWizardReviewRows() : [];
      return;
    }
    const item = this.wizardQuestions[this.wizardFocus]!;
    this.choiceHeader = item.header;
    this.choiceQuestion = item.question;
    this.choiceRows = buildChoiceRows(item.options, true);
  }

  private updateWizardFooterHeight(): void {
    const { cols } = getTerminalSize();
    this.activeFooterHeight = this.clampFooterHeight(
      questionWizardPanelRowCount({
        questions: this.wizardQuestions,
        answers: this.wizardAnswers,
        focusIndex: this.wizardFocus,
        rows: this.choiceRows,
        selectedIndex: this.choiceSelected,
        cols,
      }),
    );
  }

  private redrawWizardPanel(): void {
    this.updateWizardFooterHeight();
    this.invalidateContentCache();
    this.redrawContent();
  }

  private drawWizardPanel(): void {
    const { cols, rows } = getTerminalSize();
    const top = this.footerTop;
    const panelLines = renderQuestionWizardPanelLines({
      questions: this.wizardQuestions,
      answers: this.wizardAnswers,
      focusIndex: this.wizardFocus,
      rows: this.choiceRows,
      selectedIndex: this.choiceSelected,
      cols,
    });

    const sep = footerSeparator(cols);
    const footerRows = [
      padToWidth(sep, cols),
      ...panelLines.map((line) => padChoiceLine(line, cols)),
      padToWidth(sep, cols),
      padToWidth(CHOICE_HINT, cols),
    ];

    let out = "";
    for (let i = 0; i < footerRows.length; i++) {
      out += moveTo(top + i);
      out += clearLine();
      out += footerRows[i]!;
    }
    for (let i = top + footerRows.length; i <= rows; i++) {
      out += moveTo(i);
      out += clearLine();
    }
    process.stdout.write(out);
    process.stdout.write(HIDE_CURSOR);
  }

  private async promptWizardCustomText(): Promise<void> {
    const item = this.wizardQuestions[this.wizardFocus]!;
    this.readingChoice = false;
    this.wizardMode = false;
    const text = (await this.readLine({ plain: true })).trim();
    if (!text) {
      this.wizardReject?.(new Error("Empty answer"));
      this.finishWizard();
      return;
    }
    this.wizardAnswers[item.question] = text;
    const nextUnanswered = this.wizardQuestions.findIndex((q) => !this.wizardAnswers[q.question]);
    if (nextUnanswered === -1) {
      this.wizardMode = true;
      this.readingChoice = true;
      this.goToWizardReview();
      return;
    }
    this.wizardFocus = nextUnanswered;
    this.choiceSelected = 0;
    this.wizardMode = true;
    this.readingChoice = true;
    this.syncWizardRows();
    this.redrawWizardPanel();
  }

  private async promptChoiceCustomText(): Promise<void> {
    this.readingChoice = false;
    const text = (await this.readLine({ plain: true })).trim();
    if (!text) {
      this.choiceReject?.(new Error("Empty answer"));
      this.finishChoice();
      return;
    }
    const resolve = this.choiceResolve;
    this.finishChoice();
    resolve?.({ kind: "custom", label: text });
  }

  private finishWizard(): void {
    this.wizardMode = false;
    this.wizardResolve = null;
    this.wizardReject = null;
    this.wizardQuestions = [];
    this.wizardAnswers = {};
    this.wizardAnnotations = {};
    this.wizardFocus = 0;
    this.readingChoice = false;
    this.choiceRows = [];
    this.restoreDefaultFooter();
    if (this.active) {
      process.stdout.write(HIDE_CURSOR);
    }
  }

  private updateChoiceFooterHeight(): void {
    const { cols } = getTerminalSize();
    this.activeFooterHeight = this.clampFooterHeight(
      choicePanelRowCount({
        header: this.choiceHeader,
        question: this.choiceQuestion,
        rows: this.choiceRows,
        selectedIndex: this.choiceSelected,
        cols,
        questionIndex: this.choiceQuestionIndex,
        questionTotal: this.choiceQuestionTotal,
        showHeader: this.choiceShowHeaderForPanel(),
        multiSelect: this.choiceMultiSelect,
        checkedOptionIndexes: this.choiceCheckedOptions,
      }),
    );
  }

  /** Multi-question wizard always shows the chip bar; single-question hides it until ↑/↓. */
  private choiceShowHeaderForPanel(): boolean {
    if (this.wizardMode) return true;
    if (this.choiceQuestionTotal > 1) return true;
    return this.choiceShowHeader;
  }

  private redrawChoicePanel(): void {
    this.updateChoiceFooterHeight();
    this.invalidateContentCache();
    this.redrawContent();
  }

  private drawChoicePanel(): void {
    const { cols, rows } = getTerminalSize();
    const top = this.footerTop;
    const panelLines = renderChoicePanelLines({
      header: this.choiceHeader,
      question: this.choiceQuestion,
      rows: this.choiceRows,
      selectedIndex: this.choiceSelected,
      cols,
      questionIndex: this.choiceQuestionIndex,
      questionTotal: this.choiceQuestionTotal,
      showHeader: this.choiceShowHeaderForPanel(),
      multiSelect: this.choiceMultiSelect,
      checkedOptionIndexes: this.choiceCheckedOptions,
    });

    const sep = footerSeparator(cols);
    const hint = this.choiceMultiSelect ? MULTI_SELECT_CHOICE_HINT : CHOICE_HINT;
    const footerRows = [
      padToWidth(sep, cols),
      ...panelLines.map((line) => padChoiceLine(line, cols)),
      padToWidth(sep, cols),
      padToWidth(hint, cols),
    ];

    let out = "";
    for (let i = 0; i < footerRows.length; i++) {
      out += moveTo(top + i);
      out += clearLine();
      out += footerRows[i]!;
    }
    for (let i = top + footerRows.length; i <= rows; i++) {
      out += moveTo(i);
      out += clearLine();
    }
    process.stdout.write(out);
    process.stdout.write(HIDE_CURSOR);
  }

  private finishChoice(): void {
    this.wizardMode = false;
    this.choiceResolve = null;
    this.choiceReject = null;
    this.readingChoice = false;
    this.choiceRows = [];
    this.choiceShowHeader = false;
    this.choiceMultiSelect = false;
    this.choiceCheckedOptions = new Set();
    this.restoreDefaultFooter();
    if (this.active) {
      process.stdout.write(HIDE_CURSOR);
    }
  }

  private handleReadLineAction(action: InputAction): void {
    const placeholder = this.readLinePlaceholder;
    const plain = this.readLinePlain;
    const suggestions = this.filteredSlashSuggestions();
    const slashOpen = suggestions.length > 0;

    if (action.type === "interrupt") {
      const reject = this.inputReject;
      this.finishReadLine();
      reject?.(new ExitRequestedError());
      return;
    }
    if (action.type === "enter") {
      const value = slashOpen
        ? resolveSlashSubmitValue(
            this.inputBuffer,
            suggestions,
            this.slashSuggestSelected,
          )
        : this.inputBuffer;
      const resolve = this.inputResolve;
      this.inputHistory.commit(value);
      this.inputHistory.resetBrowse();
      this.finishReadLine();
      process.stdout.write(HIDE_CURSOR);
      this.drawFooter("", plain ? undefined : placeholder);
      resolve?.(value);
      return;
    }
    if (slashOpen && action.type === "historyUp") {
      this.slashSuggestSelected = Math.max(0, this.slashSuggestSelected - 1);
      this.refreshInputFooter(plain, placeholder);
      return;
    }
    if (slashOpen && action.type === "historyDown") {
      this.slashSuggestSelected = Math.min(
        suggestions.length - 1,
        this.slashSuggestSelected + 1,
      );
      this.refreshInputFooter(plain, placeholder);
      return;
    }
    if (slashOpen && (action.type === "tab" || action.type === "shiftTab")) {
      this.applySlashTabComplete(suggestions);
      this.refreshInputFooter(plain, placeholder);
      return;
    }
    if (action.type === "tab") {
      return;
    }
    if (action.type === "historyUp") {
      const next = this.inputHistory.browseUp(this.inputBuffer);
      if (next !== null) {
        this.inputBuffer = next;
        this.inputCursor = next.length;
      }
    } else if (action.type === "historyDown") {
      const next = this.inputHistory.browseDown();
      if (next !== null) {
        this.inputBuffer = next;
        this.inputCursor = next.length;
      }
    } else if (action.type === "shiftTab") {
      this.cyclePermissionMode();
      return;
    } else if (action.type === "backspace") {
      if (this.inputCursor > 0) {
        const prev = prevCodePointIndex(this.inputBuffer, this.inputCursor);
        this.inputBuffer =
          this.inputBuffer.slice(0, prev) + this.inputBuffer.slice(this.inputCursor);
        this.inputCursor = prev;
      }
      if (this.inputBuffer.length === 0 && !this.exitHintTimer) {
        this.shortcutsOverride = null;
      }
    } else if (action.type === "cursorLeft") {
      this.inputCursor = prevCodePointIndex(this.inputBuffer, this.inputCursor);
    } else if (action.type === "cursorRight") {
      this.inputCursor = nextCodePointIndex(this.inputBuffer, this.inputCursor);
    } else if (action.type === "cursorHome") {
      this.inputCursor = 0;
    } else if (action.type === "cursorEnd") {
      this.inputCursor = this.inputBuffer.length;
    } else if (action.type === "paste") {
      void this.handlePaste();
    } else if (action.type === "pasteText") {
      void this.handlePasteContent(action.text);
    } else if (action.type === "char") {
      this.lastCtrlCAt = 0;
      this.clearExitHint();
      if (this.inputHistory.isBrowsing()) {
        this.inputHistory.resetBrowse();
      }
      this.inputBuffer =
        this.inputBuffer.slice(0, this.inputCursor) +
        action.char +
        this.inputBuffer.slice(this.inputCursor);
      this.inputCursor += action.char.length;
    } else {
      // enter / interrupt handled above
    }

    this.refreshInputFooter(plain, placeholder);
  }

  private applySlashTabComplete(suggestions: SystemSkillEntry[]): void {
    const entry = suggestions[this.slashSuggestSelected] ?? suggestions[0];
    if (!entry) return;
    this.inputBuffer = completeSlashSuggestion(this.inputBuffer, entry);
    this.inputCursor = this.inputBuffer.length;
    this.slashSuggestSelected = 0;
    this.lastSlashSuggestQuery = slashSuggestQuery(this.inputBuffer, this.inputCursor) ?? "";
  }

  private filteredSlashSuggestions(): SystemSkillEntry[] {
    if (!this.readingLine || this.readingChoice || this.wizardMode || this.readingWorkflowsPanel) {
      return [];
    }
    if (!shouldShowSlashMenu(this.inputBuffer, this.inputCursor)) return [];
    const query = slashSuggestQuery(this.inputBuffer, this.inputCursor);
    if (query === null) return [];
    return filterSlashSuggestions(query, this.slashInvokableSkills);
  }

  private syncSlashSuggestSelection(suggestions: SystemSkillEntry[]): void {
    const query = slashSuggestQuery(this.inputBuffer, this.inputCursor) ?? "";
    if (query !== this.lastSlashSuggestQuery) {
      this.slashSuggestSelected = 0;
      this.lastSlashSuggestQuery = query;
    }
    if (!suggestions.length) {
      this.slashSuggestSelected = 0;
      return;
    }
    if (this.slashSuggestSelected >= suggestions.length) {
      this.slashSuggestSelected = suggestions.length - 1;
    }
  }

  private updateSlashSuggestFooterHeight(suggestions: SystemSkillEntry[]): void {
    if (!suggestions.length) {
      this.activeFooterHeight = this.defaultFooterHeight;
      this.slashSuggestMaxVisible = 4;
      return;
    }
    const { cols } = getTerminalSize();
    const plan = planSlashSuggestFooter({
      skills: suggestions,
      selectedIndex: this.slashSuggestSelected,
      cols,
      maxHeight: this.maxFooterHeight(),
      inputFooterHeight: this.defaultFooterHeight,
    });
    this.activeFooterHeight = plan.height;
    this.slashSuggestMaxVisible = plan.maxVisible > 0 ? plan.maxVisible : 4;
  }

  private refreshInputFooter(plain: boolean, placeholder?: string): void {
    const suggestions = this.filteredSlashSuggestions();
    this.syncSlashSuggestSelection(suggestions);
    const prevHeight = this.activeFooterHeight;
    this.updateSlashSuggestFooterHeight(suggestions);

    if (suggestions.length > 0 || prevHeight !== this.activeFooterHeight) {
      this.invalidateContentCache();
      this.redrawContent();
      if (this.effectiveHeaderMode() === "standard") {
        this.refreshHeader();
      }
      return;
    }

    this.drawFooter(
      this.inputBuffer,
      this.inputBuffer ? undefined : plain ? undefined : placeholder,
    );
  }

  private async handlePaste(): Promise<void> {
    if (!this.sessionId) return;
    const clip = await readClipboardImage();
    if (clip) {
      await this.insertPastedImage(clip.buffer, clip.mimeType);
      return;
    }
    const text = await readClipboardText();
    if (!text) return;
    await this.handlePasteContent(text);
  }

  private async handlePasteContent(raw: string): Promise<void> {
    if (!this.sessionId) return;
    const text = normalizeClipboardPath(raw);
    if (!text) return;
    if (text.includes("\n")) {
      this.insertAtCursor(text);
      return;
    }
    const leading = await findLeadingAbsolutePath(text);
    if (!leading) {
      this.insertAtCursor(text);
      return;
    }
    if (isImagePath(leading.path)) {
      await this.insertPastedImageFromPath(leading.path);
      if (leading.rest) this.insertAtCursor(leading.rest);
      return;
    }
    this.insertAtCursor(`${leading.path} `);
    if (leading.rest) this.insertAtCursor(leading.rest);
  }

  private async insertPastedImage(imageBuffer: Buffer, mimeType: string): Promise<void> {
    if (!this.sessionId) return;
    const index = this.allocateImageIndex();
    const marker = `${formatImageMarker(index)} `;
    const attachment = await storeClipboardImage(this.sessionId, imageBuffer, mimeType);
    this.pendingImages.push({ index, attachment });
    this.insertAtCursor(marker);
  }

  private async insertPastedImageFromPath(path: string): Promise<void> {
    if (!this.sessionId) return;
    const index = this.allocateImageIndex();
    const marker = `${formatImageMarker(index)} `;
    const attachment = await storeUserAttachment(this.sessionId, path);
    this.pendingImages.push({ index, attachment });
    this.insertAtCursor(marker);
  }

  private allocateImageIndex(): number {
    const index = Math.max(this.nextImageIndex, nextImageIndexFromText(this.inputBuffer));
    this.nextImageIndex = index + 1;
    return index;
  }

  private insertAtCursor(text: string): void {
    this.inputBuffer =
      this.inputBuffer.slice(0, this.inputCursor) + text + this.inputBuffer.slice(this.inputCursor);
    this.inputCursor += text.length;
    if (this.readingLine) {
      this.refreshInputFooter(this.readLinePlain, this.readLinePlaceholder);
    }
  }

  private finishReadLine(): void {
    this.inputResolve = null;
    this.inputReject = null;
    this.readingLine = false;
    this.inputBuffer = "";
    this.inputCursor = 0;
    this.readLinePlaceholder = undefined;
    this.slashSuggestSelected = 0;
    this.lastSlashSuggestQuery = "";
    this.slashFooterDrawExtent = { top: 0, rows: 0 };
    this.slashSuggestMaxVisible = 4;
    if (!this.readingChoice && !this.readingWorkflowsPanel) {
      this.activeFooterHeight = this.defaultFooterHeight;
    }
  }

  private scrollableHeaderLines(): RenderLine[] {
    if (this.effectiveHeaderMode() !== "mini") return [];
    return this.headerLines.map((text) => ({ text }));
  }

  private allRenderLines(): RenderLine[] {
    if (this.planReviewMode) {
      return this.buildPlanReviewContentLines();
    }
    if (this.workflowConfirmMode) {
      return this.buildWorkflowConfirmContentLines();
    }
    const { cols } = getTerminalSize();
    const now = Date.now();
    const lines: RenderLine[] = [...this.scrollableHeaderLines(), CHAT_EDGE_LINE];
    for (const text of this.plainLines) {
      lines.push({ text });
    }
    for (const turn of this.turns) {
      lines.push(...renderTurnToLines(turn, cols, { now }));
    }
    if (this.activeTurn) {
      lines.push(...renderTurnToLines(this.activeTurn, cols, { now, isActive: true }));
    }
    if (lines.length > 1) {
      lines.push(CHAT_EDGE_LINE);
    }
    return lines;
  }

  /** Pinned rows at the bottom of the content area (above input). */
  private pinnedBottomLines(): string[] {
    if (this.planReviewMode || this.workflowConfirmMode) return [];
    const lines: string[] = [];
    if (this.workflowWaitingCount > 0) {
      lines.push(renderWorkflowWaitingLine(this.workflowWaitingCount));
    }
    if (!this.activeTurn || this.activeTurn.phase === "done") return lines;
    const now = Date.now();
    lines.push(renderSmooshingLine(this.activeTurn, now));
    if (this.tipText) {
      lines.push(renderTipLine(this.tipText));
    }
    return lines;
  }

  private scrollableContentHeight(): number {
    return Math.max(1, this.contentHeight - this.pinnedBottomLines().length);
  }

  private maxScrollOffset(): number {
    return Math.max(0, this.allRenderLines().length - this.scrollableContentHeight());
  }

  private isAtBottom(): boolean {
    return this.scrollOffset >= this.maxScrollOffset();
  }

  private scrollBy(delta: number): void {
    const max = this.maxScrollOffset();
    const next = Math.max(0, Math.min(max, this.scrollOffset + delta));
    if (next === this.scrollOffset) return;
    this.scrollOffset = next;
    this.followBottom = this.isAtBottom();
    this.invalidateContentCache();
  }

  private invalidateContentCache(): void {
    this.lastContentRendered = [];
  }

  private scrollToBottom(): void {
    this.scrollOffset = this.maxScrollOffset();
    this.followBottom = true;
  }

  /** Pin to bottom only while the user has not scrolled up to read history. */
  private maybeScrollToBottom(): void {
    if (this.followBottom) {
      this.scrollOffset = this.maxScrollOffset();
    }
  }

  appendContent(text: string): void {
    const { cols } = getTerminalSize();
    this.plainLines.push(...renderRichContentLines(text, cols));
    this.maybeScrollToBottom();
    this.invalidateContentCache();
    this.redrawContent();
  }

  /** Record a completed AskUserQuestion answer (collapsed by default in the transcript). */
  appendChoiceResult(
    item: AskUserQuestionItem,
    answer: string,
    opts?: { declined?: boolean },
  ): void {
    if (!this.activeTurn) {
      this.appendContent(`${item.question} → ${answer}`);
      return;
    }
    this.finalizeOpenThinking();
    const entry: ChoiceTimelineEntry = {
      type: "choice",
      id: `choice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      header: item.header,
      question: item.question,
      answer,
      options: item.options,
      multiSelect: item.multiSelect,
      declined: opts?.declined,
    };
    this.activeTurn.timeline.push(entry);
    this.activeTurn.answerText = "";
    this.maybeScrollToBottom();
    this.invalidateContentCache();
    this.redrawContent();
  }

  /** Record multiple AskUserQuestion answers as one grouped block (wizard / plan mode). */
  appendChoiceGroupResult(
    items: Array<{
      item: AskUserQuestionItem;
      answer: string;
      declined?: boolean;
    }>,
  ): void {
    if (items.length === 0) return;
    if (!this.activeTurn) {
      for (const row of items) {
        this.appendContent(`${row.item.question} → ${row.answer}`);
      }
      return;
    }
    this.finalizeOpenThinking();
    const entry: ChoiceGroupTimelineEntry = {
      type: "choice-group",
      id: `choice-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      items: items.map(({ item, answer, declined }) => ({
        header: item.header,
        question: item.question,
        answer,
        options: item.options,
        multiSelect: item.multiSelect,
        declined,
      })),
    };
    this.activeTurn.timeline.push(entry);
    this.activeTurn.answerText = "";
    this.maybeScrollToBottom();
    this.invalidateContentCache();
    this.redrawContent();
  }

  /** Chronological inline events — thinking, AskUserQuestion, etc. */
  appendTurnTimeline(text: string): void {
    if (!this.activeTurn) {
      this.appendContent(text);
      return;
    }
    this.finalizeOpenThinking();
    const lines = text.trim().split("\n").filter((line) => line.length > 0);
    this.activeTurn.timeline.push({ type: "event", lines });
    this.activeTurn.answerText = "";
    this.maybeScrollToBottom();
    this.invalidateContentCache();
    this.redrawContent();
  }

  beginToolCall(name: string, detail: string): void {
    if (!this.activeTurn) {
      this.appendContent(`${name} ${detail}`.trim());
      return;
    }
    this.finalizeOpenThinking();
    const entry: ToolCallTimelineEntry = {
      type: "tool",
      id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      detail,
      status: "waiting",
      dotFrame: 0,
    };
    this.activeTurn.timeline.push(entry);
    this.activeTurn.answerText = "";
    this.maybeScrollToBottom();
    this.invalidateContentCache();
    this.redrawContent();
  }

  finishToolCall(name: string, status: string, errorDetail?: string, output?: string): void {
    const entry = this.findLastWaitingToolEntry();
    if (!entry) return;
    entry.status = status === "success" ? "success" : "error";
    if (errorDetail) entry.errorDetail = errorDetail;
    if (output) entry.output = output;
    this.invalidateContentCache();
    this.redrawContent();
  }

  /** Refresh the most recently finished tool entry output (e.g. async plan file read). */
  updateLastToolOutput(output: string): void {
    const turn = this.activeTurn;
    if (!turn) return;
    for (let i = turn.timeline.length - 1; i >= 0; i--) {
      const entry = turn.timeline[i];
      if (entry?.type === "tool" && entry.status !== "waiting") {
        entry.output = output;
        this.invalidateContentCache();
        this.redrawContent();
        return;
      }
    }
  }

  private findLastWaitingToolEntry(): ToolCallTimelineEntry | undefined {
    const turn = this.activeTurn;
    if (!turn) return undefined;
    for (let i = turn.timeline.length - 1; i >= 0; i--) {
      const entry = turn.timeline[i];
      if (entry?.type === "tool" && entry.status === "waiting") return entry;
    }
    return undefined;
  }

  private hasWaitingTools(): boolean {
    const turn = this.activeTurn;
    if (!turn) return false;
    return turn.timeline.some((e) => e.type === "tool" && e.status === "waiting");
  }

  private tickWaitingToolDots(): void {
    const turn = this.activeTurn;
    if (!turn) return;
    for (const entry of turn.timeline) {
      if (entry.type === "tool" && entry.status === "waiting") {
        entry.dotFrame = (entry.dotFrame + 1) % 4;
      }
    }
  }

  toggleToolError(turnId: string, toolId: string): void {
    const turn = this.findTurn(turnId);
    if (!turn) return;
    const entry = turn.timeline.find(
      (e): e is ToolCallTimelineEntry => e.type === "tool" && e.id === toolId,
    );
    if (!entry || entry.status !== "error" || !entry.errorDetail) return;
    entry.errorExpanded = !entry.errorExpanded;
    this.invalidateContentCache();
    this.redrawContent();
  }

  togglePlanTool(turnId: string, toolId: string): void {
    const turn = this.findTurn(turnId);
    if (!turn) return;
    const key = `plan:${toolId}`;
    if (turn.expandedToolGroups.has(key)) {
      turn.expandedToolGroups.delete(key);
    } else {
      turn.expandedToolGroups.add(key);
    }
    this.invalidateContentCache();
    this.redrawContent();
  }

  private ensureOpenThinkingEntry(): Extract<TurnTimelineEntry, { type: "thinking" }> | null {
    const turn = this.activeTurn!;
    const last = turn.timeline[turn.timeline.length - 1];
    if (last?.type === "thinking" && last.endedAt === null) return last;

    // One "Thought for …" block per user turn (tool loops may stream reasoning again).
    if (turn.timeline.some((e) => e.type === "thinking")) return null;

    const now = Date.now();
    const entry: Extract<TurnTimelineEntry, { type: "thinking" }> = {
      type: "thinking",
      text: "",
      startedAt: now,
      lastChunkAt: now,
      endedAt: null,
    };
    turn.timeline.push(entry);
    return entry;
  }

  private finalizeOpenThinking(): void {
    if (!this.activeTurn) return;
    for (let i = this.activeTurn.timeline.length - 1; i >= 0; i--) {
      const entry = this.activeTurn.timeline[i];
      if (entry?.type !== "thinking" || entry.endedAt !== null) continue;
      if (!entry.text.trim()) {
        this.activeTurn.timeline.splice(i, 1);
        return;
      }
      entry.endedAt = entry.lastChunkAt;
      if (!this.activeTurn.thinkingEndedAt) {
        this.activeTurn.thinkingEndedAt = entry.endedAt;
      }
      return;
    }
  }

  private ensureOpenAnswerEntry(): Extract<TurnTimelineEntry, { type: "answer" }> {
    const turn = this.activeTurn!;
    const last = turn.timeline[turn.timeline.length - 1];
    if (last?.type === "answer") return last;
    const entry: Extract<TurnTimelineEntry, { type: "answer" }> = { type: "answer", text: "" };
    turn.timeline.push(entry);
    return entry;
  }

  beginTurn(userText: string): void {
    this.turnExitRequested = false;
    this.activeTurn = {
      id: `turn-${Date.now()}`,
      userText,
      answerText: "",
      thinkingExpanded: false,
      thinkingStartedAt: Date.now(),
      thinkingEndedAt: null,
      finishedAt: null,
      doneVerb: null,
      generatingVerb: pickGeneratingVerb(),
      outputTokens: 0,
      phase: "thinking",
      timeline: [],
      expandedToolGroups: new Set(),
      expandedChoices: new Set(),
      pulseFrame: 0,
    };
    this.tipText = null;
    this.followBottom = true;
    this.startTurnTick();
    this.scrollToBottom();
    this.invalidateContentCache();
    this.updateGeneratingFooter();
    this.redrawContent();
  }

  appendThinking(text: string): void {
    if (!this.activeTurn || !text) return;
    const entry = this.ensureOpenThinkingEntry();
    if (!entry) return;
    this.activeTurn.pulseFrame = (this.activeTurn.pulseFrame + 1) % 4;
    entry.text += text;
    entry.lastChunkAt = Date.now();
    this.activeTurn.phase = "thinking";
    this.updateGeneratingFooter();
    this.invalidateContentCache();
    this.redrawContent();
  }

  /** Stop the thought timer when the model finishes streaming reasoning. */
  endThinkingStream(): void {
    if (!this.activeTurn) return;
    this.finalizeOpenThinking();
    this.invalidateContentCache();
    this.redrawContent();
  }

  appendAnswer(text: string): void {
    if (!this.activeTurn) return;
    this.finalizeOpenThinking();
    if (!this.activeTurn.thinkingEndedAt) {
      this.activeTurn.thinkingEndedAt = Date.now();
      this.activeTurn.phase = "answering";
    }
    this.activeTurn.pulseFrame = (this.activeTurn.pulseFrame + 1) % 4;
    this.activeTurn.answerText += text;
    this.ensureOpenAnswerEntry().text = this.activeTurn.answerText;
    this.updateGeneratingFooter();
    this.invalidateContentCache();
    this.maybeScrollToBottom();
    this.redrawContent();
  }

  /** Remove streamed answer chars (AskUserQuestion guard retry). */
  rollbackAnswer(charCount: number): void {
    if (!this.activeTurn || charCount <= 0) return;
    const nextLen = Math.max(0, this.activeTurn.answerText.length - charCount);
    this.activeTurn.answerText = this.activeTurn.answerText.slice(0, nextLen);
    const last = this.activeTurn.timeline[this.activeTurn.timeline.length - 1];
    if (last?.type === "answer") {
      last.text = this.activeTurn.answerText;
    }
    if (!this.activeTurn.answerText) {
      this.activeTurn.thinkingEndedAt = null;
      this.activeTurn.phase = "thinking";
    }
    this.updateGeneratingFooter();
    this.invalidateContentCache();
    this.redrawContent();
  }

  setTurnTokens(tokens: number): void {
    if (!this.activeTurn) return;
    this.activeTurn.outputTokens = tokens;
    this.updateGeneratingFooter();
    this.invalidateContentCache();
    this.redrawContent();
  }

  finishTurn(): void {
    if (!this.activeTurn) return;
    this.finalizeOpenThinking();
    if (!this.turnHasVisibleAnswer(this.activeTurn)) {
      const hasChoices = this.activeTurn.timeline.some(
        (e) =>
          (e.type === "choice" && e.answer.trim() && !e.declined) ||
          (e.type === "choice-group" &&
            e.items.some((item) => item.answer.trim() && !item.declined)),
      );
      if (hasChoices) {
        this.activeTurn.timeline.push({
          type: "event",
          lines: ["（模型未返回回复，你可以继续在下方输入。）"],
        });
      }
    }
    this.activeTurn.phase = "done";
    this.activeTurn.finishedAt = Date.now();
    this.activeTurn.doneVerb = pickDoneVerb();
    if (!this.activeTurn.thinkingEndedAt) {
      this.activeTurn.thinkingEndedAt = this.activeTurn.finishedAt;
    }
    this.turns.push(this.activeTurn);
    this.activeTurn = null;
    this.tipText = null;
    this.stopTurnTick();
    if (!this.exitHintTimer) {
      this.shortcutsOverride = null;
    }
    this.maybeScrollToBottom();
    this.invalidateContentCache();
    this.redrawContent();
  }

  private findTurn(turnId: string): ChatTurn | undefined {
    if (this.activeTurn?.id === turnId) return this.activeTurn;
    return this.turns.find((t) => t.id === turnId);
  }

  private turnHasVisibleAnswer(turn: ChatTurn): boolean {
    if (turn.answerText.trim()) return true;
    return turn.timeline.some(
      (e) => e.type === "answer" && e.text.trim().length > 0,
    );
  }

  toggleThought(turnId: string): void {
    const turn = this.findTurn(turnId);
    if (!turn) return;
    turn.thinkingExpanded = !turn.thinkingExpanded;
    this.invalidateContentCache();
    const max = this.maxScrollOffset();
    if (this.scrollOffset > max) {
      this.scrollOffset = max;
    }
    this.redrawContent();
  }

  toggleToolGroup(turnId: string, groupId: string): void {
    const turn = this.findTurn(turnId);
    if (!turn) return;
    toggleToolGroupExpanded(turn, groupId);
    this.invalidateContentCache();
    const max = this.maxScrollOffset();
    if (this.scrollOffset > max) {
      this.scrollOffset = max;
    }
    this.redrawContent();
  }

  toggleChoice(turnId: string, choiceId: string): void {
    const turn = this.findTurn(turnId);
    if (!turn) return;
    toggleChoiceExpanded(turn, choiceId);
    this.invalidateContentCache();
    const max = this.maxScrollOffset();
    if (this.scrollOffset > max) {
      this.scrollOffset = max;
    }
    this.redrawContent();
  }

  handleClick(row: number, _col: number): void {
    const contentTop = this.headerHeight + 1;
    const index = row - contentTop;
    const scrollH = this.scrollableContentHeight();
    if (index < 0 || index >= scrollH) return;
    const all = this.allRenderLines();
    const maxOffset = this.maxScrollOffset();
    const offset = Math.min(this.scrollOffset, maxOffset);
    const visible = all.slice(offset, offset + scrollH);
    const line = visible[index];
    if (line && isThoughtSummaryLine(line) && line.meta) {
      this.toggleThought(line.meta.turnId);
      return;
    }
    if (line && line.meta && isToolGroupToggleLine(line.meta) && line.meta.groupId) {
      this.toggleToolGroup(line.meta.turnId, line.meta.groupId);
      return;
    }
    if (line && line.meta && isChoiceToggleLine(line.meta) && line.meta.choiceId) {
      this.toggleChoice(line.meta.turnId, line.meta.choiceId);
      return;
    }
    if (line && isToolErrorToggleLine(line.meta) && line.meta?.toolId) {
      this.toggleToolError(line.meta.turnId, line.meta.toolId);
      return;
    }
    if (line && isPlanToolToggleLine(line.meta) && line.meta?.toolId) {
      this.togglePlanTool(line.meta.turnId, line.meta.toolId);
    }
  }

  private startTurnTick(): void {
    this.stopTurnTick();
    this.turnTickTimer = setInterval(() => this.onTurnTick(), 400);
  }

  private stopTurnTick(): void {
    if (this.turnTickTimer) {
      clearInterval(this.turnTickTimer);
      this.turnTickTimer = null;
    }
  }

  private onTurnTick(): void {
    if (!this.activeTurn || this.activeTurn.phase === "done") return;
    if (this.readingConfirm) return;
    if (this.planReviewMode) return;
    if (this.workflowConfirmMode) return;
    this.activeTurn.pulseFrame = (this.activeTurn.pulseFrame + 1) % 4;
    const elapsed = (Date.now() - this.activeTurn.thinkingStartedAt) / 1000;
    if (elapsed >= 3 && !this.tipText) {
      this.tipText =
        CHAT_TIPS[Math.floor(Math.random() * CHAT_TIPS.length)] ?? CHAT_TIPS[0]!;
    }
    if (this.hasWaitingTools()) {
      this.tickWaitingToolDots();
    }
    this.invalidateContentCache();
    if (this.activeTurn && !this.activeTurn.thinkingExpanded) {
      this.maybeScrollToBottom();
    }
    this.updateGeneratingFooter();
    this.redrawContent();
  }

  private updateGeneratingFooter(): void {
    if (this.exitHintTimer) return;
    if (this.readingConfirm) return;
    if (this.planReviewMode) return;
    if (this.workflowConfirmMode) return;
    if (this.activeTurn && this.activeTurn.phase !== "done") {
      this.shortcutsOverride = renderGeneratingStatus(this.activeTurn);
    } else if (!this.exitHintTimer) {
      this.shortcutsOverride = null;
    }
  }

  redraw(): void {
    if (!this.active) return;
    if (this.readingWorkflowsPanel) {
      process.stdout.write(CLEAR_SCROLLBACK + "\x1b[2J");
      this.drawWorkflowsPanel();
      return;
    }
    const mode = this.effectiveHeaderMode();
    if (this.lastEffectiveHeaderMode !== null && this.lastEffectiveHeaderMode !== mode) {
      this.lastPaintedHeaderLines = 0;
    }
    this.lastEffectiveHeaderMode = mode;
    this.invalidateContentCache();
    if (this.followBottom) {
      this.scrollToBottom();
    } else {
      const max = this.maxScrollOffset();
      if (this.scrollOffset > max) this.scrollOffset = max;
    }
    const { cols } = getTerminalSize();
    let out = moveTo(1, 1) + CLEAR_SCROLLBACK + "\x1b[2J";

    if (this.effectiveHeaderMode() === "standard") {
      for (let i = 0; i < this.headerLines.length; i++) {
        out += moveTo(i + 1);
        out += clearLine();
        out += padToWidth(this.headerLines[i]!, cols);
      }
      for (let i = this.headerLines.length; i < this.lastPaintedHeaderLines; i++) {
        out += moveTo(i + 1);
        out += clearLine();
      }
      this.lastPaintedHeaderLines = this.headerLines.length;
    } else if (this.lastPaintedHeaderLines > 0) {
      for (let i = 0; i < this.lastPaintedHeaderLines; i++) {
        out += moveTo(i + 1);
        out += clearLine();
      }
      this.lastPaintedHeaderLines = 0;
    }

    out += this.renderContentBuffer(cols);
    process.stdout.write(out);
    if (this.workflowConfirmMode) {
      this.drawWorkflowConfirmFooter();
    } else if (this.planReviewMode) {
      this.drawPlanReviewFooter();
    } else if (this.readingWorkflowsPanel) {
      this.drawWorkflowsPanel();
    } else if (this.readingChoice) {
      this.drawActiveChoiceFooter();
    } else {
      this.drawFooter(this.inputBuffer, this.readLinePlaceholder);
    }
    this.viewportNeedsFullRedraw = false;
  }

  /** Repaint the welcome header after provider/model changes from Web UI. */
  refreshHeader(): void {
    if (!this.active) return;
    if (this.effectiveHeaderMode() === "mini") {
      this.invalidateContentCache();
      this.redrawContent();
      return;
    }
    const { cols } = getTerminalSize();
    let out = "";
    for (let i = 0; i < this.headerLines.length; i++) {
      out += moveTo(i + 1);
      out += clearLine();
      out += padToWidth(this.headerLines[i]!, cols);
    }
    process.stdout.write(out);
  }

  private visibleContentLines(): string[] {
    const all = this.allRenderLines().map((line) => line.text);
    const scrollH = this.scrollableContentHeight();
    if (all.length <= scrollH) return all;
    const maxOffset = this.maxScrollOffset();
    const offset = Math.min(this.scrollOffset, maxOffset);
    return all.slice(offset, offset + scrollH);
  }

  private renderContentBuffer(cols: number, incremental = false): string {
    const pinned = this.pinnedBottomLines();
    const scrollH = this.scrollableContentHeight();
    const visible = this.visibleContentLines();
    let out = "";

    for (let i = 0; i < scrollH; i++) {
      const line = visible[i] ?? "";
      const padded = padToWidth(line, cols);
      if (incremental && this.lastContentRendered[i] === padded) continue;
      this.lastContentRendered[i] = padded;
      const row = this.headerHeight + 1 + i;
      out += moveTo(row);
      out += clearLine();
      out += padded;
    }

    for (let j = 0; j < pinned.length; j++) {
      const idx = scrollH + j;
      const padded = padToWidth(pinned[j]!, cols);
      if (incremental && this.lastContentRendered[idx] === padded) continue;
      this.lastContentRendered[idx] = padded;
      const row = this.headerHeight + 1 + idx;
      out += moveTo(row);
      out += clearLine();
      out += padded;
    }

    for (let i = scrollH + pinned.length; i < this.contentHeight; i++) {
      if (incremental && this.lastContentRendered[i] === "") continue;
      this.lastContentRendered[i] = "";
      const row = this.headerHeight + 1 + i;
      out += moveTo(row);
      out += clearLine();
    }

    this.lastContentRendered.length = this.contentHeight;
    return out;
  }

  /** Draw the correct footer while a choice picker or question wizard is active. */
  private drawActiveChoiceFooter(): void {
    if (this.wizardMode) {
      this.drawWizardPanel();
    } else {
      this.drawChoicePanel();
    }
  }

  private redrawContent(): void {
    if (!this.active) return;
    if (this.viewportNeedsFullRedraw) {
      this.redraw();
      return;
    }
    if (this.lastContentRendered.length !== this.contentHeight) {
      this.invalidateContentCache();
    }
    if (this.readingWorkflowsPanel) {
      this.drawWorkflowsPanel();
      return;
    }
    if (this.effectiveHeaderMode() === "standard") {
      this.refreshHeader();
    }
    const { cols } = getTerminalSize();
    process.stdout.write(this.renderContentBuffer(cols, true));
    if (this.workflowConfirmMode) {
      this.drawWorkflowConfirmFooter();
    } else if (this.planReviewMode) {
      this.drawPlanReviewFooter();
    } else if (this.readingChoice) {
      this.drawActiveChoiceFooter();
    } else {
      this.drawFooter(this.inputBuffer, this.readLinePlaceholder);
    }
  }

  private clearExitHint(): void {
    if (this.exitHintTimer) {
      clearTimeout(this.exitHintTimer);
      this.exitHintTimer = null;
    }
    this.shortcutsOverride = null;
  }

  private showExitHint(): void {
    this.clearExitHint();
    this.shortcutsOverride = `${ansi.muted}${EXIT_HINT}${ansi.reset}`;
    this.exitHintTimer = setTimeout(() => {
      this.exitHintTimer = null;
      this.shortcutsOverride = null;
      if (this.active) {
        this.drawFooter(this.inputBuffer, this.readLinePlaceholder);
      }
    }, EXIT_HINT_MS);
  }

  private renderInputLine(value: string, placeholder?: string): string {
    if (value) {
      return `${ansi.text}${ansi.bold}>${ansi.reset} ${value}`;
    }
    return placeholder
      ? renderClaudeInputLine(placeholder)
      : `${ansi.text}${ansi.bold}>${ansi.reset} `;
  }

  private inputCursorCol(value: string, cursor: number): number {
    const before = value.slice(0, cursor);
    const plain = value ? `> ${before}` : "> ";
    return 1 + displayWidth(plain);
  }

  private footerShortcutsLine(inputValue: string): string {
    if (this.permissionMode === "plan" && !this.readingConfirm && !this.planReviewMode && !this.workflowConfirmMode) {
      return renderPlanModeFooterHint();
    }
    if (this.readingLine) {
      if (inputValue.length > 0) return "";
      if (this.exitHintTimer && this.shortcutsOverride) return this.shortcutsOverride;
      if (
        this.workflowFooter &&
        (this.workflowFooter.status === "running" || this.workflowFooter.status === "pending")
      ) {
        const { cols } = getTerminalSize();
        return renderWorkflowFooterLine(this.workflowFooter, cols);
      }
      return this.footerParts.shortcuts;
    }
    if (this.shortcutsOverride) return this.shortcutsOverride;
    return this.footerParts.shortcuts;
  }

  private footerTopSeparator(cols: number): string {
    if (this.readingLine && this.inputHistory.isBrowsing()) {
      const label = `History ${this.inputHistory.indicatorPosition()}/${this.inputHistory.length}`;
      return renderHistorySeparator(label, cols);
    }
    return inputFooterSeparator(cols);
  }

  private drawFooter(inputValue: string, placeholder?: string): void {
    const { cols, rows } = getTerminalSize();
    const top = this.footerTop;
    const shortcuts = this.footerShortcutsLine(inputValue);
    const suggestions =
      this.readingLine && !this.readingChoice && !this.wizardMode && !this.readingWorkflowsPanel
        ? this.filteredSlashSuggestions()
        : [];

    const inputBlock = [
      padToWidth(this.footerTopSeparator(cols), cols),
      padToWidth(this.renderInputLine(inputValue, placeholder), cols),
      padToWidth(inputFooterSeparator(cols), cols),
      padToWidth(suggestions.length ? SLASH_SUGGEST_HINT : shortcuts, cols),
    ];

    const footerRows = suggestions.length
      ? [
          padToWidth(footerSeparator(cols), cols),
          ...renderSlashSuggestLines({
            skills: suggestions,
            selectedIndex: this.slashSuggestSelected,
            cols,
            maxVisible: this.slashSuggestMaxVisible,
          }).map((line) => padToWidth(line, cols)),
          padToWidth(footerSeparator(cols), cols),
          ...inputBlock,
        ]
      : inputBlock;

    const paintedEnd = top + footerRows.length;
    const prevExtent = this.slashFooterDrawExtent;
    let out = "";
    for (let i = 0; i < footerRows.length; i++) {
      out += moveTo(top + i);
      out += clearLine();
      out += footerRows[i]!;
    }

    const prevBottom = prevExtent.top > 0 ? prevExtent.top + prevExtent.rows : 0;
    for (let i = paintedEnd; i < prevBottom; i++) {
      if (i > rows) break;
      out += moveTo(i);
      out += clearLine();
    }
    for (let i = paintedEnd; i <= rows; i++) {
      out += moveTo(i);
      out += clearLine();
    }

    if (suggestions.length) {
      this.slashFooterDrawExtent = { top, rows: footerRows.length };
    } else {
      this.slashFooterDrawExtent = { top: 0, rows: 0 };
    }

    process.stdout.write(out);
    if (this.inputResolve) {
      this.inputRow = top + footerRows.length - inputBlock.length + 1;
      const col = Math.min(cols, this.inputCursorCol(inputValue, this.inputCursor));
      process.stdout.write(moveTo(this.inputRow, col));
      process.stdout.write(SHOW_CURSOR);
    }
  }

  /** Reset footer height after closing a choice picker or question wizard. */
  private restoreDefaultFooter(): void {
    this.activeFooterHeight = this.defaultFooterHeight;
    this.invalidateContentCache();
    if (!this.active) return;
    this.redrawContent();
    if (this.activeTurn && this.activeTurn.phase !== "done") {
      this.updateGeneratingFooter();
    }
  }

  private teardownInput(): void {
    if (this.workflowConfirmResolve) {
      this.finishWorkflowConfirm({ action: "cancel" });
    }
    if (this.planReviewResolve) {
      this.finishPlanReview({ action: "cancel" });
    }
    this.closeWorkflowsPanel();
    this.finishChoice();
    this.finishReadLine();
  }

  /** Multi-question AskUserQuestion wizard with chip navigation (Claude-style). */
  async readQuestionWizard(questions: AskUserQuestionItem[]): Promise<AskUserQuestionResult> {
    this.wizardQuestions = questions;
    this.wizardAnswers = {};
    this.wizardAnnotations = {};
    this.wizardFocus = 0;
    this.choiceSelected = 0;
    this.syncWizardRows();
    this.choiceShowHeader = true;
    this.lastCtrlCAt = 0;

    return new Promise((resolve, reject) => {
      this.wizardResolve = resolve;
      this.wizardReject = reject;
      this.wizardMode = true;
      this.readingChoice = true;
      this.updateWizardFooterHeight();
      this.redrawWizardPanel();
    });
  }

  /** Interactive choice menu — single-select or multi-select (checkbox + Submit). */
  async readChoice(options: ReadChoiceOptions): Promise<ChoiceRow> {
    this.wizardMode = false;
    this.choiceHeader = options.header;
    this.choiceQuestion = options.question;
    this.choiceRows = options.rows;
    this.choiceSelected = 0;
    this.choiceQuestionIndex = options.questionIndex ?? 0;
    this.choiceQuestionTotal = options.questionTotal ?? 1;
    this.choiceShowHeader = this.choiceQuestionTotal > 1 || Boolean(options.multiSelect);
    this.choiceMultiSelect = Boolean(options.multiSelect);
    this.choiceCheckedOptions = new Set();
    this.lastCtrlCAt = 0;

    return new Promise((resolve, reject) => {
      this.choiceResolve = resolve;
      this.choiceReject = reject;
      this.readingChoice = true;
      this.updateChoiceFooterHeight();
      this.redrawChoicePanel();
    });
  }

  async readLine(options?: { placeholder?: string; plain?: boolean }): Promise<string> {
    this.readLinePlaceholder = options?.placeholder;
    this.readLinePlain = options?.plain ?? false;
    this.inputBuffer = "";
    this.inputCursor = 0;
    this.inputHistory.resetBrowse();
    this.inputRow = this.footerTop + 1;
    this.lastCtrlCAt = 0;

    return new Promise((resolve, reject) => {
      this.inputResolve = resolve;
      this.inputReject = reject;
      this.readingLine = true;
      this.drawFooter("", this.readLinePlain ? undefined : this.readLinePlaceholder);
    });
  }

  /** True once after Ctrl+C during streaming; consumed by the agent loop. */
  consumeTurnExitRequested(): boolean {
    const requested = this.turnExitRequested;
    this.turnExitRequested = false;
    return requested;
  }

  async readConfirm(message: string): Promise<boolean> {
    if (this.activeTurn) {
      return this.readConfirmDuringTurn(message);
    }
    this.appendContent(message);
    const answer = await this.readLine({ plain: true });
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  }

  private readConfirmDuringTurn(message: string): Promise<boolean> {
    const entry = this.findLastWaitingToolEntry();
    if (entry) entry.awaitingApproval = true;
    this.readingConfirm = true;
    this.shortcutsOverride = `${ansi.bold}${message.trim()}${ansi.reset} ${ansi.muted}· y 允许 · n 拒绝${ansi.reset}`;
    this.invalidateContentCache();
    this.redrawContent();
    this.drawFooter("", undefined);

    return new Promise((resolve) => {
      this.confirmResolve = resolve;
    });
  }

  /** Plan approval screen — scrollable plan on top, action choices below (Claude Code-style). */
  async readPlanReview(opts: {
    planPath: string;
    planText: string;
  }): Promise<PlanReviewDecision> {
    const entry = this.findLastWaitingToolEntry();
    if (entry) entry.awaitingApproval = true;

    this.planReviewMode = true;
    this.planReviewPath = opts.planPath;
    this.planReviewText = opts.planText;
    this.planReviewSelected = 0;
    this.scrollOffset = 0;
    this.followBottom = false;
    this.shortcutsOverride = null;
    this.updatePlanReviewFooterHeight();
    this.invalidateContentCache();
    this.redraw();

    return new Promise((resolve) => {
      this.planReviewResolve = resolve;
    });
  }

  private buildPlanReviewContentLines(): RenderLine[] {
    const { cols } = getTerminalSize();
    const sep = `${ansi.line}${H.repeat(Math.min(cols, 48))}${ansi.reset}`;
    const planRendered = this.planReviewText.trim()
      ? renderRichContentLines(this.planReviewText, cols)
      : [`${ansi.muted}(Plan file is empty)${ansi.reset}`];
    const texts = [...PLAN_REVIEW_INTRO, sep, "", ...planRendered];
    return texts.map((text) => ({ text }));
  }

  private updatePlanReviewFooterHeight(): void {
    const { cols } = getTerminalSize();
    this.activeFooterHeight = this.clampFooterHeight(planReviewPanelRowCount(cols));
  }

  private drawPlanReviewFooter(): void {
    const { cols, rows } = getTerminalSize();
    const top = this.footerTop;
    const panelLines = renderPlanReviewPanelLines({
      selectedIndex: this.planReviewSelected,
      cols,
      planPath: this.planReviewPath,
    });
    const sep = footerSeparator(cols);
    const footerRows = [
      padToWidth(sep, cols),
      ...padPlanReviewLines(panelLines, cols),
      padToWidth(sep, cols),
      padToWidth(PLAN_REVIEW_HINT, cols),
    ];

    let out = "";
    for (let i = 0; i < footerRows.length; i++) {
      out += moveTo(top + i);
      out += clearLine();
      out += footerRows[i]!;
    }
    for (let i = top + footerRows.length; i <= rows; i++) {
      out += moveTo(i);
      out += clearLine();
    }
    process.stdout.write(out);
    process.stdout.write(HIDE_CURSOR);
  }

  private async handlePlanReviewInput(chunk: string): Promise<void> {
    if (chunk.includes("\x07")) {
      await this.refreshPlanFromEditor();
      return;
    }

    const { actions: scrollActions } = parseInputActions(chunk);
    for (const action of scrollActions) {
      if (action.type === "scroll") {
        this.scrollBy(action.delta);
        this.redrawContent();
        return;
      }
    }

    const { actions } = parseChoiceInputActions(chunk);
    for (const action of actions) {
      if (action.type === "interrupt" || action.type === "escape") {
        this.finishPlanReview({ action: "cancel" });
        return;
      }
      if (action.type === "up") {
        this.planReviewSelected = Math.max(0, this.planReviewSelected - 1);
        this.drawPlanReviewFooter();
      }
      if (action.type === "down") {
        const max = buildPlanReviewRows().length - 1;
        this.planReviewSelected = Math.min(max, this.planReviewSelected + 1);
        this.drawPlanReviewFooter();
      }
      if (action.type === "enter") {
        const row = buildPlanReviewRows()[this.planReviewSelected];
        if (!row) return;
        const planAction = planActionFromRow(row);
        if (!planAction) return;
        if (planAction === "revise") {
          await this.promptPlanRevisionFeedback();
          return;
        }
        this.finishPlanReview({ action: planAction });
        return;
      }
    }
  }

  private async refreshPlanFromEditor(): Promise<void> {
    await openPlanInEditor(this.planReviewPath);
    this.planReviewText = await readPlanFileText(this.planReviewPath);
    this.invalidateContentCache();
    this.redrawContent();
  }

  private async promptPlanRevisionFeedback(): Promise<void> {
    this.planReviewMode = false;
    this.activeFooterHeight = this.defaultFooterHeight;
    this.invalidateContentCache();
    this.redrawContent();
    const feedback = (
      await this.readLine({
        plain: true,
        placeholder: "Describe what to change in the plan…",
      })
    ).trim();
    if (!feedback) {
      this.planReviewMode = true;
      this.updatePlanReviewFooterHeight();
      this.redraw();
      return;
    }
    this.finishPlanReview({ action: "revise", feedback });
  }

  private finishPlanReview(decision: PlanReviewDecision): void {
    const resolve = this.planReviewResolve;
    this.planReviewResolve = null;
    this.planReviewMode = false;
    this.planReviewPath = "";
    this.planReviewText = "";
    this.planReviewSelected = 0;

    const entry = this.findLastWaitingToolEntry();
    if (entry) entry.awaitingApproval = false;

    this.restoreDefaultFooter();
    this.invalidateContentCache();
    this.redrawContent();
    if (this.activeTurn && this.activeTurn.phase !== "done") {
      this.updateGeneratingFooter();
    }
    resolve?.(decision);
  }

  private drawWorkflowsPanel(): void {
    const { cols, rows } = getTerminalSize();
    const screen = renderWorkflowsFullScreen(this.workflowsPanelState, cols, rows);
    let out = "";
    for (let i = 0; i < rows; i++) {
      out += moveTo(i + 1);
      out += clearLine();
      out += padToWidth(screen[i] ?? "", cols);
    }
    process.stdout.write(out);
    process.stdout.write(HIDE_CURSOR);
  }

  private redrawWorkflowsPanel(): void {
    this.drawWorkflowsPanel();
  }

  private closeWorkflowsPanel(): void {
    if (!this.readingWorkflowsPanel) return;
    const resolve = this.workflowsPanelResolve;
    this.workflowsPanelResolve = null;
    this.readingWorkflowsPanel = false;
    this.workflowsPanelSessionId = "";
    this.workflowsPanelState = {
      view: "list",
      runs: [],
      selectedIndex: 0,
      selectedPhaseIndex: 0,
      selectedAgentIndex: 0,
      phases: [],
    };
    this.activeFooterHeight = this.defaultFooterHeight;
    this.invalidateContentCache();
    this.redraw();
    resolve?.();
  }

  private async loadWorkflowsPanelPhases(run: WorkflowRunRecord): Promise<void> {
    const meta = await loadWorkflowMetaFromScriptPath(run.scriptPath);
    const entries = await readJournalEntries(this.workflowsPanelSessionId, run.runId);
    this.workflowsPanelState = {
      ...this.workflowsPanelState,
      phases: aggregateWorkflowJournal(entries, meta?.phases ?? []),
    };
  }

  private sortedWorkflowRuns(): WorkflowRunRecord[] {
    return sortWorkflowRuns(this.workflowsPanelState.runs);
  }

  private async handleWorkflowsPanelInput(chunk: string): Promise<void> {
    const { actions: inputActions } = parseInputActions(chunk);
    for (const action of inputActions) {
      if (action.type === "scroll") {
        return;
      }
    }

    for (const action of inputActions) {
      if (action.type === "char") {
        const key = action.char.toLowerCase();
        if (key === "s") {
          const run = this.sortedWorkflowRuns()[this.workflowsPanelState.selectedIndex];
          if (!run) return;
          try {
            const { markdownPath } = await saveWorkflowArtifact(this.workflowsPanelSessionId, run);
            this.workflowsPanelState = {
              ...this.workflowsPanelState,
              notice: `Saved to ${markdownPath}`,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.workflowsPanelState = {
              ...this.workflowsPanelState,
              notice: `Save failed: ${message}`,
            };
          }
          this.redrawWorkflowsPanel();
          return;
        }
        if (key === "x") {
          const run = this.sortedWorkflowRuns()[this.workflowsPanelState.selectedIndex];
          if (!run) return;
          if (run.status !== "running" && run.status !== "pending") return;
          try {
            await stopWorkflowByRunId(this.workflowsPanelSessionId, run.runId);
            const runs = sortWorkflowRuns(await loadWorkflowRuns(this.workflowsPanelSessionId));
            this.workflowsPanelState = {
              ...this.workflowsPanelState,
              runs,
              notice: `Stopped ${run.name}`,
            };
            void this.refreshWorkflowFooter(this.workflowsPanelSessionId);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.workflowsPanelState = {
              ...this.workflowsPanelState,
              notice: `Stop failed: ${message}`,
            };
          }
          this.redrawWorkflowsPanel();
          return;
        }
      }
      if (action.type === "shiftTab" && this.workflowsPanelState.view === "detail") {
        const phase = this.workflowsPanelState.phases[this.workflowsPanelState.selectedPhaseIndex];
        if (!phase?.agents.length) continue;
        this.workflowsPanelState = {
          ...this.workflowsPanelState,
          view: "agent",
          selectedAgentIndex: 0,
          notice: undefined,
        };
        this.redrawWorkflowsPanel();
        return;
      }
    }

    const { actions } = parseChoiceInputActions(chunk);
    for (const action of actions) {
      if (action.type === "interrupt" || action.type === "escape") {
        if (this.workflowsPanelState.view === "agent") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            view: "detail",
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
          return;
        }
        if (this.workflowsPanelState.view === "detail") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            view: "list",
            selectedPhaseIndex: 0,
            selectedAgentIndex: 0,
            phases: [],
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
          return;
        }
        this.closeWorkflowsPanel();
        return;
      }

      if (this.workflowsPanelState.view === "list") {
        const runs = this.sortedWorkflowRuns();
        if (action.type === "up") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            selectedIndex: Math.max(0, this.workflowsPanelState.selectedIndex - 1),
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
        }
        if (action.type === "down") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            selectedIndex: Math.min(runs.length - 1, this.workflowsPanelState.selectedIndex + 1),
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
        }
        if (action.type === "enter") {
          const run = runs[this.workflowsPanelState.selectedIndex];
          if (!run) return;
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            view: "detail",
            selectedPhaseIndex: 0,
            selectedAgentIndex: 0,
            notice: undefined,
          };
          await this.loadWorkflowsPanelPhases(run);
          this.redrawWorkflowsPanel();
        }
        continue;
      }

      if (this.workflowsPanelState.view === "detail") {
        const phases = this.workflowsPanelState.phases;
        if (action.type === "up") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            selectedPhaseIndex: Math.max(0, this.workflowsPanelState.selectedPhaseIndex - 1),
            selectedAgentIndex: 0,
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
        }
        if (action.type === "down") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            selectedPhaseIndex: Math.min(
              Math.max(phases.length - 1, 0),
              this.workflowsPanelState.selectedPhaseIndex + 1,
            ),
            selectedAgentIndex: 0,
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
        }
        if (action.type === "enter") {
          const phase = phases[this.workflowsPanelState.selectedPhaseIndex];
          if (phase?.agents.length) {
            this.workflowsPanelState = {
              ...this.workflowsPanelState,
              view: "agent",
              selectedAgentIndex: 0,
              notice: undefined,
            };
            this.redrawWorkflowsPanel();
          }
        }
        continue;
      }

      if (this.workflowsPanelState.view === "agent") {
        const phase = this.workflowsPanelState.phases[this.workflowsPanelState.selectedPhaseIndex];
        const agents = phase?.agents ?? [];
        if (action.type === "up") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            selectedAgentIndex: Math.max(0, this.workflowsPanelState.selectedAgentIndex - 1),
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
        }
        if (action.type === "down") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            selectedAgentIndex: Math.min(
              Math.max(agents.length - 1, 0),
              this.workflowsPanelState.selectedAgentIndex + 1,
            ),
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
        }
      }
    }
  }

  /** Workflow approval screen — scrollable summary on top, action choices below. */
  async readWorkflowConfirm(opts: {
    meta: WorkflowMeta;
    args: unknown;
    scriptSource: string;
    scriptPath: string;
  }): Promise<WorkflowConfirmDecision> {
    const entry = this.findLastWaitingToolEntry();
    if (entry) entry.awaitingApproval = true;

    this.workflowConfirmMode = true;
    this.workflowConfirmMeta = opts.meta;
    this.workflowConfirmArgs = opts.args;
    this.workflowConfirmScriptSource = opts.scriptSource;
    this.workflowConfirmScriptPath = opts.scriptPath;
    this.workflowConfirmView = {
      scriptVisible: false,
      scriptToggled: false,
      selectedIndex: 0,
    };
    this.scrollOffset = 0;
    this.followBottom = false;
    this.shortcutsOverride = null;
    this.updateWorkflowConfirmFooterHeight();
    this.invalidateContentCache();
    this.redraw();

    return new Promise((resolve) => {
      this.workflowConfirmResolve = resolve;
    });
  }

  private buildWorkflowConfirmContentLines(): RenderLine[] {
    const { cols } = getTerminalSize();
    const meta = this.workflowConfirmMeta;
    if (!meta) return [];
    const texts = renderWorkflowConfirmContentLines({
      meta,
      args: this.workflowConfirmArgs,
      scriptSource: this.workflowConfirmScriptSource,
      scriptVisible: this.workflowConfirmView.scriptVisible,
      cols,
    });
    return texts.map((text) => ({ text }));
  }

  private updateWorkflowConfirmFooterHeight(): void {
    const { cols } = getTerminalSize();
    this.activeFooterHeight = this.clampFooterHeight(
      workflowConfirmPanelRowCount(cols, this.workflowConfirmView),
    );
  }

  private drawWorkflowConfirmFooter(): void {
    const { cols, rows } = getTerminalSize();
    const top = this.footerTop;
    const panelLines = renderWorkflowConfirmPanelLines({
      state: this.workflowConfirmView,
      scriptPath: this.workflowConfirmScriptPath,
      cols,
    });
    const sep = footerSeparator(cols);
    const footerRows = [
      padToWidth(sep, cols),
      ...padWorkflowConfirmLines(panelLines, cols),
      padToWidth(sep, cols),
      padToWidth(WORKFLOW_CONFIRM_HINT, cols),
    ];

    let out = "";
    for (let i = 0; i < footerRows.length; i++) {
      out += moveTo(top + i);
      out += clearLine();
      out += footerRows[i]!;
    }
    for (let i = top + footerRows.length; i <= rows; i++) {
      out += moveTo(i);
      out += clearLine();
    }
    process.stdout.write(out);
    process.stdout.write(HIDE_CURSOR);
  }

  private async handleWorkflowConfirmInput(chunk: string): Promise<void> {
    if (chunk.includes("\x07")) {
      await openFileInEditor(this.workflowConfirmScriptPath);
      this.workflowConfirmScriptSource = await readPlanFileText(this.workflowConfirmScriptPath);
      this.invalidateContentCache();
      this.redrawContent();
      return;
    }

    const { actions: scrollActions } = parseInputActions(chunk);
    for (const action of scrollActions) {
      if (action.type === "scroll") {
        this.scrollBy(action.delta);
        this.redrawContent();
        return;
      }
    }

    const rows = buildWorkflowConfirmChoiceRows(this.workflowConfirmView);
    const { actions } = parseChoiceInputActions(chunk);
    for (const action of actions) {
      if (action.type === "interrupt" || action.type === "escape") {
        this.finishWorkflowConfirm({ action: "cancel" });
        return;
      }
      if (action.type === "up") {
        this.workflowConfirmView = {
          ...this.workflowConfirmView,
          selectedIndex: Math.max(0, this.workflowConfirmView.selectedIndex - 1),
        };
        this.updateWorkflowConfirmFooterHeight();
        this.drawWorkflowConfirmFooter();
      }
      if (action.type === "down") {
        this.workflowConfirmView = {
          ...this.workflowConfirmView,
          selectedIndex: Math.min(rows.length - 1, this.workflowConfirmView.selectedIndex + 1),
        };
        this.updateWorkflowConfirmFooterHeight();
        this.drawWorkflowConfirmFooter();
      }
      if (action.type === "enter") {
        const row = rows[this.workflowConfirmView.selectedIndex];
        if (!row) return;
        const optionIndex = workflowConfirmOptionIndexFromRow(row);
        if (optionIndex === 1) {
          this.workflowConfirmView = workflowConfirmToggleScript(this.workflowConfirmView);
          this.updateWorkflowConfirmFooterHeight();
          this.invalidateContentCache();
          this.redrawContent();
          return;
        }
        this.finishWorkflowConfirm(
          workflowConfirmDecisionFromRow(row, this.workflowConfirmScriptPath),
        );
        return;
      }
    }
  }

  private finishWorkflowConfirm(decision: WorkflowConfirmDecision): void {
    const resolve = this.workflowConfirmResolve;
    this.workflowConfirmResolve = null;
    this.workflowConfirmMode = false;
    this.workflowConfirmMeta = null;
    this.workflowConfirmArgs = undefined;
    this.workflowConfirmScriptSource = "";
    this.workflowConfirmScriptPath = "";
    this.workflowConfirmView = {
      scriptVisible: false,
      scriptToggled: false,
      selectedIndex: 0,
    };

    const entry = this.findLastWaitingToolEntry();
    if (entry) entry.awaitingApproval = false;

    this.restoreDefaultFooter();
    this.invalidateContentCache();
    this.redrawContent();
    if (this.activeTurn && this.activeTurn.phase !== "done") {
      this.updateGeneratingFooter();
    }
    resolve?.(decision);
  }
}
