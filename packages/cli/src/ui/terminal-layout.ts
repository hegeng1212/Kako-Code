import { readClipboardImage, storeClipboardImage } from "@kako/core";
import type { AskUserQuestionItem, AskUserQuestionResult, UserAttachment } from "@kako/shared";
import { extractImageLabelsInOrder, formatImageMarker } from "./image-markers.js";
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
import { openPlanInEditor, readPlanFileText } from "./open-editor.js";
import { renderHistorySeparator, renderPlanModeFooterHint } from "./input-footer.js";
import { InputHistory } from "./input-history.js";
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
  | { type: "shiftTab" }
  | { type: "paste" }
  | { type: "scroll"; delta: number }
  | { type: "click"; row: number; col: number }
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
        } else if (code === "Z") {
          actions.push({ type: "shiftTab" });
        }
        i += csi[0].length;
        continue;
      }

      i++;
      continue;
    }

    if (ch >= " " || ch === "\t") {
      actions.push({ type: "char", char: ch });
    }
    i++;
  }

  return { actions, rest: "" };
}

function footerSeparator(cols: number): string {
  return `${ansi.line}${H.repeat(cols)}${ansi.reset}`;
}

export class ChatLayout {
  private getHeader: () => string;
  private footerParts: ClaudeFooterParts;
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
  private inputListener: ((chunk: string) => void) | null = null;
  private inputResolve: ((value: string) => void) | null = null;
  private inputReject: ((reason: ExitRequestedError) => void) | null = null;
  private inputBuffer = "";
  private inputCursor = 0;
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

  constructor(getHeader: () => string, footerParts: ClaudeFooterParts) {
    this.getHeader = getHeader;
    this.footerParts = footerParts;
  }

  get headerText(): string {
    return this.getHeader();
  }

  get headerLines(): string[] {
    return this.headerText.split("\n").filter((line, index) => !(index === 0 && line === ""));
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    this.nextImageIndex = 1;
    this.pendingImages = [];
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
    return this.headerLines.length;
  }

  get contentHeight(): number {
    const { rows } = getTerminalSize();
    return Math.max(1, rows - this.headerHeight - this.footerHeight);
  }

  get footerTop(): number {
    const { rows } = getTerminalSize();
    return rows - this.footerHeight + 1;
  }

  start(): void {
    this.active = true;
    process.stdout.write(ENTER_ALT_SCREEN);
    process.stdout.write(HIDE_CURSOR);
    this.attachInput();
    this.resizeListener = () => this.redraw();
    process.stdout.on("resize", this.resizeListener);
    this.redraw();
  }

  stop(): void {
    if (!this.active) return;
    this.stopTurnTick();
    this.clearExitHint();
    this.detachInput();
    if (this.resizeListener) {
      process.stdout.off("resize", this.resizeListener);
      this.resizeListener = null;
    }
    process.stdout.write(LEAVE_ALT_SCREEN);
    process.stdout.write(SHOW_CURSOR);
    this.active = false;
  }

  private attachInput(): void {
    if (this.inputListener) return;
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    if (process.stdout.isTTY) process.stdout.write(ENABLE_MOUSE);
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
    if (process.stdout.isTTY) process.stdout.write(DISABLE_MOUSE);
  }

  private onInput(chunk: string): void {
    if (!this.active) return;
    if (this.planReviewMode) {
      void this.handlePlanReviewInput(chunk);
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

    const { actions } = parseInputActions(chunk);

    for (const action of actions) {
      if (action.type === "click") {
        this.handleClick(action.row, action.col);
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
    this.activeFooterHeight = questionWizardPanelRowCount({
      questions: this.wizardQuestions,
      answers: this.wizardAnswers,
      focusIndex: this.wizardFocus,
      rows: this.choiceRows,
      selectedIndex: this.choiceSelected,
      cols,
    });
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
    this.activeFooterHeight = choicePanelRowCount({
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

    if (action.type === "interrupt") {
      const reject = this.inputReject;
      this.finishReadLine();
      reject?.(new ExitRequestedError());
      return;
    }
    if (action.type === "enter") {
      const value = this.inputBuffer;
      const resolve = this.inputResolve;
      this.inputHistory.commit(value);
      this.inputHistory.resetBrowse();
      this.finishReadLine();
      process.stdout.write(HIDE_CURSOR);
      this.drawFooter("", plain ? undefined : placeholder);
      resolve?.(value);
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
      void this.handleImagePaste();
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

    this.drawFooter(
      this.inputBuffer,
      this.inputBuffer ? undefined : plain ? undefined : placeholder,
    );
  }

  private async handleImagePaste(): Promise<void> {
    if (!this.sessionId) return;
    const clip = await readClipboardImage();
    if (!clip) return;
    const index = this.nextImageIndex++;
    const marker = formatImageMarker(index);
    const attachment = await storeClipboardImage(this.sessionId, clip.buffer, clip.mimeType);
    this.pendingImages.push({ index, attachment });
    this.inputBuffer =
      this.inputBuffer.slice(0, this.inputCursor) +
      marker +
      this.inputBuffer.slice(this.inputCursor);
    this.inputCursor += marker.length;
    if (this.readingLine) {
      this.drawFooter(this.inputBuffer, this.readLinePlaceholder);
    }
  }

  private finishReadLine(): void {
    this.inputResolve = null;
    this.inputReject = null;
    this.readingLine = false;
    this.inputBuffer = "";
    this.inputCursor = 0;
    this.readLinePlaceholder = undefined;
    if (!this.readingChoice) {
      this.activeFooterHeight = this.defaultFooterHeight;
    }
  }

  private allRenderLines(): RenderLine[] {
    if (this.planReviewMode) {
      return this.buildPlanReviewContentLines();
    }
    const { cols } = getTerminalSize();
    const now = Date.now();
    const lines: RenderLine[] = [CHAT_EDGE_LINE];
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
    if (this.planReviewMode) return [];
    if (!this.activeTurn || this.activeTurn.phase === "done") return [];
    const now = Date.now();
    const lines = [renderSmooshingLine(this.activeTurn, now)];
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
    if (line && isToolGroupToggleLine(line.meta) && line.meta.groupId) {
      this.toggleToolGroup(line.meta.turnId, line.meta.groupId);
      return;
    }
    if (line && isChoiceToggleLine(line.meta) && line.meta.choiceId) {
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
    if (this.activeTurn && this.activeTurn.phase !== "done") {
      this.shortcutsOverride = renderGeneratingStatus(this.activeTurn);
    } else if (!this.exitHintTimer) {
      this.shortcutsOverride = null;
    }
  }

  redraw(): void {
    if (!this.active) return;
    this.invalidateContentCache();
    if (this.followBottom) {
      this.scrollToBottom();
    } else {
      const max = this.maxScrollOffset();
      if (this.scrollOffset > max) this.scrollOffset = max;
    }
    const { cols } = getTerminalSize();
    let out = moveTo(1, 1) + CLEAR_SCROLLBACK + "\x1b[2J";

    for (let i = 0; i < this.headerLines.length; i++) {
      out += moveTo(i + 1);
      out += clearLine();
      out += padToWidth(this.headerLines[i]!, cols);
    }

    out += this.renderContentBuffer(cols);
    process.stdout.write(out);
    if (this.planReviewMode) {
      this.drawPlanReviewFooter();
    } else if (this.readingChoice) {
      this.drawActiveChoiceFooter();
    } else {
      this.drawFooter(this.inputBuffer, this.readLinePlaceholder);
    }
  }

  /** Repaint the welcome header after provider/model changes from Web UI. */
  refreshHeader(): void {
    if (!this.active) return;
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
    const maxOffset = this.maxScrollOffset();
    const scrolledUp = this.scrollOffset < maxOffset;
    let out = "";

    for (let i = 0; i < scrollH; i++) {
      let line = visible[i] ?? "";
      if (i === 0 && scrolledUp) {
        const hint = `${ansi.muted}↑ ${maxOffset - this.scrollOffset} earlier lines · PgUp/PgDn to scroll${ansi.reset}`;
        line = visibleLength(hint) <= cols ? hint : line;
      }
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
    const { cols } = getTerminalSize();
    process.stdout.write(this.renderContentBuffer(cols, true));
    if (this.planReviewMode) {
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
    if (this.permissionMode === "plan" && !this.readingConfirm && !this.planReviewMode) {
      return renderPlanModeFooterHint();
    }
    if (this.readingLine) {
      if (inputValue.length > 0) return "";
      if (this.exitHintTimer && this.shortcutsOverride) return this.shortcutsOverride;
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
    return footerSeparator(cols);
  }

  private drawFooter(inputValue: string, placeholder?: string): void {
    const { cols, rows } = getTerminalSize();
    const top = this.footerTop;
    const shortcuts = this.footerShortcutsLine(inputValue);
    const footerRows = [
      padToWidth(this.footerTopSeparator(cols), cols),
      padToWidth(this.renderInputLine(inputValue, placeholder), cols),
      padToWidth(footerSeparator(cols), cols),
      padToWidth(shortcuts, cols),
    ];
    let out = "";
    for (let i = 0; i < footerRows.length; i++) {
      out += moveTo(top + i);
      out += clearLine();
      out += footerRows[i]!;
    }
    // Choice/wizard panels use a taller footer — clear leftover lines after shrinking.
    for (let i = top + footerRows.length; i <= rows; i++) {
      out += moveTo(i);
      out += clearLine();
    }
    process.stdout.write(out);
    if (this.inputResolve) {
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
    if (this.planReviewResolve) {
      this.finishPlanReview({ action: "cancel" });
    }
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
    this.activeFooterHeight = planReviewPanelRowCount(cols);
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
}
