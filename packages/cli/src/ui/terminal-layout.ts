import {
  aggregateWorkflowJournal,
  countRunningWorkflows,
  findLeadingAbsolutePath,
  getBackgroundTask,
  isImagePath,
  listRunningWorkflows,
  loadWorkflowMetaFromScriptPath,
  loadWorkflowRuns,
  markOrphanWorkflowInterrupted,
  normalizeClipboardPath,
  readClipboardImage,
  readClipboardText,
  writeClipboardText,
  readJournalEntries,
  saveWorkflowArtifact,
  shouldRenderWorkflowFooter,
  stopWorkflowByRunId,
  storeClipboardImage,
  storeUserAttachment,
  FileMemoryStore,
  sessionInputHistory,
  listBackgroundTasks,
  stopBackgroundTask,
  listTasks,
  type BackgroundTask,
  type SystemSkillEntry,
  type WorkflowMeta,
  type WorkflowRunRecord,
} from "@kako/core";
import type {
  AskUserQuestionItem,
  AskUserQuestionResult,
  SessionMeta,
  UserAttachment,
} from "@kako/shared";
import { extractImageLabelsInOrder, formatImageMarker, nextImageIndexFromText } from "./image-markers.js";
import type { ClaudeFooterParts } from "./box.js";
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
  toggleThoughtExpanded,
  type ChatTurn,
  type ChoiceTimelineEntry,
  type ChoiceGroupTimelineEntry,
  type RenderLine,
  type ToolCallTimelineEntry,
  type TurnTimelineEntry,
} from "./chat-blocks.js";
import {
  STEPPED_AWAY_IDLE_MS,
} from "./stepped-away-recap.js";
import {
  isToolErrorToggleLine,
  isToolGroupToggleLine,
  isPlanToolToggleLine,
  isWriteToolToggleLine,
  isEditToolToggleLine,
  isSkillToolToggleLine,
  isAgentToolToggleLine,
  isAgentTool,
} from "./tool-call-display.js";
import { isChoiceToggleLine } from "./ask-user-question-display.js";
import {
  INPUT_MAX_VISIBLE_LINES,
  clampInputScrollRow,
  cursorLogicalLine,
  insertNewlineAtCursor,
  moveCursorDown,
  moveCursorUp,
  renderMultilineInput,
  shouldBrowseHistoryOnDown,
  shouldBrowseHistoryOnUp,
  inputBlockRowCount,
  inputOffsetFromScreen,
  lineEndOffset,
  lineStartOffset,
  normalizeSelectionRange,
  selectedText,
  type InputSelectionRange,
} from "./multiline-input.js";
import { renderRichContentLines } from "./markdown-render.js";
import {
  CHOICE_HINT,
  MULTI_SELECT_CHOICE_HINT,
  WIZARD_MULTI_SELECT_HINT,
  buildChoiceRows,
  buildMultiChoiceRows,
  buildWizardReviewRows,
  checkedIndexesFromAnswer,
  composeMultiSelectAnswer,
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
import {
  nextPermissionMode,
  renderHistorySeparator,
  renderInputCopyHint,
  renderPermissionModeFooterHint,
} from "./input-footer.js";
import { PULSE_FRAME_MOD } from "./stream-pulse.js";
import {
  buildSessionAgentRowsWithDetailPin,
  countBackgroundWaitingAgents,
  focusAfterListUp,
  focusFromInputDown,
  moveAgentSelection,
  agentListShortcutsHint,
  currentSessionAgentIndex,
  renderSessionAgentListLines,
  resolveAgentDetailPinRow,
  shouldFocusAgentListAfterLeavingHistory,
  shouldPopAgentDetailOnLeft,
  shouldShowChatInputCaret,
  type SessionAgentFocus,
  type SessionAgentRow,
  type SessionSubagentRow,
} from "./session-agent-switcher.js";
import {
  completeSlashSuggestion,
  computeInputRowsScreenStart,
  filterSlashSuggestions,
  planSlashSuggestFooter,
  renderSlashSuggestLines,
  resolveSlashSubmitValue,
  shouldShowSlashMenu,
  slashSuggestQuery,
  SLASH_SUGGEST_HINT,
} from "./slash-suggest.js";
import { renderPlanEnabledLine } from "./plan-box.js";
import {
  renderWorkflowFooterLines,
  renderWorkflowWaitingLine,
  renderBackgroundAgentWaitingLine,
  type WorkflowFooterState,
} from "./workflow-footer.js";
import {
  AGENTS_INPUT_MAX_VISIBLE_LINES,
  agentsComposeHitTest,
  agentsPanelHitTest,
  buildAgentsRows,
  classifySessionBucket,
  createAgentsPanelState,
  pinAgentsSelectionInView,
  renderAgentsScreen,
  refreshAgentsPanelRows,
  type AgentsPanelState,
} from "./agents-panel.js";
import {
  markAgentsSessionRead,
} from "./agents-session-reads.js";
import {
  chatTurnsFromTranscript,
  reopenLastTranscriptTurn,
  type RewindTurnAnchor,
} from "./session-history.js";
import {
  buildRewindListRows,
  defaultRewindListSelection,
  renderRewindConfirmPanel,
  renderRewindListPanel,
  renderRewindSeparator,
  rewindConfirmActions,
  type RewindConfirmAction,
  type RewindListRow,
} from "./rewind-panel.js";
import {
  debugChunk,
  debugLog,
  debugStack,
} from "./cli-debug-log.js";
import {
  buildWorkflowConfirmChoiceRows,
  padWorkflowConfirmLines,
  renderWorkflowConfirmContentLines,
  renderWorkflowConfirmPanelLines,
  WORKFLOW_CONFIRM_HINT,
  WORKFLOW_CONFIRM_SCRIPT_OPTION_INDEX,
  workflowConfirmDecisionFromRow,
  workflowConfirmOptionIndexFromRow,
  workflowConfirmPanelRowCount,
  workflowConfirmToggleScript,
  type WorkflowConfirmDecision,
  type WorkflowConfirmViewState,
} from "./workflow-confirm.js";
import { formatInterruptedResumeHint } from "./interrupted-resume-hint.js";
import {
  buildToolApprovalContent,
  padToolApprovalLines,
  renderToolApprovalContentLines,
  renderToolApprovalPanelLines,
  TOOL_APPROVAL_HINT,
  toolApprovalDecisionFromRow,
  toolApprovalPanelRowCount,
  toolConfirmResultFromDecision,
  type ToolApprovalContent,
} from "./tool-approval.js";
import {
  createInitialWorkflowsPanelState,
  prepareWorkflowRunsForPanel,
  renderWorkflowsFullScreen,
  type WorkflowsPanelState,
} from "./workflows-panel.js";
import { InputHistory } from "./input-history.js";
import type { ChatHeaderMode } from "./cli-usage.js";
import {
  renderChatHeader,
  renderError,
  resolveEffectiveHeaderMode,
  type WelcomeScreenOptions,
} from "./welcome.js";
import { ansi, displayWidth, visibleLength } from "./ansi.js";
import type { PermissionMode, ToolCall, ToolConfirmResult } from "@kako/shared";

const H = "─";

/** Enter isolated alternate screen — no scrollback to pre-kako shell history. */
const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[3J\x1b[H\x1b[2J";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_SCROLLBACK = "\x1b[3J";
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const ENABLE_MOUSE_ANY_EVENT = "\x1b[?1003h";
const DISABLE_MOUSE_ANY_EVENT = "\x1b[?1003l";
const ENABLE_BRACKETED_PASTE = "\x1b[?2004h";
const DISABLE_BRACKETED_PASTE = "\x1b[?2004l";
/** xterm focus-in/out reporting — repaint after hide/show or tab switch. */
const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
/** Disable all mouse tracking including motion (preserves drag-to-select). */
const DISABLE_MOUSE = "\x1b[?1003l\x1b[?1002l\x1b[?1006l\x1b[?1000l";

/**
 * Re-arm tty private modes after sleep / focus loss / SIGCONT.
 * Many hosts drop mouse tracking while leaving the process running — native
 * selection comes back and Ctrl+C may arrive as SIGINT instead of \\u0003.
 */
export function buildTerminalInputModeEnablement(opts: {
  mouseDrag?: boolean;
  mouseAnyEvent?: boolean;
}): string {
  let out = ENABLE_MOUSE;
  if (opts.mouseAnyEvent) out += ENABLE_MOUSE_ANY_EVENT;
  else if (opts.mouseDrag) out += ENABLE_MOUSE_DRAG;
  out += ENABLE_BRACKETED_PASTE;
  out += ENABLE_FOCUS_REPORTING;
  return out;
}

/** After this idle gap, the next keypress re-asserts terminal input modes. */
const TERMINAL_MODE_REASSERT_IDLE_MS = 30_000;
/**
 * Proactively re-arm mouse/raw modes while the layout is active.
 * Hosts (sleep, tab switch, integrated terminals) drop DECSET mouse tracking;
 * without it, native selection returns and Ctrl+C is often stolen for copy.
 */
const TERMINAL_MODE_REASSERT_INTERVAL_MS = 5_000;
/** Consecutive SIGINTs within CTRL_C_EXIT_MS before forcing process.exit. */
const SIGINT_HARD_EXIT_COUNT = 3;

function restoreStdinCookedMode(): void {
  if (process.stdin.isTTY && process.stdin.isRaw) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // ignore — stdin may already be closed
    }
  }
}

function resetTerminalInputModes(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(DISABLE_MOUSE);
  process.stdout.write(DISABLE_BRACKETED_PASTE);
  process.stdout.write(DISABLE_FOCUS_REPORTING);
  process.stdout.write(SHOW_CURSOR);
}

let activeChatLayout: ChatLayout | null = null;
let terminalExitHooksInstalled = false;

function installTerminalExitHooks(): void {
  if (terminalExitHooksInstalled) return;
  terminalExitHooksInstalled = true;
  const restore = (): void => {
    activeChatLayout?.restoreTerminalOnExit();
  };
  process.on("exit", restore);
  process.on("uncaughtException", (err) => {
    restore();
    throw err;
  });
  process.on("unhandledRejection", () => {
    restore();
  });
}

/** Enable button-drag reporting for input text selection. */
const ENABLE_MOUSE_DRAG = "\x1b[?1002h";
const DISABLE_MOUSE_DRAG = "\x1b[?1002l";
const CTRL_C_EXIT_MS = 2000;
const COPY_HINT_MS = 2000;
const EXIT_HINT_MS = 1000;
const EXIT_HINT = "Press Ctrl+C again to exit";
const HISTORY_CLEAR_HINT_MS = 2000;
const HISTORY_CLEAR_HINT = "Esc again to clear";
const REWIND_ARM_HINT_MS = 2000;
const REWIND_ARM_HINT = "Esc again for rewind";
/**
 * Ignore a trailing Enter after Rewind confirm when CR/LF arrive as separate chunks.
 * Same-chunk CRLF is coalesced in parseInputActions; this only covers a delayed lone LF.
 * Must NOT use a sticky count — unused counts ate the next real Submit and led to Ctrl+C exit.
 */
const REWIND_SUPPRESS_ENTER_MS = 500;

/** Blank line padding at top/bottom of the scrollable chat area. */
const CHAT_EDGE_LINE: RenderLine = { text: "" };

/** Footer rows: topSep, input, bottomSep, shortcuts */
export const CHAT_FOOTER_HEIGHT = 4;

export interface RewindHandlers {
  loadTurns: () => Promise<RewindTurnAnchor[]>;
  /** Conversation truncate (+ optional prefill of the selected prompt). */
  restore: (anchor: RewindTurnAnchor) => Promise<void>;
  /** Best-effort undo of Write/Edit after the selected turn. */
  restoreCode: (anchor: RewindTurnAnchor) => Promise<void>;
  summarize: (
    mode: "from_here" | "up_to_here",
    anchor: RewindTurnAnchor,
    context: string,
  ) => Promise<void>;
}

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

/** Thrown when readLine is aborted because the foreground session was switched. */
export class SessionHandoffError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super("session handoff");
    this.name = "SessionHandoffError";
    this.sessionId = sessionId;
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

function clipPlainToDisplayWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const ch of text) {
    const cw = displayWidth(ch);
    if (used + cw > width) break;
    out += ch;
    used += cw;
  }
  return out;
}

function padToWidth(line: string, width: number): string {
  // Always pad by terminal columns (displayWidth). Using code-unit length caused
  // CJK rows to wrap and clip Agents/chat border lines.
  if (line.startsWith(ansi.userMessageBg)) {
    const resetAt = line.lastIndexOf(ansi.reset);
    const inner = resetAt >= 0 ? line.slice(0, resetAt) : line;
    const w = displayWidth(inner);
    if (w > width) {
      // Over-wide selection rows wrap and erase the list below — hard clip.
      const plain = clipPlainToDisplayWidth(inner.replace(/\x1b\[[0-9;]*m/g, ""), width);
      return `${ansi.userMessageBg}${plain}${ansi.reset}`;
    }
    if (w >= width) return line;
    const pad = " ".repeat(width - w);
    return resetAt >= 0 ? `${inner}${pad}${line.slice(resetAt)}` : `${inner}${pad}`;
  }
  const w = displayWidth(line);
  if (w > width) {
    return clipPlainToDisplayWidth(line.replace(/\x1b\[[0-9;]*m/g, ""), width);
  }
  if (w >= width) return line;
  return line + " ".repeat(width - w);
}

/** Word-wrap plain or ANSI text to fit terminal columns. */
export { wrapContentLines } from "./text-wrap.js";

type InputAction =
  | { type: "char"; char: string }
  | { type: "enter" }
  | { type: "newline" }
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
  | { type: "mouseDown"; row: number; col: number }
  | { type: "mouseDrag"; row: number; col: number }
  | { type: "mouseUp"; row: number; col: number }
  | { type: "mouseMove"; row: number; col: number }
  | { type: "click"; row: number; col: number }
  | { type: "focusIn" }
  | { type: "focusOut" }
  | { type: "interrupt" }
  | { type: "escape" }
  | { type: "ctrlX" }
  | { type: "ctrlB" };

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

function isIncompleteEscapeSequence(rest: string): boolean {
  if (!rest.startsWith("\x1b")) return false;
  if (rest === "\x1b") return true;
  // CSI / mouse — wait for a terminating byte when the prefix is known-incomplete.
  if (rest.startsWith("\x1b[")) {
    if (rest.startsWith("\x1b[<")) {
      // SGR mouse: \x1b[<btn;col;row[Mm]
      return !/^\x1b\[<\d+;\d+;\d+[mM]/.test(rest);
    }
    if (rest.startsWith("\x1b[M")) {
      // X10 mouse: ESC [ M Cb Cx Cy (6 bytes total)
      return rest.length < 6;
    }
    if (rest.startsWith("\x1b[200~")) {
      return !rest.includes("\x1b[201~");
    }
    // Generic CSI: ESC [ params final
    return !/^\x1b\[[0-9;]*[~A-Za-z]/.test(rest);
  }
  // SS3 / other single-char after ESC (e.g. ESC O A)
  if (rest.length === 2 && rest[1] !== "[") return false;
  if (rest.startsWith("\x1bO") && rest.length < 3) return true;
  return false;
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

    // Coalesce CRLF into one Enter — raw terminals often deliver "\\r\\n" for one key.
    if (ch === "\r") {
      actions.push({ type: "enter" });
      i++;
      if (i < data.length && data[i] === "\n") i++;
      continue;
    }
    if (ch === "\n") {
      actions.push({ type: "enter" });
      i++;
      continue;
    }
    if (ch === "\u0003" || ch === "\u0004") {
      // Ctrl+C and Ctrl+D both interrupt. Ctrl+D is the escape hatch when the
      // host steals Ctrl+C for copy while a native text selection is active.
      actions.push({ type: "interrupt" });
      i++;
      continue;
    }
    if (ch === "\u0018") {
      actions.push({ type: "ctrlX" });
      i++;
      continue;
    }
    if (ch === "\u0002") {
      actions.push({ type: "ctrlB" });
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
      if (isIncompleteEscapeSequence(rest)) {
        return { actions, rest };
      }
      if (rest.startsWith("\x1b[I")) {
        actions.push({ type: "focusIn" });
        i += 3;
        continue;
      }
      if (rest.startsWith("\x1b[O")) {
        actions.push({ type: "focusOut" });
        i += 3;
        continue;
      }
      if (rest.startsWith("\x1b\r") || rest.startsWith("\x1b\n")) {
        actions.push({ type: "newline" });
        i += 2;
        continue;
      }

      const csiu = rest.match(/^\x1b\[(\d+)(?:;(\d+))?u/);
      if (csiu) {
        const key = Number(csiu[1]);
        const mod = Number(csiu[2] ?? 1);
        if (key === 13) {
          if (mod & 2) {
            actions.push({ type: "newline" });
          } else {
            actions.push({ type: "enter" });
          }
          i += csiu[0].length;
          continue;
        }
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
            type: "mouseDown",
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
          const motion = (btn & 32) !== 0;
          if (modifiers === 0 && motion) {
            // Button-held drag (32) or any-event hover motion (35 = 32+3).
            if (button === 0) {
              actions.push({ type: "mouseDrag", col, row });
            } else {
              actions.push({ type: "mouseMove", col, row });
            }
          } else if (modifiers === 0 && button === 0) {
            actions.push({ type: "mouseDown", col, row });
          }
        } else if (release && (btn & (4 | 8 | 16)) === 0 && (btn & 3) === 0) {
          actions.push({ type: "mouseUp", col, row });
        }
        i += sgr[0].length;
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
          actions.push({ type: "focusOut" });
        } else if (code === "Z") {
          actions.push({ type: "shiftTab" });
        }
        i += csi[0].length;
        continue;
      }

      if (rest.length === 1 || (rest.length > 1 && rest[1] !== "[")) {
        actions.push({ type: "escape" });
        i += 1;
        continue;
      }

      // Unknown incomplete CSI — keep buffering rather than typing params as chars.
      return { actions, rest };
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
export function coalescePasteActions(actions: InputAction[]): InputAction[] {
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

export type ContentClickAction =
  | { type: "toggleThought"; turnId: string; thoughtIndex: number }
  | { type: "toggleToolGroup"; turnId: string; groupId: string }
  | { type: "toggleChoice"; turnId: string; choiceId: string }
  | { type: "toggleToolError"; turnId: string; toolId: string }
  | { type: "togglePlanTool"; turnId: string; toolId: string }
  | { type: "toggleWriteTool"; turnId: string; toolId: string }
  | { type: "toggleEditTool"; turnId: string; toolId: string }
  | { type: "toggleSkillTool"; turnId: string; toolId: string }
  | { type: "toggleAgentTool"; turnId: string; toolId: string };

/** Map a screen row to a scrollable content line index, or null when out of range. */
export function contentLineIndexFromScreen(
  screenRow: number,
  headerHeight: number,
  scrollHeight: number,
): number | null {
  const index = screenRow - (headerHeight + 1);
  if (index < 0 || index >= scrollHeight) return null;
  return index;
}

export function visibleRenderLinesAtScroll(
  allLines: RenderLine[],
  scrollOffset: number,
  scrollHeight: number,
): RenderLine[] {
  const maxOffset = Math.max(0, allLines.length - scrollHeight);
  const offset = Math.min(scrollOffset, maxOffset);
  return allLines.slice(offset, offset + scrollHeight);
}

export function resolveContentClickAction(line: RenderLine | undefined): ContentClickAction | null {
  if (!line?.meta) return null;
  if (
    isThoughtSummaryLine(line) &&
    line.meta.turnId &&
    typeof line.meta.thoughtIndex === "number"
  ) {
    return {
      type: "toggleThought",
      turnId: line.meta.turnId,
      thoughtIndex: line.meta.thoughtIndex,
    };
  }
  if (isToolGroupToggleLine(line.meta) && line.meta.groupId) {
    return { type: "toggleToolGroup", turnId: line.meta.turnId, groupId: line.meta.groupId };
  }
  if (isChoiceToggleLine(line.meta) && line.meta.choiceId) {
    return { type: "toggleChoice", turnId: line.meta.turnId, choiceId: line.meta.choiceId };
  }
  if (isToolErrorToggleLine(line.meta) && line.meta.toolId) {
    return { type: "toggleToolError", turnId: line.meta.turnId, toolId: line.meta.toolId };
  }
  if (isPlanToolToggleLine(line.meta) && line.meta.toolId) {
    return { type: "togglePlanTool", turnId: line.meta.turnId, toolId: line.meta.toolId };
  }
  if (isWriteToolToggleLine(line.meta) && line.meta.toolId) {
    return { type: "toggleWriteTool", turnId: line.meta.turnId, toolId: line.meta.toolId };
  }
  if (isEditToolToggleLine(line.meta) && line.meta.toolId) {
    return { type: "toggleEditTool", turnId: line.meta.turnId, toolId: line.meta.toolId };
  }
  if (isSkillToolToggleLine(line.meta) && line.meta.toolId) {
    return { type: "toggleSkillTool", turnId: line.meta.turnId, toolId: line.meta.toolId };
  }
  if (isAgentToolToggleLine(line.meta) && line.meta.toolId) {
    return { type: "toggleAgentTool", turnId: line.meta.turnId, toolId: line.meta.toolId };
  }
  return null;
}

export function contentClickMousePhase(
  mouseDragTracking: boolean,
  phase: "mouseDown" | "mouseUp",
): "click" | "ignore" {
  if (mouseDragTracking) return phase === "mouseUp" ? "click" : "ignore";
  return phase === "mouseDown" ? "click" : "ignore";
}

export function resolveContentClickTarget(opts: {
  allLines: RenderLine[];
  scrollOffset: number;
  scrollHeight: number;
  screenRow: number;
  headerHeight: number;
}): ContentClickAction | null {
  const index = contentLineIndexFromScreen(opts.screenRow, opts.headerHeight, opts.scrollHeight);
  if (index === null) return null;
  const visible = visibleRenderLinesAtScroll(opts.allLines, opts.scrollOffset, opts.scrollHeight);
  return resolveContentClickAction(visible[index]);
}

function footerSeparator(cols: number): string {
  return `${ansi.line}${H.repeat(cols)}${ansi.reset}`;
}

function inputFooterSeparator(cols: number): string {
  return `${ansi.inputBorder}${H.repeat(cols)}${ansi.reset}`;
}

export interface AgentsPanelHandlers {
  entryCwd: () => string;
  loadSessions: () => Promise<SessionMeta[]>;
  loadBgTasks: () => BackgroundTask[];
  /** Session ids with in-flight agent/workflow background work. */
  loadRunningBgSessionIds: () => ReadonlySet<string>;
  /** Session ids with resumable interrupted BG checkpoints (needs input). */
  loadInterruptedSessionIds: () => Promise<ReadonlySet<string>>;
  previewForSession: (sessionId: string) => Promise<string>;
  /** Sum of model answer durations for the Agents time column. */
  answerDurationForSession: (sessionId: string) => Promise<number>;
  onOpenSession: (sessionId: string) => Promise<void>;
  onCreateSession: (text: string) => Promise<string>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onReplySession: (sessionId: string, text: string) => Promise<void>;
  /** Called when Agents closes back to chat (same or switched session). */
  onAgentsClosed?: () => void | Promise<void>;
  modelLabel: () => string;
  agentName: () => string;
  version: string;
}

/** Snapshot of a chat session's UI while another session is in the foreground. */
interface ParkedChatSession {
  turns: ChatTurn[];
  activeTurn: ChatTurn | null;
  plainLines: string[];
  tipText: string | null;
  scrollOffset: number;
  followBottom: boolean;
  pendingImages: Array<{ index: number; attachment: UserAttachment }>;
  nextImageIndex: number;
  turnExitRequested: boolean;
  turnDiscardOnAbort: boolean;
  turnRestoreInput: string | null;
  shortcutsOverride: string | null;
  activeFooterHeight: number;
  readingChoice: boolean;
  wizardMode: boolean;
  choiceResolve: ((row: ChoiceRow) => void) | null;
  choiceReject: ((reason: Error) => void) | null;
  wizardResolve: ((result: AskUserQuestionResult) => void) | null;
  wizardReject: ((reason: Error) => void) | null;
  choiceHeader: string;
  choiceQuestion: string;
  choiceRows: ChoiceRow[];
  choiceSelected: number;
  choiceQuestionIndex: number;
  choiceQuestionTotal: number;
  choiceShowHeader: boolean;
  choiceMultiSelect: boolean;
  choiceCheckedOptions: Set<number>;
  choiceCustomText: string;
  choiceCustomChecked: boolean;
  wizardQuestions: AskUserQuestionItem[];
  wizardAnswers: Record<string, string>;
  wizardAnnotations: NonNullable<AskUserQuestionResult["annotations"]>;
  wizardFocus: number;
  readingConfirm: boolean;
  confirmResolve: ((allowed: boolean) => void) | null;
  planReviewMode: boolean;
  planReviewPath: string;
  planReviewText: string;
  planReviewSelected: number;
  planReviewResolve: ((decision: PlanReviewDecision) => void) | null;
  workflowConfirmMode: boolean;
  workflowConfirmMeta: WorkflowMeta | null;
  workflowConfirmArgs: unknown;
  workflowConfirmScriptSource: string;
  workflowConfirmScriptPath: string;
  workflowConfirmView: WorkflowConfirmViewState;
  workflowConfirmResolve: ((decision: WorkflowConfirmDecision) => void) | null;
  toolApprovalMode: boolean;
  toolApprovalContent: ToolApprovalContent | null;
  toolApprovalSelected: number;
  toolApprovalResolve: ((result: ToolConfirmResult) => void) | null;
  pendingToolApprovalCall: ToolCall | null;
  pendingToolApprovalCwd: string | undefined;
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
  private historyClearHintTimer: ReturnType<typeof setTimeout> | null = null;
  private rewindArmHintTimer: ReturnType<typeof setTimeout> | null = null;
  private rewindHandlers: RewindHandlers | null = null;
  private readingRewind = false;
  private rewindPhase: "list" | "confirm" = "list";
  private rewindRows: RewindListRow[] = [];
  private rewindSelected = 0;
  private rewindConfirmAnchor: RewindTurnAnchor | null = null;
  private rewindConfirmHasCodeChanges = false;
  private rewindConfirmActionIndex = 0;
  private rewindConfirmContext = "";
  private rewindBusy = false;
  /** Serialize Rewind stdin so restore await cannot race a trailing `\\n`. */
  private rewindInputChain: Promise<void> = Promise.resolve();
  /** Timestamp until which readLine Enter is ignored (Rewind confirm key leak). */
  private suppressReadLineEnterUntil = 0;
  private suppressReadLineEnterTimer: ReturnType<typeof setTimeout> | null = null;
  /** Until when Rewind should ignore Enter (delayed LF after list→confirm). */
  private skipRewindEnterUntil = 0;
  private resizeListener: (() => void) | null = null;
  private resumeListener: (() => void) | null = null;
  private sigintListener: (() => void) | null = null;
  private lastTerminalModesAssertedAt = 0;
  private modeReassertTimer: ReturnType<typeof setInterval> | null = null;
  private sigintStreak = 0;
  private lastSigintAt = 0;
  private redrawDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPaintedHeaderLines = 0;
  /** Set when the terminal may have cleared the alt-screen buffer (focus/resume). */
  private viewportNeedsFullRedraw = false;
  private inputListener: ((chunk: string) => void) | null = null;
  private inputResolve: ((value: string) => void) | null = null;
  private inputReject: ((reason: Error) => void) | null = null;
  private inputBuffer = "";
  private inputCursor = 0;
  private inputScrollRow = 0;
  private inputRowsScreenStart = 0;
  private inputRowsScreenCount = 0;
  private inputSelectAnchor: number | null = null;
  private inputSelectEnd: number | null = null;
  private inputMouseSelecting = false;
  /** True while ?1002 is on — clicks resolve on mouseUp; otherwise on mouseDown (X10). */
  private mouseDragTracking = false;
  private copyHintText: string | null = null;
  private copyHintTimer: ReturnType<typeof setTimeout> | null = null;
  private stdinRest = "";
  /** Flushes a lone buffered ESC when no CSI bytes follow (Esc key). */
  private stdinRestFlushTimer: ReturnType<typeof setTimeout> | null = null;
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
  /** Drop the in-flight turn instead of committing it to chat history. */
  private turnDiscardOnAbort = false;
  /** Restore this prompt to the input box after Esc cancels a turn. */
  private turnRestoreInput: string | null = null;
  /** Second Ctrl+C during an active turn — exit the chat session. */
  private appExitRequested = false;
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
  /** Inline Type something buffer for multi-select. */
  private choiceCustomText = "";
  /** Enter/Space arms Type something; empty leave / clear text unchecks. */
  private choiceCustomChecked = false;
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

  private workflowFooters: WorkflowFooterState[] = [];
  private workflowWaitingCount = 0;
  private backgroundAgentWaitingCount = 0;
  /** Footer ↓ focus: input (default) or in-session agent list. */
  private agentSwitcherFocus: SessionAgentFocus = "input";
  private agentSwitcherSelected = 0;
  /** Read-only peek at a subagent transcript; ← pops back to main. */
  private agentDetailSnapshot: {
    turns: ChatTurn[];
    activeTurn: ChatTurn | null;
    plainLines: string[];
    tipText: string | null;
    scrollOffset: number;
    followBottom: boolean;
  } | null = null;
  private agentDetailChildSessionId: string | null = null;
  /**
   * Footer pin for the open Explore detail. Completed agents are deleted from
   * the task store — keep this row until detail closes so ↓ can return to main.
   */
  private agentDetailFooterPin: SessionSubagentRow | null = null;
  /** Throttle L0 reload while watching a still-running Explore detail. */
  private lastAgentDetailRefreshAt = 0;

  private isViewingAgentDetail(): boolean {
    return this.agentDetailChildSessionId !== null;
  }
  private workflowPollTimer: ReturnType<typeof setInterval> | null = null;
  private workflowPollSessionId = "";

  private interruptedHintCount = 0;
  private interruptedResumeHandler: (() => void | Promise<void>) | null = null;
  private interruptedDismissHandler: (() => void | Promise<void>) | null = null;

  private readingWorkflowsPanel = false;
  private workflowsPanelState: WorkflowsPanelState = createInitialWorkflowsPanelState();
  private workflowsPanelSessionId = "";
  private workflowsPanelResolve: (() => void) | null = null;

  private readingAgentsPanel = false;
  private agentsPanelState: AgentsPanelState = createAgentsPanelState({
    entryCwd: "",
    entrySessionId: "",
    modelLabel: "",
    agentName: "main",
    version: "",
    metas: [],
  });
  private agentsPanelMetas: SessionMeta[] = [];
  private agentsPanelResolve: (() => void) | null = null;
  private agentsPanelHandlers: AgentsPanelHandlers | null = null;
  private agentsExitHintActive = false;
  private agentsPanelTickTimer: ReturnType<typeof setInterval> | null = null;
  private agentsPanelReloadTick = 0;
  /** Last painted Agents screen lines (diff paint — avoids full-clear flicker while typing). */
  private lastAgentsPanelRendered: string[] = [];
  private lastAgentsPanelSize = { cols: 0, rows: 0 };
  /** Remember selection + scroll when leaving Agents so ← back restores position. */
  private agentsPanelResume: {
    selectedSessionId?: string;
    listScrollOffset: number;
    collapsed: AgentsPanelState["collapsed"];
  } | null = null;
  /** When false, Agents redraw keeps free wheel scroll (does not pin selection). */
  private agentsPinSelection = true;
  /** Parked chat UI for sessions left mid-turn / mid-prompt (Agents switch). */
  private parkedSessions = new Map<string, ParkedChatSession>();
  /** Session id that owns the in-flight streaming turn (may differ from visible session). */
  private liveTurnSessionId: string | null = null;
  /**
   * Session that currently owns the live layout overlay (choice / approval / plan).
   * Concurrent turns wait in acquireSessionOverlay until they can present.
   */
  private sessionOverlayOwner: string | null = null;
  /** Waiters blocked until their session is foreground and Agents is closed. */
  private sessionOverlayWaiters = new Map<string, Array<() => void>>();
  private afterAgentsClose: (() => Promise<void>) | null = null;
  /** Serialize Agents key/mouse handling so Ctrl+C arm and close cannot race. */
  private agentsInputChain: Promise<void> = Promise.resolve();
  /** Waiters blocked in readLine / chat loop until Agents closes. */
  private agentsPanelClosedWaiters: Array<() => void> = [];

  private workflowConfirmMode = false;
  private workflowConfirmMeta: WorkflowMeta | null = null;
  private workflowConfirmArgs: unknown;
  private workflowConfirmScriptSource = "";
  private workflowConfirmScriptPath = "";
  private workflowConfirmCwd = "";
  private workflowConfirmView: WorkflowConfirmViewState = {
    scriptVisible: false,
    scriptToggled: false,
    selectedIndex: 0,
  };
  private workflowConfirmResolve: ((decision: WorkflowConfirmDecision) => void) | null = null;

  private toolApprovalMode = false;
  private toolApprovalContent: ToolApprovalContent | null = null;
  private toolApprovalSelected = 0;
  private toolApprovalResolve: ((result: ToolConfirmResult) => void) | null = null;
  private pendingToolApprovalCall: ToolCall | null = null;
  private pendingToolApprovalCwd: string | undefined;

  private inputHistory = new InputHistory();
  private permissionMode: PermissionMode = "default";
  private onPermissionModeChange?: (mode: PermissionMode) => void;
  private onPromoteForegroundAgent?: () => string | null;
  private steppedAwayRecapHandler: (() => void | Promise<void>) | null = null;
  private lastFocusOutAt = 0;
  private steppedAwayRecapInFlight = false;
  /** When true, reasoning/answer/tool stream callbacks must not touch the chat timeline. */
  private chatStreamMuted = false;

  /** Sync CLI permission mode with the agent runtime (shift+tab, EnterPlanMode, etc.). */
  setPermissionModeChangeHandler(handler: (mode: PermissionMode) => void): void {
    this.onPermissionModeChange = handler;
  }

  /** Wire ctrl+b → runtime.promoteForegroundAgent for the active session. */
  setPromoteForegroundAgentHandler(handler: () => string | null): void {
    this.onPromoteForegroundAgent = handler;
  }

  /** Session lifecycle wake for stepped-away recap (does not route tools/modes). */
  setSteppedAwayRecapHandler(handler: (() => void | Promise<void>) | null): void {
    this.steppedAwayRecapHandler = handler;
  }

  /**
   * Invoke the stepped-away recap wake when idle after focus return.
   * Safe to call from chat wiring; no-ops when a turn/overlay is active.
   */
  requestSteppedAwayRecap(): void {
    if (!this.steppedAwayRecapHandler) return;
    if (this.steppedAwayRecapInFlight) return;
    if (this.isTurnInProgress()) return;
    if (this.hasForegroundBlockingOverlay()) return;
    const last = this.lastSubstantiveCompletedTurn();
    if (!last) return;
    this.steppedAwayRecapInFlight = true;
    void Promise.resolve(this.steppedAwayRecapHandler())
      .catch(() => {})
      .finally(() => {
        this.steppedAwayRecapInFlight = false;
      });
  }

  markActiveTurnHarnessOnly(opts?: { silentChat?: boolean }): void {
    if (!this.activeTurn) return;
    this.activeTurn.harnessOnly = true;
    if (opts?.silentChat) this.activeTurn.silentChat = true;
  }

  /**
   * Mute live stream → chat timeline (stepped-away recap and similar protocol wakes).
   * Model output is consumed via runTurn's return value / session meta only.
   */
  muteChatStream(): void {
    this.chatStreamMuted = true;
  }

  unmuteChatStream(): void {
    this.chatStreamMuted = false;
  }

  isChatStreamMuted(): boolean {
    return this.chatStreamMuted;
  }

  /**
   * Drop streamed chat chrome from a protocol wake (stepped-away recap).
   * Result text is applied via applyRecapToLastCompletedTurn — nothing stays in the timeline.
   */
  suppressActiveTurnAnswer(): void {
    if (!this.activeTurn) return;
    this.activeTurn.answerText = "";
    this.activeTurn.timeline = this.activeTurn.timeline.filter(
      (e) => e.type !== "answer" && e.type !== "thinking",
    );
    this.activeTurn.expandedThoughts.clear();
  }

  /** Attach scrubbed recap to the latest completed non-harness turn. */
  applyRecapToLastCompletedTurn(recapText: string): void {
    const trimmed = recapText.trim();
    if (!trimmed) return;
    const turn = this.lastSubstantiveCompletedTurn();
    if (!turn) return;
    turn.recapText = trimmed;
    this.invalidateContentCache();
    this.redrawContent();
  }

  private lastSubstantiveCompletedTurn(): ChatTurn | null {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      const turn = this.turns[i];
      if (!turn || turn.harnessOnly) continue;
      if (turn.phase !== "done") continue;
      return turn;
    }
    return null;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
    if (this.active) {
      this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
    }
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  private cyclePermissionMode(): void {
    this.onPermissionModeChange?.(nextPermissionMode(this.permissionMode));
  }

  private sessionManageableAgentTasks(): BackgroundTask[] {
    if (!this.sessionId) return [];
    return listBackgroundTasks(this.sessionId).filter((t) => t.kind === "agent" && !t.stopped);
  }

  private sessionHasManageableAgents(): boolean {
    // Detail pin counts even after the child task is removed on completion.
    return this.sessionAgentRows().length > 0;
  }

  private sessionAgentRows(): SessionAgentRow[] {
    return buildSessionAgentRowsWithDetailPin(
      this.sessionManageableAgentTasks(),
      this.isViewingAgentDetail() ? this.agentDetailFooterPin : null,
    );
  }

  private focusAgentList(): void {
    const rows = this.sessionAgentRows();
    if (rows.length === 0) return;
    this.agentSwitcherFocus = focusFromInputDown(true);
    // First ↓ highlights the session currently on screen (main or Explore).
    this.agentSwitcherSelected = currentSessionAgentIndex(
      rows,
      this.agentDetailChildSessionId,
    );
    process.stdout.write(HIDE_CURSOR);
    this.invalidateContentCache();
    this.redrawContent();
    this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
  }

  private blurAgentListToInput(): void {
    this.agentSwitcherFocus = "input";
    this.agentSwitcherSelected = currentSessionAgentIndex(
      this.sessionAgentRows(),
      this.agentDetailChildSessionId,
    );
    this.invalidateContentCache();
    this.redrawContent();
    this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
    // redrawContent → drawFooter already places the caret when allowed; ensure
    // we never leave the list's HIDE_CURSOR stuck during a live turn.
    this.placeInputCaretIfNeeded();
  }

  /** True while the user can type into the chat box during an in-flight turn. */
  private canComposeWhileBusy(): boolean {
    return (
      !this.readingLine &&
      !this.inputResolve &&
      this.isTurnInProgress() &&
      this.agentSwitcherFocus === "input" &&
      !this.isFooterOverlayActive()
    );
  }

  private placeInputCaretIfNeeded(): void {
    if (
      !shouldShowChatInputCaret({
        listFocused: this.agentSwitcherFocus === "list",
        overlayActive: this.isFooterOverlayActive(),
        mouseSelecting: this.inputMouseSelecting,
        hasSelection: this.inputSelectionRange() !== null,
        awaitingLine: Boolean(this.inputResolve) || this.readingLine,
        turnInProgress: this.isTurnInProgress(),
      })
    ) {
      return;
    }
    if (this.inputRowsScreenCount <= 0) return;
    const { cols } = getTerminalSize();
    const inputRendered = renderMultilineInput({
      value: this.inputBuffer,
      cursor: this.inputCursor,
      scrollRow: this.inputScrollRow,
      cols,
      placeholder: this.inputResolve ? this.readLinePlaceholder : undefined,
      selection: this.inputSelectionRange(),
    });
    const col = Math.min(cols, inputRendered.cursorScreenCol);
    process.stdout.write(
      moveTo(this.inputRowsScreenStart + inputRendered.cursorScreenRow, col),
    );
    process.stdout.write(SHOW_CURSOR);
  }

  private syncAgentSwitcherAfterTasksChange(): void {
    const rows = this.sessionAgentRows();
    if (this.agentSwitcherFocus === "list") {
      if (rows.length === 0) {
        this.blurAgentListToInput();
        return;
      }
      this.agentSwitcherSelected = Math.min(this.agentSwitcherSelected, rows.length - 1);
    }
    // Footer only — parent task changes must not reload the child transcript body.
    const detailId = this.agentDetailChildSessionId;
    if (detailId && !this.isChildAgentSessionRunning(detailId)) {
      this.freezeAgentDetailFooterPin(detailId);
    }
    if (this.active) {
      this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
    }
  }

  private isChildAgentSessionRunning(childSessionId: string): boolean {
    if (!this.sessionId || !childSessionId) return false;
    return listBackgroundTasks(this.sessionId).some(
      (t) => t.kind === "agent" && !t.stopped && t.childSessionId === childSessionId,
    );
  }

  freezeAgentDetailFooterPin(childSessionId: string): void {
    if (
      !this.agentDetailFooterPin ||
      this.agentDetailFooterPin.childSessionId !== childSessionId ||
      this.agentDetailFooterPin.endedAt
    ) {
      return;
    }
    this.agentDetailFooterPin = {
      ...this.agentDetailFooterPin,
      endedAt: new Date().toISOString(),
    };
    if (this.agentDetailChildSessionId === childSessionId && this.active) {
      this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
    }
  }

  private async openAgentDetail(childSessionId: string): Promise<void> {
    if (!childSessionId) return;
    if (!this.agentDetailSnapshot) {
      this.agentDetailSnapshot = {
        turns: this.turns,
        activeTurn: this.activeTurn,
        plainLines: this.plainLines,
        tipText: this.tipText,
        scrollOffset: this.scrollOffset,
        followBottom: this.followBottom,
      };
    }
    this.agentDetailChildSessionId = childSessionId;
    this.agentDetailFooterPin = resolveAgentDetailPinRow(
      listBackgroundTasks(this.sessionId || ""),
      childSessionId,
    );
    this.plainLines = [];
    this.tipText = null;
    this.followBottom = true;
    this.agentSwitcherFocus = "input";
    await this.loadAgentDetailContent(childSessionId);
    this.invalidateContentCache();
    this.scrollToBottom();
    this.redrawContent();
    this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
    if (!this.isChildAgentSessionRunning(childSessionId)) {
      this.freezeAgentDetailFooterPin(childSessionId);
    } else {
      this.startTurnTick();
    }
  }

  /**
   * Live UI turns use `turn-*` ids (beginTurnForSession). L0 rebuilds use `hist-*`.
   * Prefer the live stream so Explore detail paints tools/text as they arrive.
   */
  private isLiveStreamingTurn(turn: ChatTurn | null | undefined): boolean {
    return Boolean(turn && turn.phase !== "done" && turn.id.startsWith("turn-"));
  }

  /**
   * Prefer parked live turn; otherwise rebuild from L0. If the child agent is still
   * running, the latest transcript turn stays open (no premature `* Done`).
   */
  private async loadAgentDetailContent(childSessionId: string): Promise<void> {
    this.syncAgentDetailFromChild(childSessionId);
    const park = this.parkedSessions.get(childSessionId);
    if (this.isLiveStreamingTurn(park?.activeTurn)) {
      this.turns = park!.turns;
      this.activeTurn = park!.activeTurn;
      return;
    }

    const prevActive = this.activeTurn;
    const memory = new FileMemoryStore(childSessionId);
    const transcript = await memory.loadTranscript();
    const rebuilt = chatTurnsFromTranscript(transcript);
    if (this.isChildAgentSessionRunning(childSessionId) && rebuilt.length > 0) {
      const { completed, active } = reopenLastTranscriptTurn(rebuilt);
      if (!active) {
        this.turns = rebuilt;
        this.activeTurn = null;
        return;
      }
      // Keep expand/collapse + pulse across L0 reloads so scroll height does not jump.
      if (prevActive && this.agentDetailChildSessionId === childSessionId) {
        active.expandedToolGroups = prevActive.expandedToolGroups;
        active.expandedThoughts = prevActive.expandedThoughts;
        active.expandedChoices = prevActive.expandedChoices;
        active.pulseFrame = prevActive.pulseFrame;
      }
      this.ensureParkedShell(childSessionId);
      const next = this.parkedSessions.get(childSessionId)!;
      next.turns = completed;
      next.activeTurn = active;
      this.turns = completed;
      this.activeTurn = active;
      return;
    }

    this.turns = rebuilt;
    this.activeTurn = null;
    if (park) {
      park.turns = rebuilt;
      park.activeTurn = null;
    }
  }

  /**
   * Reload Explore detail from L0 without yanking the viewport back to the bottom
   * when the user has scrolled up to read history.
   */
  private async refreshAgentDetailPreservingScroll(childSessionId: string): Promise<void> {
    const wasFollowing = this.followBottom;
    const distanceFromBottom = wasFollowing
      ? 0
      : Math.max(0, this.maxScrollOffset() - this.scrollOffset);
    await this.loadAgentDetailContent(childSessionId);
    if (this.agentDetailChildSessionId !== childSessionId || !this.active) return;
    this.invalidateContentCache();
    if (wasFollowing) {
      this.scrollToBottom();
    } else {
      const max = this.maxScrollOffset();
      this.scrollOffset = Math.max(0, max - distanceFromBottom);
      this.followBottom = false;
    }
    this.redrawContent();
    this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
  }

  /** Point chat body at a parked child's turns / live turn (same object refs as stream updates). */
  private syncAgentDetailFromChild(childSessionId: string): void {
    const parked = this.parkedSessions.get(childSessionId);
    if (!parked) return;
    this.turns = parked.turns;
    this.activeTurn = parked.activeTurn;
  }

  private closeAgentDetail(): void {
    const snap = this.agentDetailSnapshot;
    if (!snap) return;
    this.agentDetailSnapshot = null;
    this.agentDetailChildSessionId = null;
    this.agentDetailFooterPin = null;
    this.turns = snap.turns;
    this.activeTurn = snap.activeTurn;
    this.plainLines = snap.plainLines;
    this.tipText = snap.tipText;
    this.scrollOffset = snap.scrollOffset;
    this.followBottom = snap.followBottom;
    this.invalidateContentCache();
    if (this.followBottom) this.scrollToBottom();
    this.redrawContent();
    this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
  }

  private async stopSelectedBackgroundAgent(): Promise<void> {
    const rows = this.sessionAgentRows();
    const row = rows[this.agentSwitcherSelected];
    if (!row || row.kind !== "subagent" || !this.sessionId) return;
    await stopBackgroundTask(this.sessionId, row.taskId);
    this.syncAgentSwitcherAfterTasksChange();
  }

  /** Handle keys while agent list is focused. Returns true if consumed. */
  private async handleAgentListAction(action: InputAction): Promise<boolean> {
    if (this.agentSwitcherFocus !== "list") return false;
    const rows = this.sessionAgentRows();
    if (rows.length === 0) {
      this.blurAgentListToInput();
      return true;
    }

    if (action.type === "escape") {
      this.blurAgentListToInput();
      return true;
    }
    if (action.type === "historyUp") {
      const next = focusAfterListUp(this.agentSwitcherSelected, rows.length);
      if (next.focus === "input") {
        // Leave the list → input box gets the block cursor back.
        this.blurAgentListToInput();
        return true;
      }
      this.agentSwitcherFocus = next.focus;
      this.agentSwitcherSelected = next.selected;
      this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
      return true;
    }
    if (action.type === "historyDown") {
      this.agentSwitcherSelected = moveAgentSelection(
        this.agentSwitcherSelected,
        1,
        rows.length,
      );
      this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
      return true;
    }
    if (action.type === "enter") {
      const row = rows[this.agentSwitcherSelected];
      if (!row) return true;
      if (row.kind === "main") {
        if (this.agentDetailSnapshot) this.closeAgentDetail();
        this.blurAgentListToInput();
        return true;
      }
      if (row.childSessionId) {
        await this.openAgentDetail(row.childSessionId);
      } else {
        this.blurAgentListToInput();
      }
      return true;
    }
    if (action.type === "char" && action.char.toLowerCase() === "x") {
      await this.stopSelectedBackgroundAgent();
      return true;
    }
    if (action.type === "cursorLeft") {
      if (shouldPopAgentDetailOnLeft(this.agentDetailSnapshot !== null)) {
        this.closeAgentDetail();
        return true;
      }
      return false;
    }
    // Wheel / PageUp·PageDown must reach the chat viewport (list focus used to swallow them).
    if (action.type === "scroll") {
      return false;
    }
    // Typing while list-focused returns to input and lets the key apply.
    if (
      action.type === "char" ||
      action.type === "paste" ||
      action.type === "pasteText" ||
      action.type === "backspace" ||
      action.type === "newline"
    ) {
      this.agentSwitcherFocus = "input";
      return false;
    }
    return true;
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

  async syncInputHistoryFromSession(
    sessionId: string,
    options?: { merge?: boolean },
  ): Promise<void> {
    const memory = new FileMemoryStore(sessionId);
    const transcript = await memory.loadTranscript();
    const fromTranscript = sessionInputHistory(transcript);
    if (options?.merge) {
      this.inputHistory.mergeFromTranscript(fromTranscript);
    } else {
      this.inputHistory.loadEntries(fromTranscript);
    }
  }

  /** Replace the visible chat timeline with turns rebuilt from the session L0 transcript. */
  async loadSessionFromTranscript(sessionId: string): Promise<void> {
    const memory = new FileMemoryStore(sessionId);
    const transcript = await memory.loadTranscript();
    this.plainLines = [];
    this.turns = chatTurnsFromTranscript(transcript);
    this.tipText = null;
    this.followBottom = true;
    // Display-only refresh. Never call discardActiveTurn() here — that clears a parked
    // live turn for another session (Agents switch → Working session loses mid-flight
    // answers / AskUserQuestion resume state).
    if (this.liveTurnSessionId === sessionId) {
      const live = this.liveTurnBucket().turn;
      this.activeTurn = live && live.phase !== "done" ? live : null;
      if (this.activeTurn) this.startTurnTick();
    } else {
      this.activeTurn = null;
    }
    this.invalidateContentCache();
    this.refreshHeader();
    this.scrollToBottom();
    this.redrawContent();
  }

  /**
   * /clear: wipe the visible chat for the current session and leave only the
   * slash command the user typed (not a model turn).
   */
  clearConversationToCommand(displayText: string): void {
    const sid = this.sessionId;
    if (this.liveTurnSessionId === sid) {
      this.activeTurn = null;
      this.liveTurnSessionId = this.findAnotherStreamingSessionId(sid);
    }
    this.parkedSessions.delete(sid);
    this.turns = [];
    this.plainLines = [];
    this.tipText = null;
    this.followBottom = true;
    this.clearInterruptedResumeHint();
    const now = Date.now();
    this.turns.push({
      id: `clear-${now}`,
      userText: displayText,
      answerText: "",
      thinkingStartedAt: now,
      thinkingEndedAt: now,
      finishedAt: now,
      doneVerb: null,
      generatingVerb: null,
      outputTokens: 0,
      phase: "done",
      timeline: [],
      expandedThoughts: new Set(),
      expandedToolGroups: new Set(),
      expandedChoices: new Set(),
      pulseFrame: 0,
      harnessOnly: true,
    });
    this.stopTurnTick();
    this.invalidateContentCache();
    this.refreshHeader();
    this.scrollToBottom();
    // Full erase — leftover native selection / stale cells after wipe look like a blue slab.
    this.viewportNeedsFullRedraw = true;
    this.reassertTerminalInputModes();
    this.redraw();
    this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
  }

  setSlashInvokableSkills(skills: SystemSkillEntry[]): void {
    this.slashInvokableSkills = skills;
  }

  isTurnInProgress(): boolean {
    // Only the *visible* session's turn — a parked/concurrent stream must not
    // block foreground notification flush or input for the open chat.
    if (this.chatStreamMuted) return true;
    if (this.isViewingAgentDetail()) {
      const childBusy = Boolean(this.activeTurn && this.activeTurn.phase !== "done");
      const parentBusy = Boolean(
        this.agentDetailSnapshot?.activeTurn &&
          this.agentDetailSnapshot.activeTurn.phase !== "done",
      );
      return childBusy || parentBusy;
    }
    return Boolean(this.activeTurn && this.activeTurn.phase !== "done");
  }

  /** True when the given session still has an in-flight UI turn (visible or parked). */
  isTurnInProgressFor(sessionId: string): boolean {
    if (sessionId === this.sessionId) return this.isTurnInProgress();
    const park = this.parkedSessions.get(sessionId);
    return Boolean(park?.activeTurn && park.activeTurn.phase !== "done");
  }

  private canInterruptActiveTurn(): boolean {
    const busy =
      this.isTurnInProgress() ||
      (this.readingAgentsPanel &&
        this.liveTurnSessionId != null &&
        this.isTurnInProgressFor(this.liveTurnSessionId));
    return (
      busy &&
      !this.readingChoice &&
      !this.readingConfirm &&
      !this.planReviewMode &&
      !this.workflowConfirmMode &&
      !this.toolApprovalMode &&
      !this.readingWorkflowsPanel
    );
  }

  /** Esc during generation — abort, discard UI turn, restore prompt for editing. */
  requestTurnCancelForEdit(): void {
    if (!this.canInterruptActiveTurn()) return;
    const turn =
      this.activeTurn ??
      (this.liveTurnSessionId
        ? (this.parkedSessions.get(this.liveTurnSessionId)?.activeTurn ?? null)
        : null);
    if (!turn || turn.phase === "done") return;
    this.turnRestoreInput = turn.userText;
    this.turnDiscardOnAbort = true;
    this.turnExitRequested = true;
  }

  /**
   * After Esc cancels an Agents reply/create turn: drop the partial UI turn and
   * put the prompt back in the reply/compose box for editing.
   * @returns true when an abort discard was applied (caller must not finishTurn).
   */
  applyAgentsTurnAbortCleanup(): boolean {
    if (!this.consumeTurnDiscardOnAbort()) return false;
    const restore = this.consumeTurnRestoreInput() ?? "";
    this.discardActiveTurn();
    if (!this.readingAgentsPanel || !restore) return true;
    if (this.agentsPanelState.mode === "reply") {
      this.agentsPanelState = {
        ...this.agentsPanelState,
        mode: "reply",
        replyBuffer: restore,
        replyCursor: restore.length,
        replyScrollRow: 0,
        replyContext: undefined,
        composeFocus: true,
      };
    } else {
      this.setAgentsActiveInput(restore, restore.length, true);
    }
    this.drawAgentsPanel();
    return true;
  }

  consumeTurnDiscardOnAbort(): boolean {
    const discard = this.turnDiscardOnAbort;
    this.turnDiscardOnAbort = false;
    return discard;
  }

  consumeTurnRestoreInput(): string | undefined {
    const text = this.turnRestoreInput;
    this.turnRestoreInput = null;
    return text ?? undefined;
  }

  consumeAppExitRequested(): boolean {
    const requested = this.appExitRequested;
    this.appExitRequested = false;
    if (requested) {
      debugStack("consumeAppExitRequested:true");
    }
    return requested;
  }

  discardActiveTurn(): void {
    const bucket = this.liveTurnBucket();
    const liveId = this.liveTurnSessionId;
    if (!bucket.turn && !this.activeTurn) return;
    bucket.setTurn(null);
    if (liveId === this.sessionId || !liveId) {
      this.activeTurn = null;
    }
    this.liveTurnSessionId = null;
    this.turnExitRequested = false;
    this.turnDiscardOnAbort = false;
    this.turnRestoreInput = null;
    this.tipText = null;
    this.stopTurnTick();
    this.clearExitHint();
    this.shortcutsOverride = null;
    this.followBottom = true;
    if (liveId === this.sessionId && !this.readingAgentsPanel) {
      this.invalidateContentCache();
      this.redrawContent();
    }
  }

  hasActiveTurn(): boolean {
    return (
      this.chatStreamMuted ||
      this.liveTurnBucket().turn !== null ||
      this.activeTurn !== null
    );
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

  armInterruptedResumeHint(
    count: number,
    onResume: () => void | Promise<void>,
    onDismiss: () => void | Promise<void>,
  ): void {
    this.interruptedHintCount = Math.max(0, count);
    this.interruptedResumeHandler = onResume;
    this.interruptedDismissHandler = onDismiss;
    if (this.readingLine) {
      this.drawFooter(this.inputBuffer, this.readLinePlain ? undefined : this.readLinePlaceholder);
    }
  }

  clearInterruptedResumeHint(): void {
    this.interruptedHintCount = 0;
    this.interruptedResumeHandler = null;
    this.interruptedDismissHandler = null;
    if (this.readingLine) {
      this.drawFooter(this.inputBuffer, this.readLinePlain ? undefined : this.readLinePlaceholder);
    }
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
      const running = listRunningWorkflows(runs);
      const liveFooters: WorkflowFooterState[] = [];
      const orphans: typeof running = [];
      for (const run of running) {
        const liveTask = getBackgroundTask(sessionId, run.taskId);
        if (shouldRenderWorkflowFooter(run, liveTask)) {
          const start = new Date(run.startedAt).getTime();
          liveFooters.push({
            name: run.name,
            description: run.description,
            agentsDone: run.agentsDone,
            agentsTotal: run.agentsTotal,
            agentsFailed: run.agentsFailed,
            elapsedMs: Date.now() - start,
            status: run.status === "pending" ? "pending" : "running",
            currentPhase: run.currentPhase,
          });
        } else {
          orphans.push(run);
        }
      }
      // Disk may still say running after Ctrl+C; heal so timers cannot keep ticking.
      for (const orphan of orphans) {
        await markOrphanWorkflowInterrupted(sessionId, orphan);
      }
      this.workflowFooters = liveFooters;
      const runsForWait =
        liveFooters.length === 0 && running.length > 0
          ? await loadWorkflowRuns(sessionId)
          : runs;
      this.workflowWaitingCount = this.isTurnInProgress()
        ? countRunningWorkflows(runsForWait)
        : 0;
      // Only true background agents (ctrl+b / run_in_background), not blocking foreground Explore.
      this.backgroundAgentWaitingCount = this.isTurnInProgress()
        ? countBackgroundWaitingAgents(listBackgroundTasks(sessionId))
        : 0;
      if (this.sessionId === sessionId) {
        this.syncAgentSwitcherAfterTasksChange();
      }
      if (this.readingAgentsPanel && this.agentsPanelState.entrySessionId === sessionId) {
        const runningBgSessionIds = new Set(
          this.agentsPanelHandlers?.loadRunningBgSessionIds() ?? [],
        );
        this.agentsPanelState = {
          ...this.agentsPanelState,
          bgTasks: listBackgroundTasks(sessionId).filter(
            (t) => t.kind === "agent" && !t.stopped,
          ),
          runningBgSessionIds,
        };
        this.agentsPanelState = {
          ...this.agentsPanelState,
          rows: buildAgentsRows(
            this.agentsPanelMetas,
            this.agentsPanelState.previews,
            this.agentsPanelState.collapsed,
            this.agentsPanelState.bgTasks,
            this.agentsPanelState.entrySessionId,
            this.agentsPanelState.sessionVisits,
            this.agentsPanelState.answerDurations,
            this.agentsPanelState.runningBgSessionIds,
            this.agentsPanelState.interruptedSessionIds,
          ),
        };
      }
      if (this.readingWorkflowsPanel && this.workflowsPanelSessionId === sessionId) {
        this.workflowsPanelState = {
          ...this.workflowsPanelState,
          runs: prepareWorkflowRunsForPanel(runs),
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
      if (this.isFooterOverlayActive()) {
        this.invalidateContentCache();
        this.redrawContent();
        return;
      }
      // Footer may grow/shrink when concurrent workflows start/finish — always repaint.
      this.invalidateContentCache();
      this.redrawContent();
    } catch {
      // Ignore transient read errors during polling.
    }
  }

  setAgentsPanelHandlers(handlers: AgentsPanelHandlers): void {
    this.agentsPanelHandlers = handlers;
  }

  setRewindHandlers(handlers: RewindHandlers): void {
    this.rewindHandlers = handlers;
  }

  /** Prefill the chat input while readLine is armed (e.g. after Rewind restore). */
  prefillInput(text: string): void {
    this.inputBuffer = text;
    this.inputCursor = text.length;
    this.inputScrollRow = 0;
    this.clearInputSelection();
    this.syncInputScrollRow();
    if (this.readingLine && !this.readingRewind) {
      this.drawFooter(this.inputBuffer, this.readLinePlain ? undefined : this.readLinePlaceholder);
    }
  }

  setAfterAgentsClose(fn: (() => Promise<void>) | null): void {
    this.afterAgentsClose = fn;
  }

  hasParkedSessions(): boolean {
    return this.parkedSessions.size > 0;
  }

  isAgentsPanelOpen(): boolean {
    return this.readingAgentsPanel;
  }

  /** Close Agents from chat handlers (e.g. to present resume approval). */
  dismissAgentsPanel(): void {
    this.closeAgentsPanel();
  }

  /** Resolve when Agents is not open (immediate if already closed). */
  async waitForAgentsPanelClosed(): Promise<void> {
    if (!this.readingAgentsPanel) return;
    await new Promise<void>((resolve) => {
      this.agentsPanelClosedWaiters.push(resolve);
    });
  }

  dropParkedSession(sessionId: string): void {
    this.parkedSessions.delete(sessionId);
    if (this.liveTurnSessionId === sessionId) {
      this.liveTurnSessionId = null;
    }
  }

  hasForegroundBlockingOverlay(): boolean {
    return (
      this.readingRewind ||
      this.readingChoice ||
      this.readingConfirm ||
      this.planReviewMode ||
      this.workflowConfirmMode ||
      this.toolApprovalMode
    );
  }

  /** Park the visible session's UI (keeps choice/tool promises pending) before switching. */
  parkForegroundSession(): void {
    if (!this.sessionId) return;
    if (this.agentDetailSnapshot) this.closeAgentDetail();
    this.agentSwitcherFocus = "input";
    this.agentSwitcherSelected = 0;
    this.closeRewindPanel();
    // Agents owns stdin — keep the outstanding readLine so exitApp can settle it.
    // Rejecting here lets the chat loop re-enter readLine while Agents is still open.
    if (this.readingLine && !this.readingAgentsPanel) {
      const reject = this.inputReject;
      const fromId = this.sessionId;
      this.finishReadLine();
      reject?.(new SessionHandoffError(fromId));
    }

    this.parkedSessions.set(this.sessionId, {
      turns: this.turns,
      activeTurn: this.activeTurn,
      plainLines: this.plainLines,
      tipText: this.tipText,
      scrollOffset: this.scrollOffset,
      followBottom: this.followBottom,
      pendingImages: this.pendingImages,
      nextImageIndex: this.nextImageIndex,
      turnExitRequested: this.turnExitRequested,
      turnDiscardOnAbort: this.turnDiscardOnAbort,
      turnRestoreInput: this.turnRestoreInput,
      shortcutsOverride: this.shortcutsOverride,
      activeFooterHeight: this.activeFooterHeight,
      readingChoice: this.readingChoice,
      wizardMode: this.wizardMode,
      choiceResolve: this.choiceResolve,
      choiceReject: this.choiceReject,
      wizardResolve: this.wizardResolve,
      wizardReject: this.wizardReject,
      choiceHeader: this.choiceHeader,
      choiceQuestion: this.choiceQuestion,
      choiceRows: this.choiceRows,
      choiceSelected: this.choiceSelected,
      choiceQuestionIndex: this.choiceQuestionIndex,
      choiceQuestionTotal: this.choiceQuestionTotal,
      choiceShowHeader: this.choiceShowHeader,
      choiceMultiSelect: this.choiceMultiSelect,
      choiceCheckedOptions: this.choiceCheckedOptions,
      choiceCustomText: this.choiceCustomText,
      choiceCustomChecked: this.choiceCustomChecked,
      wizardQuestions: this.wizardQuestions,
      wizardAnswers: this.wizardAnswers,
      wizardAnnotations: this.wizardAnnotations,
      wizardFocus: this.wizardFocus,
      readingConfirm: this.readingConfirm,
      confirmResolve: this.confirmResolve,
      planReviewMode: this.planReviewMode,
      planReviewPath: this.planReviewPath,
      planReviewText: this.planReviewText,
      planReviewSelected: this.planReviewSelected,
      planReviewResolve: this.planReviewResolve,
      workflowConfirmMode: this.workflowConfirmMode,
      workflowConfirmMeta: this.workflowConfirmMeta,
      workflowConfirmArgs: this.workflowConfirmArgs,
      workflowConfirmScriptSource: this.workflowConfirmScriptSource,
      workflowConfirmScriptPath: this.workflowConfirmScriptPath,
      workflowConfirmView: { ...this.workflowConfirmView },
      workflowConfirmResolve: this.workflowConfirmResolve,
      toolApprovalMode: this.toolApprovalMode,
      toolApprovalContent: this.toolApprovalContent,
      toolApprovalSelected: this.toolApprovalSelected,
      toolApprovalResolve: this.toolApprovalResolve,
      pendingToolApprovalCall: this.pendingToolApprovalCall,
      pendingToolApprovalCwd: this.pendingToolApprovalCwd,
    });

    this.turns = [];
    this.activeTurn = null;
    this.plainLines = [];
    this.tipText = null;
    this.scrollOffset = 0;
    this.followBottom = true;
    this.pendingImages = [];
    this.nextImageIndex = 1;
    this.turnExitRequested = false;
    this.turnDiscardOnAbort = false;
    this.turnRestoreInput = null;
    this.shortcutsOverride = null;
    this.detachOverlayUiForPark();
  }

  /** Restore a parked session UI. Returns false if nothing was parked. */
  restoreParkedSession(sessionId: string): boolean {
    const park = this.parkedSessions.get(sessionId);
    if (!park) return false;
    this.parkedSessions.delete(sessionId);

    this.turns = park.turns;
    this.activeTurn = park.activeTurn;
    this.plainLines = park.plainLines;
    this.tipText = park.tipText;
    this.scrollOffset = park.scrollOffset;
    this.followBottom = park.followBottom;
    this.pendingImages = park.pendingImages;
    this.nextImageIndex = park.nextImageIndex;
    this.turnExitRequested = park.turnExitRequested;
    this.turnDiscardOnAbort = park.turnDiscardOnAbort;
    this.turnRestoreInput = park.turnRestoreInput;
    this.shortcutsOverride = park.shortcutsOverride;
    this.activeFooterHeight = park.activeFooterHeight;

    this.readingChoice = park.readingChoice;
    this.wizardMode = park.wizardMode;
    this.choiceResolve = park.choiceResolve;
    this.choiceReject = park.choiceReject;
    this.wizardResolve = park.wizardResolve;
    this.wizardReject = park.wizardReject;
    this.choiceHeader = park.choiceHeader;
    this.choiceQuestion = park.choiceQuestion;
    this.choiceRows = park.choiceRows;
    this.choiceSelected = park.choiceSelected;
    this.choiceQuestionIndex = park.choiceQuestionIndex;
    this.choiceQuestionTotal = park.choiceQuestionTotal;
    this.choiceShowHeader = park.choiceShowHeader;
    this.choiceMultiSelect = park.choiceMultiSelect;
    this.choiceCheckedOptions = park.choiceCheckedOptions;
    this.choiceCustomText = park.choiceCustomText;
    this.choiceCustomChecked = park.choiceCustomChecked;
    this.wizardQuestions = park.wizardQuestions;
    this.wizardAnswers = park.wizardAnswers;
    this.wizardAnnotations = park.wizardAnnotations;
    this.wizardFocus = park.wizardFocus;
    this.readingConfirm = park.readingConfirm;
    this.confirmResolve = park.confirmResolve;
    this.planReviewMode = park.planReviewMode;
    this.planReviewPath = park.planReviewPath;
    this.planReviewText = park.planReviewText;
    this.planReviewSelected = park.planReviewSelected;
    this.planReviewResolve = park.planReviewResolve;
    this.workflowConfirmMode = park.workflowConfirmMode;
    this.workflowConfirmMeta = park.workflowConfirmMeta;
    this.workflowConfirmArgs = park.workflowConfirmArgs;
    this.workflowConfirmScriptSource = park.workflowConfirmScriptSource;
    this.workflowConfirmScriptPath = park.workflowConfirmScriptPath;
    this.workflowConfirmView = park.workflowConfirmView;
    this.workflowConfirmResolve = park.workflowConfirmResolve;
    this.toolApprovalMode = park.toolApprovalMode;
    this.toolApprovalContent = park.toolApprovalContent;
    this.toolApprovalSelected = park.toolApprovalSelected;
    this.toolApprovalResolve = park.toolApprovalResolve;
    this.pendingToolApprovalCall = park.pendingToolApprovalCall;
    this.pendingToolApprovalCwd = park.pendingToolApprovalCwd;

    this.invalidateContentCache();
    this.refreshHeader();
    if (this.activeTurn && this.activeTurn.phase !== "done") {
      this.liveTurnSessionId = sessionId;
      this.startTurnTick();
      this.updateGeneratingFooter();
    }
    if (
      park.readingChoice ||
      park.wizardMode ||
      park.readingConfirm ||
      park.planReviewMode ||
      park.workflowConfirmMode ||
      park.toolApprovalMode
    ) {
      this.sessionOverlayOwner = sessionId;
    }
    // Agents still covers the screen during onOpenSession — paint overlays after close.
    if (!this.readingAgentsPanel) {
      this.syncOverlayFooterAfterAgents();
      this.wakeSessionOverlayWaiters();
    }
    return true;
  }

  private detachOverlayUiForPark(): void {
    this.readingChoice = false;
    this.wizardMode = false;
    this.choiceResolve = null;
    this.choiceReject = null;
    this.wizardResolve = null;
    this.wizardReject = null;
    this.choiceRows = [];
    this.choiceShowHeader = false;
    this.choiceMultiSelect = false;
    this.choiceCheckedOptions = new Set();
    this.choiceCustomText = "";
    this.choiceCustomChecked = false;
    this.wizardQuestions = [];
    this.wizardAnswers = {};
    this.wizardAnnotations = {};
    this.wizardFocus = 0;
    this.readingConfirm = false;
    this.confirmResolve = null;
    this.planReviewMode = false;
    this.planReviewResolve = null;
    this.workflowConfirmMode = false;
    this.workflowConfirmResolve = null;
    this.toolApprovalMode = false;
    this.toolApprovalResolve = null;
    this.toolApprovalContent = null;
    this.pendingToolApprovalCall = null;
    this.activeFooterHeight = this.defaultFooterHeight;
  }

  private liveTurnBucket(forSessionId?: string | null): {
    turn: ChatTurn | null;
    setTurn: (turn: ChatTurn | null) => void;
    pushDone: (turn: ChatTurn) => void;
  } {
    const targetId = forSessionId ?? this.liveTurnSessionId;
    if (targetId && targetId !== this.sessionId) {
      this.ensureParkedShell(targetId);
      const park = this.parkedSessions.get(targetId)!;
      return {
        turn: park.activeTurn,
        setTurn: (turn) => {
          park.activeTurn = turn;
        },
        pushDone: (turn) => {
          park.turns.push(turn);
        },
      };
    }
    // Explore detail swaps the visible body onto the child transcript, but parent
    // tool UI events still arrive with the main sessionId. Keep nesting those
    // under the stashed main turn — otherwise Explore on main freezes at the
    // tools that ran before detail opened.
    const snap = this.agentDetailSnapshot;
    if (snap && (!targetId || targetId === this.sessionId)) {
      return {
        turn: snap.activeTurn,
        setTurn: (turn) => {
          snap.activeTurn = turn;
        },
        pushDone: (turn) => {
          snap.turns.push(turn);
        },
      };
    }
    return {
      turn: this.activeTurn,
      setTurn: (turn) => {
        this.activeTurn = turn;
      },
      pushDone: (turn) => {
        this.turns.push(turn);
      },
    };
  }

  /** Ensure a parked shell exists so off-screen Agents turns can own a timeline. */
  private ensureParkedShell(sessionId: string): void {
    if (this.parkedSessions.has(sessionId)) return;
    this.parkedSessions.set(sessionId, {
      turns: [],
      activeTurn: null,
      plainLines: [],
      tipText: null,
      scrollOffset: 0,
      followBottom: true,
      pendingImages: [],
      nextImageIndex: 1,
      turnExitRequested: false,
      turnDiscardOnAbort: false,
      turnRestoreInput: null,
      shortcutsOverride: null,
      activeFooterHeight: this.defaultFooterHeight,
      readingChoice: false,
      wizardMode: false,
      choiceResolve: null,
      choiceReject: null,
      wizardResolve: null,
      wizardReject: null,
      choiceHeader: "",
      choiceQuestion: "",
      choiceRows: [],
      choiceSelected: 0,
      choiceQuestionIndex: 0,
      choiceQuestionTotal: 0,
      choiceShowHeader: false,
      choiceMultiSelect: false,
      choiceCheckedOptions: new Set(),
      choiceCustomText: "",
      choiceCustomChecked: false,
      wizardQuestions: [],
      wizardAnswers: {},
      wizardAnnotations: {},
      wizardFocus: 0,
      readingConfirm: false,
      confirmResolve: null,
      planReviewMode: false,
      planReviewPath: "",
      planReviewText: "",
      planReviewSelected: 0,
      planReviewResolve: null,
      workflowConfirmMode: false,
      workflowConfirmMeta: null,
      workflowConfirmArgs: undefined,
      workflowConfirmScriptSource: "",
      workflowConfirmScriptPath: "",
      workflowConfirmView: {
        scriptVisible: false,
        scriptToggled: false,
        selectedIndex: 0,
      },
      workflowConfirmResolve: null,
      toolApprovalMode: false,
      toolApprovalContent: null,
      toolApprovalSelected: 0,
      toolApprovalResolve: null,
      pendingToolApprovalCall: null,
      pendingToolApprovalCwd: undefined,
    });
  }

  async openAgentsPanel(sessionId: string): Promise<void> {
    const handlers = this.agentsPanelHandlers;
    if (!handlers) return;

    debugLog("agents:open", { sessionId });
    const entryCwd = handlers.entryCwd();
    const metas = await handlers.loadSessions();
    debugLog("agents:loaded", {
      sessionId,
      metaCount: metas.length,
      ids: metas.slice(0, 20).map((m) => m.id),
    });
    const previews: Record<string, string> = {};
    const answerDurations: Record<string, number> = {};
    await Promise.all(
      metas.map(async (m) => {
        const [preview, durationMs] = await Promise.all([
          handlers.previewForSession(m.id),
          handlers.answerDurationForSession(m.id),
        ]);
        previews[m.id] = preview;
        answerDurations[m.id] = durationMs;
      }),
    );
    const bgTasks = handlers.loadBgTasks();
    const runningBgSessionIds = handlers.loadRunningBgSessionIds();
    const interruptedSessionIds = await handlers.loadInterruptedSessionIds();
    this.agentsPanelMetas = metas;
    const resume = this.agentsPanelResume;
    // Visiting Agents from chat marks the current chat page as read.
    const sessionVisits = await markAgentsSessionRead(sessionId);
    this.agentsPanelState = createAgentsPanelState({
      entryCwd,
      entrySessionId: sessionId,
      modelLabel: handlers.modelLabel(),
      agentName: handlers.agentName(),
      version: handlers.version,
      metas,
      previews,
      answerDurations,
      bgTasks,
      runningBgSessionIds,
      interruptedSessionIds,
      preferredSessionId: resume?.selectedSessionId ?? sessionId,
      listScrollOffset: resume?.listScrollOffset,
      collapsed: resume?.collapsed,
      sessionVisits,
    });
    this.readingAgentsPanel = true;
    if (process.stdout.isTTY) {
      process.stdout.write(ENABLE_MOUSE_ANY_EVENT);
    }
    this.invalidateContentCache();
    this.invalidateAgentsPanelPaint();
    this.drawAgentsPanel();
    this.startAgentsPanelTicker();

    return new Promise((resolve) => {
      this.agentsPanelResolve = resolve;
    });
  }

  appendPlanEnabledEvent(): void {
    if (!this.activeTurn) return;
    this.activeTurn.timeline.push({
      type: "event",
      lines: [renderPlanEnabledLine()],
    });
    this.invalidateContentCache();
    this.redrawContent();
  }

  appendPlanPreviewEvent(planPath: string, planText: string): void {
    if (!this.activeTurn) return;
    this.activeTurn.timeline.push({
      type: "plan-preview",
      planPath,
      planText,
    });
    this.invalidateContentCache();
    this.redrawContent();
  }

  async openWorkflowsPanel(sessionId: string): Promise<void> {
    const runs = prepareWorkflowRunsForPanel(await loadWorkflowRuns(sessionId));
    this.workflowsPanelSessionId = sessionId;
    this.workflowsPanelState = {
      ...createInitialWorkflowsPanelState(runs),
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
    installTerminalExitHooks();
    activeChatLayout = this;
    this.active = true;
    process.stdout.write(ENTER_ALT_SCREEN);
    process.stdout.write(HIDE_CURSOR);
    this.attachInput();
    this.resizeListener = () => this.scheduleFullRedraw();
    process.stdout.on("resize", this.resizeListener);
    if (process.platform !== "win32") {
      this.resumeListener = () => {
        this.reassertTerminalInputModes();
        this.scheduleFullRedraw();
      };
      process.on("SIGCONT", this.resumeListener);
    }
    // When raw mode was dropped (sleep / host reset), Ctrl+C arrives as SIGINT.
    this.sigintListener = () => {
      if (!this.active) return;
      const now = Date.now();
      if (now - this.lastSigintAt > CTRL_C_EXIT_MS) this.sigintStreak = 0;
      this.lastSigintAt = now;
      this.sigintStreak += 1;
      this.reassertTerminalInputModes();
      this.viewportNeedsFullRedraw = true;
      this.scheduleFullRedraw();
      if (this.sigintStreak >= SIGINT_HARD_EXIT_COUNT) {
        debugLog("SIGINT:hard-exit", { streak: this.sigintStreak });
        this.restoreTerminalOnExit();
        process.exit(130);
      }
      void this.dispatchInputActions([{ type: "interrupt" }]);
    };
    process.on("SIGINT", this.sigintListener);
    this.startModeReassertTimer();
    this.redraw();
  }

  stop(): void {
    if (!this.active) return;
    this.stopTurnTick();
    this.stopWorkflowPolling();
    this.clearExitHint();
    this.stopModeReassertTimer();
    this.detachInput();
    if (this.resizeListener) {
      process.stdout.off("resize", this.resizeListener);
      this.resizeListener = null;
    }
    if (this.resumeListener) {
      process.off("SIGCONT", this.resumeListener);
      this.resumeListener = null;
    }
    if (this.sigintListener) {
      process.off("SIGINT", this.sigintListener);
      this.sigintListener = null;
    }
    if (this.redrawDebounceTimer) {
      clearTimeout(this.redrawDebounceTimer);
      this.redrawDebounceTimer = null;
    }
    process.stdout.write(LEAVE_ALT_SCREEN);
    this.active = false;
    if (activeChatLayout === this) activeChatLayout = null;
  }

  /** Best-effort terminal restore when the process exits or crashes mid-session. */
  restoreTerminalOnExit(): void {
    this.stopModeReassertTimer();
    if (this.sigintListener) {
      process.off("SIGINT", this.sigintListener);
      this.sigintListener = null;
    }
    if (this.resumeListener) {
      process.off("SIGCONT", this.resumeListener);
      this.resumeListener = null;
    }
    restoreStdinCookedMode();
    resetTerminalInputModes();
    if (this.active) {
      process.stdout.write(LEAVE_ALT_SCREEN);
      this.active = false;
    }
    if (activeChatLayout === this) activeChatLayout = null;
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
    this.reassertTerminalInputModes();
    this.inputListener = (chunk: string) => this.onInput(chunk);
    process.stdin.on("data", this.inputListener);
  }

  /**
   * Re-enable raw stdin + mouse / paste / focus reporting.
   * Call after focus return, SIGCONT, attach, and after long idle gaps.
   */
  private reassertTerminalInputModes(): void {
    this.lastTerminalModesAssertedAt = Date.now();
    process.stdin.resume();
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {
        // stdin may already be closed
      }
    }
    if (!process.stdout.isTTY) return;
    process.stdout.write(
      buildTerminalInputModeEnablement({
        mouseDrag: this.mouseDragTracking,
        mouseAnyEvent: this.readingAgentsPanel,
      }),
    );
  }

  private startModeReassertTimer(): void {
    this.stopModeReassertTimer();
    this.modeReassertTimer = setInterval(() => {
      if (!this.active) return;
      this.reassertTerminalInputModes();
    }, TERMINAL_MODE_REASSERT_INTERVAL_MS);
    // Do not keep the process alive solely for mode reassert.
    if (typeof this.modeReassertTimer.unref === "function") {
      this.modeReassertTimer.unref();
    }
  }

  private stopModeReassertTimer(): void {
    if (this.modeReassertTimer) {
      clearInterval(this.modeReassertTimer);
      this.modeReassertTimer = null;
    }
  }

  private maybeReassertTerminalInputModesAfterIdle(): void {
    if (Date.now() - this.lastTerminalModesAssertedAt < TERMINAL_MODE_REASSERT_IDLE_MS) {
      return;
    }
    this.reassertTerminalInputModes();
  }

  private detachInput(): void {
    if (this.inputListener) {
      process.stdin.off("data", this.inputListener);
      this.inputListener = null;
    }
    this.clearStdinRestFlush();
    this.stdinRest = "";
    this.teardownInput();
    restoreStdinCookedMode();
    resetTerminalInputModes();
  }

  private onInput(chunk: string): void {
    if (!this.active) return;
    this.maybeReassertTerminalInputModesAfterIdle();
    // Log enter/interrupt-ish chunks and any input while Rewind / suppress is active.
    if (
      this.readingRewind ||
      this.isReadLineEnterSuppressed() ||
      chunk.includes("\r") ||
      chunk.includes("\n") ||
      chunk.includes("\u0003") ||
      chunk.includes("\u001b")
    ) {
      debugChunk("onInput", chunk, {
        readingRewind: this.readingRewind,
        readingLine: this.readingLine,
        rewindBusy: this.rewindBusy,
        suppressUntil: this.suppressReadLineEnterUntil,
        skipRewindEnterUntil: this.skipRewindEnterUntil,
        appExit: this.appExitRequested,
        turnExit: this.turnExitRequested,
        bufLen: this.inputBuffer.length,
      });
    }
    // Agents overlays chat/modals; their awaiting promises stay armed underneath.
    if (this.readingAgentsPanel) {
      this.agentsInputChain = this.agentsInputChain
        .then(() => this.handleAgentsPanelInput(chunk))
        .catch(() => {});
      return;
    }
    if (this.readingRewind) {
      this.rewindInputChain = this.rewindInputChain
        .then(() => this.handleRewindInput(chunk))
        .catch(() => {});
      return;
    }
    if (this.toolApprovalMode) {
      void this.handleToolApprovalInput(chunk);
      return;
    }
    if (this.workflowConfirmMode) {
      void this.handleWorkflowConfirmInput(chunk);
      return;
    }
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
    if (this.readingWorkflowsPanel) {
      void this.handleWorkflowsPanelInput(chunk);
      return;
    }

    const combined = this.stdinRest + chunk;
    const { actions, rest } = parseInputActions(combined);
    this.stdinRest = rest;
    this.scheduleStdinRestFlush();

    void this.dispatchInputActions(actions);
  }

  private scheduleStdinRestFlush(): void {
    if (this.stdinRestFlushTimer) {
      clearTimeout(this.stdinRestFlushTimer);
      this.stdinRestFlushTimer = null;
    }
    // Only lone ESC needs a timeout flush; incomplete CSI waits for more bytes.
    if (this.stdinRest !== "\x1b") return;
    this.stdinRestFlushTimer = setTimeout(() => {
      this.stdinRestFlushTimer = null;
      if (this.stdinRest !== "\x1b") return;
      this.stdinRest = "";
      // Agents owns stdin — flush Esc into the panel handler, not chat dispatch
      // (otherwise reply-mode Esc never runs its turn-cancel / leave-reply logic).
      if (this.readingAgentsPanel) {
        void this.handleAgentsPanelEscapeKey();
        return;
      }
      void this.dispatchInputActions([{ type: "escape" }]);
    }, 35);
  }

  private clearStdinRestFlush(): void {
    if (this.stdinRestFlushTimer) {
      clearTimeout(this.stdinRestFlushTimer);
      this.stdinRestFlushTimer = null;
    }
  }

  private async dispatchInputActions(actions: InputAction[]): Promise<void> {
    try {
      const expanded = await this.expandPasteActions(actions);

      for (const action of expanded) {
      if (action.type === "mouseDown" || action.type === "mouseDrag" || action.type === "mouseUp") {
        const inInput = this.isInputMouseRow(action.row);
        if (inInput) {
          this.handleInputMouse(action);
          continue;
        }
        if (action.type === "mouseDown" && this.readingLine) {
          this.clearInputSelection();
          this.refreshInputFooter(this.readLinePlain, this.readLinePlaceholder);
        } else if (action.type === "mouseDown" || action.type === "mouseUp") {
          if (this.inputMouseSelecting && action.type === "mouseUp") {
            this.clearInputSelection();
            this.refreshInputFooter(this.readLinePlain, this.readLinePlaceholder);
          } else if (!this.inputMouseSelecting) {
            this.handleContentMouseClick(action.type, action.row, action.col);
          }
        }
        continue;
      }
      if (action.type === "click") {
        this.handleClick(action.row, action.col);
        continue;
      }
      if (action.type === "focusOut") {
        this.lastFocusOutAt = Date.now();
        continue;
      }
      if (action.type === "focusIn") {
        const awayMs = this.lastFocusOutAt > 0 ? Date.now() - this.lastFocusOutAt : 0;
        // Hosts often clear mouse/raw private modes while unfocused — restore before paint.
        this.reassertTerminalInputModes();
        this.scheduleFullRedraw();
        if (awayMs >= STEPPED_AWAY_IDLE_MS) {
          this.requestSteppedAwayRecap();
        }
        continue;
      }
      if (this.agentSwitcherFocus === "list") {
        if (await this.handleAgentListAction(action)) continue;
      }
      if (
        action.type === "historyDown" &&
        !this.readingLine &&
        this.sessionHasManageableAgents()
      ) {
        this.focusAgentList();
        continue;
      }
      if (
        action.type === "cursorLeft" &&
        !this.readingLine &&
        shouldPopAgentDetailOnLeft(this.agentDetailSnapshot !== null)
      ) {
        this.closeAgentDetail();
        continue;
      }
      if (action.type === "scroll") {
        this.scrollBy(action.delta);
        this.redrawContent();
        continue;
      }
      if (action.type === "interrupt") {
        debugStack("dispatch:interrupt", {
          readingLine: this.readingLine,
          canInterruptTurn: this.canInterruptActiveTurn(),
          lastCtrlCAt: this.lastCtrlCAt,
          appExit: this.appExitRequested,
        });
        // Re-arm modes + full paint: clears ghost UI and reduces native-selection windows.
        this.reassertTerminalInputModes();
        this.viewportNeedsFullRedraw = true;
        this.scheduleFullRedraw();
        if (this.readingLine) {
          this.handleReadLineAction(action);
          continue;
        }
        if (this.canInterruptActiveTurn()) {
          const now = Date.now();
          if (this.lastCtrlCAt && now - this.lastCtrlCAt < CTRL_C_EXIT_MS) {
            debugLog("dispatch:interrupt:doubleCtrlC:duringTurn");
            this.appExitRequested = true;
            this.turnExitRequested = true;
            this.lastCtrlCAt = 0;
            continue;
          }
          this.lastCtrlCAt = now;
          this.turnExitRequested = true;
          this.showExitHint();
          this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
          continue;
        }
        // Idle / stuck outside readLine (e.g. hung turn finalize): double Ctrl+C exits.
        {
          const now = Date.now();
          if (this.lastCtrlCAt && now - this.lastCtrlCAt < CTRL_C_EXIT_MS) {
            debugLog("dispatch:interrupt:doubleCtrlC:idle");
            this.appExitRequested = true;
            this.turnExitRequested = true;
            this.lastCtrlCAt = 0;
            this.rejectPendingUiForAppExit();
            continue;
          }
          this.lastCtrlCAt = now;
          this.showExitHint();
          this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
        }
        continue;
      }
      if (action.type === "ctrlB") {
        this.promoteForegroundAgentFromHotkey();
        continue;
      }
      if (action.type === "escape") {
        // Prefer turn interrupt over readLine Esc (clear/rewind) while generating —
        // otherwise Esc arms rewind / clears buffer and never aborts the turn.
        if (this.canInterruptActiveTurn()) {
          this.requestTurnCancelForEdit();
          continue;
        }
        if (this.readingLine) {
          this.handleReadLineAction(action);
          continue;
        }
        continue;
      }
      if (
        action.type === "cursorLeft" &&
        !this.readingLine &&
        this.canInterruptActiveTurn()
      ) {
        if (shouldPopAgentDetailOnLeft(this.agentDetailSnapshot !== null)) {
          this.closeAgentDetail();
          continue;
        }
        void this.openAgentsPanel(this.sessionId);
        continue;
      }
      if (this.readingLine) {
        this.handleReadLineAction(action);
      } else if (this.canComposeWhileBusy()) {
        // Turn in flight: keep composing the next prompt (caret stays visible).
        this.handleReadLineAction(action);
      }
      }
    } catch (err) {
      console.error("[kako] input dispatch failed:", err);
    }
  }

  /** Merge char/enter bursts from unbracketed paste, then absolute-path paste chunks. */
  private async expandPasteActions(actions: InputAction[]): Promise<InputAction[]> {
    return this.coalesceCharPasteActions(coalescePasteActions(actions));
  }

  /** Terminals without bracketed paste may deliver a file path as one chunk of char actions. */
  private async coalesceCharPasteActions(actions: InputAction[]): Promise<InputAction[]> {
    if (!Array.isArray(actions) || actions.length < 2 || !actions.every((action) => action.type === "char")) {
      return Array.isArray(actions) ? actions : [];
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
    if (this.choiceMultiSelect && this.applyMultiSelectCustomTyping(chunk)) {
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
      if (action.type === "left") {
        if (shouldPopAgentDetailOnLeft(this.agentDetailSnapshot !== null)) {
          this.closeAgentDetail();
          return;
        }
        void this.openAgentsPanel(this.sessionId);
        return;
      }
      if (action.type === "up") {
        this.choiceShowHeader = true;
        this.moveMultiSelectSelection(-1);
        this.redrawChoicePanel();
      }
      if (action.type === "down") {
        this.choiceShowHeader = true;
        this.moveMultiSelectSelection(1);
        this.redrawChoicePanel();
      }
      if (action.type === "enter" || action.type === "space") {
        const row = this.choiceRows[this.choiceSelected];
        if (!row) return;

        if (this.choiceMultiSelect) {
          if (this.applyMultiSelectChoiceAction(row, action.type)) {
            return;
          }
          continue;
        }

        if (action.type === "space") continue;
        const resolve = this.choiceResolve;
        this.finishChoice();
        resolve?.(row);
        return;
      }
    }
  }

  /**
   * Move multi-select / choice highlight. Leaving an empty armed Type something
   * row clears [✓] so the placeholder returns.
   */
  private moveMultiSelectSelection(delta: number): void {
    const prev = this.choiceRows[this.choiceSelected];
    if (
      prev?.kind === "custom" &&
      this.choiceCustomChecked &&
      this.choiceCustomText.trim().length === 0
    ) {
      this.choiceCustomChecked = false;
    }
    if (delta < 0) {
      this.choiceSelected = Math.max(0, this.choiceSelected - 1);
    } else {
      this.choiceSelected = Math.min(this.choiceRows.length - 1, this.choiceSelected + 1);
    }
  }

  /** When focused on Type something in multi-select, type/backspace inline. */
  private applyMultiSelectCustomTyping(chunk: string): boolean {
    const row = this.choiceRows[this.choiceSelected];
    if (!row || row.kind !== "custom") return false;
    // Must Enter/Space to arm [✓] before typing.
    if (!this.choiceCustomChecked) return false;
    let changed = false;
    for (const ch of chunk) {
      if (ch === "\u007f" || ch === "\b") {
        if (this.choiceCustomText.length > 0) {
          this.choiceCustomText = this.choiceCustomText.slice(0, -1);
          // Empty text unchecks — placeholder returns after leave or immediately.
          if (this.choiceCustomText.length === 0) {
            this.choiceCustomChecked = false;
          }
          changed = true;
        }
        continue;
      }
      if (ch === "\x1b" || ch === "\r" || ch === "\n" || ch === "\u0003") {
        return false;
      }
      if (ch >= " " && ch !== "\x7f") {
        this.choiceCustomText += ch;
        changed = true;
      }
    }
    if (changed) {
      if (this.wizardMode) this.redrawWizardPanel();
      else this.redrawChoicePanel();
    }
    return changed;
  }

  /**
   * Toggle checkbox / submit for multi-select rows.
   * @returns true when the action was consumed (including redraw).
   */
  private applyMultiSelectChoiceAction(
    row: ChoiceRow,
    action: "enter" | "space",
  ): boolean {
    if (row.kind === "option" && row.optionIndex !== undefined) {
      if (this.choiceCheckedOptions.has(row.optionIndex)) {
        this.choiceCheckedOptions.delete(row.optionIndex);
      } else {
        this.choiceCheckedOptions.add(row.optionIndex);
      }
      if (this.wizardMode) this.redrawWizardPanel();
      else this.redrawChoicePanel();
      return true;
    }
    if (action === "space") return true;
    if (row.kind === "submit") {
      const options = this.choiceRows
        .filter((r) => r.kind === "option" && r.optionIndex !== undefined)
        .map((r) => ({
          label: r.label,
          description: r.description ?? "",
        }));
      const answer = composeMultiSelectAnswer(
        options,
        this.choiceCheckedOptions,
        this.choiceCustomText,
      );
      if (!answer) return true;
      if (this.wizardMode) {
        this.commitWizardMultiSelectAnswer(answer);
        return true;
      }
      const resolve = this.choiceResolve;
      this.finishChoice();
      resolve?.({ kind: "submit", label: answer });
      return true;
    }
    if (row.kind === "custom") {
      // Enter/Space arms [✓] edit mode; toggle off clears text + restores placeholder.
      if (this.choiceCustomChecked) {
        this.choiceCustomChecked = false;
        this.choiceCustomText = "";
      } else {
        this.choiceCustomChecked = true;
      }
      if (this.wizardMode) this.redrawWizardPanel();
      else this.redrawChoicePanel();
      return true;
    }
    if (row.kind === "chat") {
      if (this.wizardMode) {
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
        return true;
      }
      const reject = this.choiceReject;
      this.finishChoice();
      reject?.(new ChoiceCancelledError());
      return true;
    }
    return true;
  }

  private commitWizardMultiSelectAnswer(answer: string): void {
    const item = this.wizardQuestions[this.wizardFocus];
    if (!item) return;
    this.wizardAnswers[item.question] = answer;
    const nextUnanswered = this.wizardQuestions.findIndex((q) => !this.wizardAnswers[q.question]);
    if (nextUnanswered === -1) {
      this.goToWizardReview();
      return;
    }
    this.wizardFocus = nextUnanswered;
    this.choiceSelected = 0;
    this.syncWizardRows();
    this.redrawWizardPanel();
  }

  private handleWizardInput(chunk: string): void {
    if (this.choiceMultiSelect && this.applyMultiSelectCustomTyping(chunk)) {
      return;
    }
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
        if (this.wizardFocus === 0) {
          void this.openAgentsPanel(this.sessionId);
          return;
        }
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
          this.moveMultiSelectSelection(-1);
          this.redrawWizardPanel();
        } else if (this.allWizardQuestionsAnswered()) {
          this.moveMultiSelectSelection(-1);
          this.redrawWizardPanel();
        }
      }
      if (action.type === "down") {
        if (this.wizardFocus < this.wizardQuestions.length) {
          this.moveMultiSelectSelection(1);
          this.redrawWizardPanel();
        } else if (this.allWizardQuestionsAnswered()) {
          this.moveMultiSelectSelection(1);
          this.redrawWizardPanel();
        }
      }
      if (action.type === "enter" || action.type === "space") {
        if (this.wizardFocus >= this.wizardQuestions.length) {
          if (action.type === "space") continue;
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

        if (this.choiceMultiSelect) {
          this.applyMultiSelectChoiceAction(row, action.type);
          continue;
        }

        if (action.type === "space") continue;

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
      this.choiceMultiSelect = false;
      this.choiceCheckedOptions = new Set();
      this.choiceRows = this.allWizardQuestionsAnswered() ? buildWizardReviewRows() : [];
      return;
    }
    const item = this.wizardQuestions[this.wizardFocus]!;
    this.choiceHeader = item.header;
    this.choiceQuestion = item.question;
    if (item.multiSelect) {
      this.choiceMultiSelect = true;
      this.choiceRows = buildMultiChoiceRows(item.options);
      this.choiceCheckedOptions = checkedIndexesFromAnswer(
        item.options,
        this.wizardAnswers[item.question],
      );
      this.choiceCustomText = "";
      this.choiceCustomChecked = false;
    } else {
      this.choiceMultiSelect = false;
      this.choiceCheckedOptions = new Set();
      this.choiceCustomText = "";
      this.choiceCustomChecked = false;
      this.choiceRows = buildChoiceRows(item.options, true);
    }
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
        multiSelect: this.choiceMultiSelect,
        checkedOptionIndexes: this.choiceCheckedOptions,
        customText: this.choiceCustomText,
        customChecked: this.choiceCustomChecked,
      }),
    );
  }

  private redrawWizardPanel(): void {
    this.updateWizardFooterHeight();
    this.invalidateContentCache();
    this.redrawContent();
  }

  private drawWizardPanel(): void {
    if (this.readingAgentsPanel) {
      this.drawAgentsPanel();
      return;
    }
    const { cols, rows } = getTerminalSize();
    const top = this.footerTop;
    const panelLines = renderQuestionWizardPanelLines({
      questions: this.wizardQuestions,
      answers: this.wizardAnswers,
      focusIndex: this.wizardFocus,
      rows: this.choiceRows,
      selectedIndex: this.choiceSelected,
      cols,
      multiSelect: this.choiceMultiSelect,
      checkedOptionIndexes: this.choiceCheckedOptions,
      customText: this.choiceCustomText,
      customChecked: this.choiceCustomChecked,
    });

    const sep = footerSeparator(cols);
    const hint = this.choiceMultiSelect ? WIZARD_MULTI_SELECT_HINT : CHOICE_HINT;
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
    this.choiceMultiSelect = false;
    this.choiceCheckedOptions = new Set();
    this.choiceCustomText = "";
    this.choiceCustomChecked = false;
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
        customText: this.choiceCustomText,
        customChecked: this.choiceCustomChecked,
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
    if (this.readingAgentsPanel) {
      this.drawAgentsPanel();
      return;
    }
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
      customText: this.choiceCustomText,
      customChecked: this.choiceCustomChecked,
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
    this.choiceCustomText = "";
    this.choiceCustomChecked = false;
    this.restoreDefaultFooter();
    if (this.active) {
      process.stdout.write(HIDE_CURSOR);
    }
  }

  private isReadLineEnterSuppressed(): boolean {
    return Date.now() < this.suppressReadLineEnterUntil;
  }

  private armReadLineEnterSuppress(): void {
    this.suppressReadLineEnterUntil = Date.now() + REWIND_SUPPRESS_ENTER_MS;
    if (this.suppressReadLineEnterTimer) clearTimeout(this.suppressReadLineEnterTimer);
    this.suppressReadLineEnterTimer = setTimeout(() => {
      this.suppressReadLineEnterTimer = null;
      this.suppressReadLineEnterUntil = 0;
    }, REWIND_SUPPRESS_ENTER_MS);
  }

  private clearReadLineEnterSuppress(): void {
    this.suppressReadLineEnterUntil = 0;
    if (this.suppressReadLineEnterTimer) {
      clearTimeout(this.suppressReadLineEnterTimer);
      this.suppressReadLineEnterTimer = null;
    }
  }

  /** Keys that mean the user intentionally edited — safe to clear Enter drain. */
  private isTypingAction(action: InputAction): boolean {
    return (
      action.type === "char" ||
      action.type === "paste" ||
      action.type === "pasteText" ||
      action.type === "backspace" ||
      action.type === "newline" ||
      action.type === "cursorLeft" ||
      action.type === "cursorRight" ||
      action.type === "cursorHome" ||
      action.type === "cursorEnd" ||
      action.type === "tab" ||
      action.type === "shiftTab" ||
      action.type === "historyUp" ||
      action.type === "historyDown"
    );
  }

  private handleReadLineAction(action: InputAction): void {
    const composingBusy = this.canComposeWhileBusy();
    if (!this.inputResolve && !composingBusy) return;

    const placeholder = this.readLinePlaceholder;
    const plain = this.readLinePlain;
    const suggestions = this.filteredSlashSuggestions();
    const slashOpen = suggestions.length > 0;

    // Only typing clears the Rewind Enter guard — mouse/focus must not re-arm submit.
    if (this.isTypingAction(action)) {
      this.clearReadLineEnterSuppress();
    }

    // Mid-turn compose: Esc/Ctrl+C are handled by the turn interrupt path; Enter
    // keeps the draft for the next readLine instead of submitting into the void.
    if (composingBusy) {
      if (
        action.type === "interrupt" ||
        action.type === "escape" ||
        action.type === "enter"
      ) {
        return;
      }
    }

    if (action.type === "interrupt") {
      debugStack("readLine:interrupt→ExitRequestedError", {
        bufPreview: this.inputBuffer.slice(0, 80),
      });
      const reject = this.inputReject;
      this.finishReadLine();
      reject?.(new ExitRequestedError());
      return;
    }
    if (action.type === "escape") {
      debugLog("readLine:escape", {
        bufLen: this.inputBuffer.length,
        interruptedHint: this.interruptedHintCount,
      });
      if (
        this.interruptedHintCount > 0 &&
        this.interruptedDismissHandler &&
        this.inputBuffer.length === 0 &&
        !this.inputHistory.isBrowsing()
      ) {
        const dismiss = this.interruptedDismissHandler;
        this.clearInterruptedResumeHint();
        void dismiss();
        return;
      }
      this.handleInputEscape(plain, placeholder);
      return;
    }
    if (action.type === "enter") {
      // Trailing \\n after Rewind Restore confirm must not submit the prefilled line.
      if (this.isReadLineEnterSuppressed()) {
        debugLog("readLine:enter:suppressed", {
          until: this.suppressReadLineEnterUntil,
          bufPreview: this.inputBuffer.slice(0, 80),
        });
        return;
      }
      if (
        this.interruptedHintCount > 0 &&
        this.interruptedResumeHandler &&
        this.inputBuffer.trim().length === 0 &&
        !slashOpen &&
        !this.inputHistory.isBrowsing()
      ) {
        debugLog("readLine:enter:interruptedResume");
        const resume = this.interruptedResumeHandler;
        this.clearInterruptedResumeHint();
        void resume();
        return;
      }
      const value = slashOpen
        ? resolveSlashSubmitValue(
            this.inputBuffer,
            suggestions,
            this.slashSuggestSelected,
          )
        : this.inputBuffer;
      debugLog("readLine:enter:resolve", {
        valuePreview: value.slice(0, 120),
        slashOpen,
      });
      const resolve = this.inputResolve;
      this.inputHistory.commit(value);
      this.inputHistory.resetBrowse();
      this.finishReadLine();
      process.stdout.write(HIDE_CURSOR);
      this.drawFooter("", plain ? undefined : placeholder);
      resolve?.(value);
      return;
    }
    if (action.type === "newline") {
      this.clearInputClearHint();
      this.clearCopyHint();
      this.clearInputSelection();
      if (this.inputHistory.isBrowsing()) {
        this.inputHistory.resetBrowse();
      }
      const next = insertNewlineAtCursor(this.inputBuffer, this.inputCursor);
      this.inputBuffer = next.text;
      this.inputCursor = next.cursor;
      this.syncInputScrollRow();
      this.refreshInputFooter(plain, placeholder);
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
      // Explore detail: empty input ↑ scrolls chat history (not shell history).
      if (
        this.agentDetailChildSessionId &&
        this.inputBuffer.length === 0 &&
        !this.inputHistory.isBrowsing()
      ) {
        this.scrollBy(-3);
        this.redrawContent();
        return;
      }
      if (!shouldBrowseHistoryOnUp(this.inputBuffer, this.inputCursor)) {
        this.inputCursor = moveCursorUp(this.inputBuffer, this.inputCursor);
        this.syncInputScrollRow();
      } else {
        this.clearInputClearHint();
        const next = this.inputHistory.browseUp(this.inputBuffer);
        if (next !== null) {
          this.inputBuffer = next;
          this.inputCursor = next.length;
          this.inputScrollRow = 0;
        }
      }
    } else if (action.type === "historyDown") {
      if (
        this.agentDetailChildSessionId &&
        this.inputBuffer.length === 0 &&
        !this.inputHistory.isBrowsing()
      ) {
        if (!this.isAtBottom()) {
          this.scrollBy(3);
          this.redrawContent();
          return;
        }
        if (this.sessionHasManageableAgents()) {
          this.focusAgentList();
          return;
        }
      }
      if (!shouldBrowseHistoryOnDown(this.inputBuffer, this.inputCursor)) {
        this.inputCursor = moveCursorDown(this.inputBuffer, this.inputCursor);
        this.syncInputScrollRow();
      } else if (
        this.sessionHasManageableAgents() &&
        !this.inputHistory.isBrowsing()
      ) {
        this.focusAgentList();
        return;
      } else {
        this.clearInputClearHint();
        const next = this.inputHistory.browseDown();
        if (next !== null) {
          this.inputBuffer = next;
          const leftHistory = !this.inputHistory.isBrowsing();
          this.inputCursor = leftHistory ? 0 : next.length;
          this.inputScrollRow = 0;
          if (
            shouldFocusAgentListAfterLeavingHistory({
              leftHistory,
              canManageAgents: this.sessionHasManageableAgents(),
              draft: this.inputBuffer,
              cursor: this.inputCursor,
            })
          ) {
            this.focusAgentList();
            return;
          }
        }
      }
    } else if (action.type === "shiftTab") {
      this.cyclePermissionMode();
      return;
    } else if (
      action.type === "cursorLeft" &&
      this.inputBuffer.length === 0 &&
      this.inputCursor === 0
    ) {
      if (shouldPopAgentDetailOnLeft(this.agentDetailSnapshot !== null)) {
        this.closeAgentDetail();
        return;
      }
      void this.openAgentsPanel(this.sessionId);
      return;
    } else if (action.type === "backspace") {
      this.clearInputClearHint();
      this.clearCopyHint();
      this.clearInputSelection();
      if (this.inputHistory.isBrowsing()) {
        this.inputHistory.resetBrowse();
      }
      if (this.inputCursor > 0) {
        const prev = prevCodePointIndex(this.inputBuffer, this.inputCursor);
        this.inputBuffer =
          this.inputBuffer.slice(0, prev) + this.inputBuffer.slice(this.inputCursor);
        this.inputCursor = prev;
      }
      this.syncInputScrollRow();
      if (this.inputBuffer.length === 0 && !this.exitHintTimer) {
        this.shortcutsOverride = null;
      }
    } else if (action.type === "cursorLeft") {
      this.inputCursor = prevCodePointIndex(this.inputBuffer, this.inputCursor);
    } else if (action.type === "cursorRight") {
      this.inputCursor = nextCodePointIndex(this.inputBuffer, this.inputCursor);
    } else if (action.type === "cursorHome") {
      this.inputCursor = this.lineStartOffsetForInput(this.inputBuffer, this.inputCursor);
    } else if (action.type === "cursorEnd") {
      this.inputCursor = this.lineEndOffsetForInput(this.inputBuffer, this.inputCursor);
    } else if (action.type === "paste") {
      void this.handlePaste();
    } else if (action.type === "pasteText") {
      void this.handlePasteContent(action.text);
    } else if (action.type === "char") {
      this.lastCtrlCAt = 0;
      this.clearExitHint();
      this.clearInputClearHint();
      this.clearCopyHint();
      this.clearInputSelection();
      if (this.inputHistory.isBrowsing()) {
        this.inputHistory.resetBrowse();
      }
      this.inputBuffer =
        this.inputBuffer.slice(0, this.inputCursor) +
        action.char +
        this.inputBuffer.slice(this.inputCursor);
      this.inputCursor += action.char.length;
      this.syncInputScrollRow();
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

  private syncInputScrollRow(): void {
    const cursorLine = cursorLogicalLine(this.inputBuffer, this.inputCursor);
    const totalLines = Math.max(1, this.inputBuffer.split("\n").length);
    this.inputScrollRow = clampInputScrollRow(
      this.inputScrollRow,
      cursorLine,
      totalLines,
      INPUT_MAX_VISIBLE_LINES,
    );
  }

  private lineStartOffsetForInput(text: string, cursor: number): number {
    return lineStartOffset(text, cursorLogicalLine(text, cursor));
  }

  private lineEndOffsetForInput(text: string, cursor: number): number {
    return lineEndOffset(text, cursorLogicalLine(text, cursor));
  }

  private filteredSlashSuggestions(): SystemSkillEntry[] {
    if (!this.readingLine || this.readingChoice || this.wizardMode || this.readingWorkflowsPanel) {
      return [];
    }
    if (this.inputHistory.isBrowsing()) return [];
    if (cursorLogicalLine(this.inputBuffer, this.inputCursor) !== 0) return [];
    const lineText = this.inputBuffer.slice(0, lineEndOffset(this.inputBuffer, 0));
    const lineCursor = this.inputCursor;
    if (!shouldShowSlashMenu(lineText, lineCursor)) return [];
    const query = slashSuggestQuery(lineText, lineCursor);
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

  private currentInputFooterHeight(inputValue: string): number {
    const { cols } = getTerminalSize();
    const rows = inputBlockRowCount(inputValue, this.inputScrollRow, cols);
    const topHintRow = this.readingLine && this.inputTopHintText() ? 1 : 0;
    // Claude: main + agent rows stay visible whenever any agent is running.
    // +1 blank line between shortcuts and the agent list.
    const agentCount = this.sessionAgentRows().length;
    const agentLines = agentCount > 0 ? agentCount + 1 : 0;
    const shortcutLines = this.footerShortcutLines(inputValue).length;
    // topSep + input rows + bottomSep + shortcut row(s) + agents
    return 2 + rows + topHintRow + Math.max(1, shortcutLines) + agentLines;
  }

  private updateSlashSuggestFooterHeight(
    suggestions: SystemSkillEntry[],
    inputValue = this.inputBuffer,
  ): void {
    const inputFooterHeight = this.currentInputFooterHeight(inputValue);
    if (!suggestions.length) {
      this.activeFooterHeight = this.clampFooterHeight(inputFooterHeight);
      this.slashSuggestMaxVisible = 4;
      return;
    }
    const { cols } = getTerminalSize();
    const plan = planSlashSuggestFooter({
      skills: suggestions,
      selectedIndex: this.slashSuggestSelected,
      cols,
      maxHeight: this.maxFooterHeight(),
      inputFooterHeight,
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

    this.drawActiveFooter(
      this.inputBuffer,
      this.inputBuffer ? undefined : plain ? undefined : placeholder,
    );
  }

  /** True when a modal footer (approval, picker, etc.) owns the bottom of the screen. */
  private isFooterOverlayActive(): boolean {
    return (
      this.readingRewind ||
      this.toolApprovalMode ||
      this.planReviewMode ||
      this.workflowConfirmMode ||
      this.readingChoice ||
      this.readingWorkflowsPanel ||
      this.readingAgentsPanel
    );
  }

  /** Route footer paint to the active panel — never stack chat input on overlays. */
  private drawActiveFooter(inputValue = this.inputBuffer, placeholder?: string): void {
    // Agents owns the full screen; parked approvals must not paint over it.
    if (this.readingAgentsPanel) {
      this.drawAgentsPanel();
      return;
    }
    if (this.readingRewind) {
      this.drawRewindFooter();
      return;
    }
    if (this.readingWorkflowsPanel) {
      this.drawWorkflowsPanel();
      return;
    }
    if (this.toolApprovalMode) {
      this.drawToolApprovalFooter();
      return;
    }
    if (this.workflowConfirmMode) {
      this.drawWorkflowConfirmFooter();
      return;
    }
    if (this.planReviewMode) {
      this.drawPlanReviewFooter();
      return;
    }
    if (this.readingChoice) {
      this.drawActiveChoiceFooter();
      return;
    }
    this.drawFooter(inputValue, placeholder);
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
    this.clearInputSelection();
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
    const fromBuffer = this.readingAgentsPanel
      ? this.agentsActiveInputText()
      : this.inputBuffer;
    const index = Math.max(this.nextImageIndex, nextImageIndexFromText(fromBuffer));
    this.nextImageIndex = index + 1;
    return index;
  }

  private insertAtCursor(text: string): void {
    const normalized = text.replace(/\r\n?/g, "\n");
    if (this.readingAgentsPanel) {
      const current = this.agentsActiveInputText();
      const cursor = this.agentsActiveInputCursor();
      const next = current.slice(0, cursor) + normalized + current.slice(cursor);
      this.setAgentsActiveInput(next, cursor + normalized.length, true);
      this.drawAgentsPanel();
      return;
    }
    if (this.readingLine) {
      this.clearInputClearHint();
      if (this.inputHistory.isBrowsing()) {
        this.inputHistory.resetBrowse();
      }
    }
    this.inputBuffer =
      this.inputBuffer.slice(0, this.inputCursor) +
      normalized +
      this.inputBuffer.slice(this.inputCursor);
    this.inputCursor += normalized.length;
    this.syncInputScrollRow();
    if (this.readingLine) {
      this.refreshInputFooter(this.readLinePlain, this.readLinePlaceholder);
    }
  }

  private finishReadLine(): void {
    this.clearReadLineEnterSuppress();
    this.clearInputClearHint();
    this.inputResolve = null;
    this.inputReject = null;
    this.readingLine = false;
    this.inputBuffer = "";
    this.inputCursor = 0;
    this.inputScrollRow = 0;
    this.readLinePlaceholder = undefined;
    this.slashSuggestSelected = 0;
    this.lastSlashSuggestQuery = "";
    this.slashFooterDrawExtent = { top: 0, rows: 0 };
    this.slashSuggestMaxVisible = 4;
    this.inputScrollRow = 0;
    if (!this.readingChoice && !this.readingWorkflowsPanel) {
      this.activeFooterHeight = this.defaultFooterHeight;
    }
    this.disableMouseDragTracking();
    this.clearInputSelection();
    this.clearCopyHint();
  }

  private scrollableHeaderLines(): RenderLine[] {
    if (this.effectiveHeaderMode() !== "mini") return [];
    return this.headerLines.map((text) => ({ text }));
  }

  private allRenderLines(): RenderLine[] {
    if (this.toolApprovalMode) {
      return this.buildToolApprovalContentLines();
    }
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
      if (turn.silentChat) continue;
      lines.push(...renderTurnToLines(turn, cols, { now }));
    }
    if (this.activeTurn && !this.activeTurn.silentChat && !this.chatStreamMuted) {
      lines.push(...renderTurnToLines(this.activeTurn, cols, { now, isActive: true }));
    }
    if (lines.length > 1) {
      lines.push(CHAT_EDGE_LINE);
    }
    return lines;
  }

  /** Pinned rows at the bottom of the content area (above input). */
  private pinnedBottomLines(): string[] {
    if (this.planReviewMode || this.workflowConfirmMode || this.toolApprovalMode) return [];
    const lines: string[] = [];
    // Workflow / background-agent waiting only — per-tool Waiting… pins removed (flicker;
    // live phase is already shown on the * Refining… status line).
    const waitingBlock: string[] = [];
    if (this.workflowWaitingCount > 0) {
      waitingBlock.push(renderWorkflowWaitingLine(this.workflowWaitingCount));
    }
    if (this.backgroundAgentWaitingCount > 0) {
      waitingBlock.push(renderBackgroundAgentWaitingLine(this.backgroundAgentWaitingCount));
    }
    if (waitingBlock.length > 0) {
      lines.push(...waitingBlock);
    }
    const turnLive = Boolean(this.activeTurn && this.activeTurn.phase !== "done");
    const silentChat = Boolean(this.activeTurn?.silentChat);
    // Silent protocol wakes (recap) — no Pondering / tip chrome in the chat viewport.
    if (!turnLive || !this.activeTurn || silentChat) return lines;
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

  /** Re-pin transcript to latest output after closing an approval overlay. */
  private restoreChatScrollAfterOverlay(): void {
    this.scrollToBottom();
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
    const turn = this.turnForChoiceAppend();
    if (!turn) {
      // Still avoid plainLines above the user prompt — create a synthetic done turn.
      this.beginSyntheticChoiceTurn();
    }
    const target = this.turnForChoiceAppend();
    if (!target) return;
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
    target.timeline.push(entry);
    if (target === this.activeTurn) {
      this.activeTurn.answerText = "";
    }
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
    if (!this.turnForChoiceAppend()) {
      this.beginSyntheticChoiceTurn();
    }
    const target = this.turnForChoiceAppend();
    if (!target) return;
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
    target.timeline.push(entry);
    if (target === this.activeTurn) {
      this.activeTurn.answerText = "";
    }
    this.maybeScrollToBottom();
    this.invalidateContentCache();
    this.redrawContent();
  }

  /** Prefer live turn; else last completed turn — never plainLines above the user bar. */
  private turnForChoiceAppend(): ChatTurn | null {
    if (this.activeTurn) return this.activeTurn;
    return this.turns[this.turns.length - 1] ?? null;
  }

  private beginSyntheticChoiceTurn(): void {
    if (this.activeTurn || this.turns.length > 0) return;
    const turn: ChatTurn = {
      id: `choice-orphan-${Date.now()}`,
      userText: "",
      answerText: "",
      thinkingStartedAt: Date.now(),
      thinkingEndedAt: Date.now(),
      finishedAt: Date.now(),
      doneVerb: "Done",
      generatingVerb: null,
      outputTokens: 0,
      phase: "done",
      timeline: [],
      expandedThoughts: new Set(),
      expandedToolGroups: new Set(),
      expandedChoices: new Set(),
      pulseFrame: 0,
      harnessOnly: true,
    };
    this.turns.push(turn);
  }

  /** Chronological inline events — thinking, AskUserQuestion, etc. */
  appendTurnTimeline(text: string): void {
    const lines = text.trim().split("\n").filter((line) => line.length > 0);
    const event = { type: "event" as const, lines };

    if (this.activeTurn) {
      this.finalizeOpenThinking();
      this.activeTurn.timeline.push(event);
      this.activeTurn.answerText = "";
      this.maybeScrollToBottom();
      this.invalidateContentCache();
      this.redrawContent();
      return;
    }

    const lastTurn = this.turns[this.turns.length - 1];
    if (lastTurn) {
      lastTurn.timeline.push(event);
      this.maybeScrollToBottom();
      this.invalidateContentCache();
      this.redrawContent();
      return;
    }

    this.appendContent(text);
  }

  beginToolCall(
    name: string,
    detail: string,
    toolInput?: Record<string, unknown>,
    sessionId?: string,
  ): void {
    if (this.chatStreamMuted) return;
    const entry: ToolCallTimelineEntry = {
      type: "tool",
      id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      detail,
      status: "waiting",
      dotFrame: 0,
      toolInput,
      backgrounded: name === "Agent" && toolInput?.run_in_background === true,
      agentExpanded: name === "Agent" ? true : undefined,
      startedAt: name === "Agent" ? Date.now() : undefined,
    };
    if (this.liveTurnBucket(sessionId).turn) {
      this.withLiveTurn(() => {
        if (!this.activeTurn) return;
        this.finalizeOpenThinking();
        // Nest non-Agent tools under an in-flight Agent on *this* turn only.
        // Child-session tools must not nest under the parent's Agent stash.
        if (name !== "Agent") {
          const parent = this.findLastWaitingAgentOnTurn(this.activeTurn);
          if (parent && !parent.backgrounded) {
            parent.childTools ??= [];
            parent.childTools.push(entry);
            this.activeTurn.answerText = "";
            return;
          }
        }
        this.activeTurn.timeline.push(entry);
        this.activeTurn.answerText = "";
      }, sessionId);
      this.redrawIfLiveTurnVisible(sessionId);
      if (name === "Agent") {
        this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
      }
      return;
    }
    // No live turn for this session: do not glue onto another session's timeline.
    if (sessionId && sessionId !== this.sessionId) {
      this.ensureParkedShell(sessionId);
      const park = this.parkedSessions.get(sessionId)!;
      const lastTurn = park.turns[park.turns.length - 1];
      if (lastTurn) {
        lastTurn.timeline.push(entry);
      }
      return;
    }
    const lastTurn = this.turns[this.turns.length - 1];
    if (lastTurn && !this.isViewingAgentDetail()) {
      lastTurn.timeline.push(entry);
      this.invalidateContentCache();
      this.maybeScrollToBottom();
      this.redrawContent();
      return;
    }
    if (this.sessionId) this.appendContent(`${name} ${detail}`.trim());
  }

  finishToolCall(
    name: string,
    status: string,
    errorDetail?: string,
    output?: string,
    sessionId?: string,
  ): void {
    const apply = (entry: ToolCallTimelineEntry | undefined): boolean => {
      if (!entry) return false;
      entry.status = status === "success" ? "success" : "error";
      if (errorDetail) entry.errorDetail = errorDetail;
      if (output) entry.output = output;
      if (entry.name === "Agent" && !entry.backgrounded) {
        entry.endedAt = Date.now();
        // Collapse to Done summary; click expands child tools (no result body).
        if (entry.status === "success") entry.agentExpanded = false;
      }
      return true;
    };
    if (
      this.withLiveTurn(() => {
        if (!this.activeTurn) return;
        for (let i = this.activeTurn.timeline.length - 1; i >= 0; i--) {
          const e = this.activeTurn.timeline[i];
          if (e?.type === "tool" && e.name === name && e.status === "waiting") {
            apply(e);
            return;
          }
          if (e?.type === "tool" && e.childTools?.length) {
            for (let c = e.childTools.length - 1; c >= 0; c--) {
              const child = e.childTools[c]!;
              if (child.name === name && child.status === "waiting") {
                apply(child);
                return;
              }
            }
          }
        }
      }, sessionId)
    ) {
      if (status === "success" && (name === "TaskCreate" || name === "TaskUpdate")) {
        this.upsertTaskListTimeline(sessionId);
      }
      this.redrawIfLiveTurnVisible(sessionId);
      return;
    }
    const turns =
      sessionId && sessionId !== this.sessionId
        ? this.parkedSessions.get(sessionId)?.turns ?? []
        : this.turns;
    for (let t = turns.length - 1; t >= 0; t--) {
      const turn = turns[t]!;
      for (let i = turn.timeline.length - 1; i >= 0; i--) {
        const e = turn.timeline[i];
        if (e?.type === "tool" && e.name === name && e.status === "waiting") {
          apply(e);
          if (status === "success" && (name === "TaskCreate" || name === "TaskUpdate")) {
            this.upsertTaskListOnTurn(turn, sessionId ?? this.sessionId);
          }
          if (!sessionId || sessionId === this.sessionId) {
            if (!this.isViewingAgentDetail()) {
              this.invalidateContentCache();
              this.redrawContent();
            }
          }
          return;
        }
      }
    }
  }

  private upsertTaskListTimeline(sessionId?: string): void {
    const sid = sessionId ?? this.sessionId;
    if (!sid) return;
    this.withLiveTurn(() => {
      if (!this.activeTurn) return;
      this.upsertTaskListOnTurn(this.activeTurn, sid);
    }, sessionId);
  }

  private upsertTaskListOnTurn(turn: ChatTurn, sessionId: string): void {
    const items = listTasks(sessionId).map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      ...(t.activeForm ? { activeForm: t.activeForm } : {}),
    }));
    for (let i = turn.timeline.length - 1; i >= 0; i--) {
      const e = turn.timeline[i];
      if (e?.type === "task-list") {
        e.items = items;
        return;
      }
    }
    turn.timeline.push({ type: "task-list", items });
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

  /** Snapshot file content before Write overwrites an existing path. */
  updateLastWaitingToolPriorContent(content: string): void {
    const entry = this.findLastWaitingToolEntry();
    if (!entry) return;
    entry.priorContent = content;
    this.invalidateContentCache();
    this.redrawContent();
  }

  private promoteForegroundAgentFromHotkey(): void {
    const launch = this.onPromoteForegroundAgent?.();
    if (!launch) return;
    const entry = this.findLastWaitingAgentEntry();
    if (entry) {
      entry.backgrounded = true;
    }
    this.finishToolCall("Agent", "success", undefined, launch);
    this.syncAgentSwitcherAfterTasksChange();
    this.invalidateContentCache();
    this.redrawContent();
    this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
  }

  private findLastWaitingAgentOnTurn(
    turn: ChatTurn | null | undefined,
  ): ToolCallTimelineEntry | undefined {
    if (!turn) return undefined;
    for (let i = turn.timeline.length - 1; i >= 0; i--) {
      const entry = turn.timeline[i];
      if (entry?.type === "tool" && entry.name === "Agent" && entry.status === "waiting") {
        return entry;
      }
    }
    return undefined;
  }

  private findLastWaitingAgentEntry(): ToolCallTimelineEntry | undefined {
    // Prefer the main live bucket so ctrl+b still works while Explore detail is open.
    return this.findLastWaitingAgentOnTurn(
      this.liveTurnBucket(this.sessionId).turn ?? this.activeTurn,
    );
  }

  private findLastWaitingToolEntry(): ToolCallTimelineEntry | undefined {
    const turn = this.liveTurnBucket(this.sessionId).turn ?? this.activeTurn;
    if (!turn) return undefined;
    for (let i = turn.timeline.length - 1; i >= 0; i--) {
      const entry = turn.timeline[i];
      if (entry?.type === "tool" && entry.status === "waiting") return entry;
      if (entry?.type === "tool" && entry.childTools?.length) {
        for (let c = entry.childTools.length - 1; c >= 0; c--) {
          const child = entry.childTools[c]!;
          if (child.status === "waiting") return child;
        }
      }
    }
    return undefined;
  }

  private hasWaitingTools(): boolean {
    const turn = this.liveTurnBucket(this.sessionId).turn ?? this.activeTurn;
    if (!turn) return false;
    return turn.timeline.some((e) => {
      if (e.type !== "tool") return false;
      if (e.status === "waiting") return true;
      return Boolean(e.childTools?.some((c) => c.status === "waiting"));
    });
  }

  private tickWaitingToolDots(): void {
    const turn = this.activeTurn;
    if (!turn) return;
    for (const entry of turn.timeline) {
      if (entry.type !== "tool") continue;
      if (entry.status === "waiting") {
        entry.dotFrame = (entry.dotFrame + 1) % 4;
      }
      if (entry.childTools) {
        for (const child of entry.childTools) {
          if (child.status === "waiting") {
            child.dotFrame = (child.dotFrame + 1) % 4;
          }
        }
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

  toggleSkillTool(turnId: string, toolId: string): void {
    const turn = this.findTurn(turnId);
    if (!turn) return;
    const entry = turn.timeline.find(
      (e): e is ToolCallTimelineEntry => e.type === "tool" && e.id === toolId,
    );
    if (!entry || entry.name !== "Skill") return;
    entry.skillExpanded = !entry.skillExpanded;
    this.invalidateContentCache();
    this.redrawContent();
  }

  toggleAgentTool(turnId: string, toolId: string): void {
    const turn = this.findTurn(turnId);
    if (!turn) return;
    const entry = turn.timeline.find(
      (e): e is ToolCallTimelineEntry => e.type === "tool" && e.id === toolId,
    );
    if (!entry || entry.name !== "Agent" || entry.backgrounded) return;
    // Waiting: default expanded; success: default collapsed.
    if (entry.status === "waiting") {
      entry.agentExpanded = entry.agentExpanded === false;
    } else {
      entry.agentExpanded = entry.agentExpanded !== true;
    }
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

  toggleWriteEditTool(turnId: string, toolId: string, kind: "write" | "edit"): void {
    const turn = this.findTurn(turnId);
    if (!turn) return;
    const key = `${kind}:${toolId}`;
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
    if (last?.type === "thinking" && last.endedAt === null) {
      turn.expandedThoughts.add(turn.timeline.length - 1);
      return last;
    }

    const now = Date.now();
    const entry: Extract<TurnTimelineEntry, { type: "thinking" }> = {
      type: "thinking",
      text: "",
      startedAt: now,
      lastChunkAt: now,
      endedAt: null,
    };
    turn.timeline.push(entry);
    turn.expandedThoughts.add(turn.timeline.length - 1);
    return entry;
  }

  private finalizeOpenThinking(): void {
    if (!this.activeTurn) return;
    for (let i = this.activeTurn.timeline.length - 1; i >= 0; i--) {
      const entry = this.activeTurn.timeline[i];
      if (entry?.type !== "thinking" || entry.endedAt !== null) continue;
      if (!entry.text.trim()) {
        this.activeTurn.timeline.splice(i, 1);
        this.activeTurn.expandedThoughts.delete(i);
        return;
      }
      entry.endedAt = entry.lastChunkAt;
      // Collapse to "Thought for Ns" after the stream ends.
      this.activeTurn.expandedThoughts.delete(i);
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

  /** Run against the live turn object even if that session is parked. */
  private withLiveTurn(fn: () => void, forSessionId?: string): boolean {
    const bucket = this.liveTurnBucket(forSessionId);
    if (!bucket.turn) return false;
    const displayTurn = this.activeTurn;
    this.activeTurn = bucket.turn;
    try {
      fn();
    } finally {
      bucket.setTurn(this.activeTurn);
      const target = forSessionId ?? this.liveTurnSessionId;
      if (this.isViewingAgentDetail() && target === this.sessionId) {
        this.activeTurn = displayTurn;
      } else {
        this.activeTurn = target === this.sessionId ? this.activeTurn : displayTurn;
      }
    }
    return true;
  }

  private redrawIfLiveTurnVisible(forSessionId?: string): void {
    if (this.readingAgentsPanel) return;
    const target = forSessionId ?? this.liveTurnSessionId;
    if (
      this.agentDetailChildSessionId &&
      target === this.agentDetailChildSessionId
    ) {
      this.syncAgentDetailFromChild(this.agentDetailChildSessionId);
      this.invalidateContentCache();
      this.maybeScrollToBottom();
      this.redrawContent();
      return;
    }
    // Parent nest updated while Explore detail is on screen — keep snapshot in sync,
    // do not redraw the child transcript as if it were the main turn.
    if (
      this.agentDetailSnapshot &&
      target === this.sessionId
    ) {
      return;
    }
    if (target !== this.sessionId) return;
    this.invalidateContentCache();
    this.maybeScrollToBottom();
    this.redrawContent();
  }

  private createStreamingTurn(userText: string): ChatTurn {
    return {
      id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userText,
      answerText: "",
      thinkingStartedAt: Date.now(),
      thinkingEndedAt: null,
      finishedAt: null,
      doneVerb: null,
      generatingVerb: pickGeneratingVerb(),
      outputTokens: 0,
      phase: "thinking",
      timeline: [],
      expandedThoughts: new Set(),
      expandedToolGroups: new Set(),
      expandedChoices: new Set(),
      pulseFrame: 0,
      planMode: this.permissionMode === "plan",
    };
  }

  beginTurn(userText: string): void {
    this.beginTurnForSession(this.sessionId, userText);
  }

  /** Start a UI turn for a specific session (visible or parked for Agents workers). */
  beginTurnForSession(sessionId: string, userText: string): void {
    this.turnExitRequested = false;
    const turn = this.createStreamingTurn(userText);
    if (sessionId === this.sessionId) {
      // Follow-up prompts belong on the main transcript — not a stale Explore stash.
      if (this.agentDetailSnapshot) {
        this.closeAgentDetail();
      }
      this.liveTurnSessionId = sessionId;
      this.activeTurn = turn;
      this.tipText = null;
      this.followBottom = true;
      this.enableMouseDragTracking();
      this.startTurnTick();
      if (!this.readingAgentsPanel) {
        this.scrollToBottom();
        this.invalidateContentCache();
        this.updateGeneratingFooter();
        this.redrawContent();
      }
      return;
    }
    this.ensureParkedShell(sessionId);
    this.parkedSessions.get(sessionId)!.activeTurn = turn;
    if (!this.liveTurnSessionId) {
      this.liveTurnSessionId = sessionId;
    }
    this.startTurnTick();
    // Already watching this child — attach the new live turn to the visible body.
    if (this.agentDetailChildSessionId === sessionId) {
      this.turns = this.parkedSessions.get(sessionId)!.turns;
      this.activeTurn = turn;
      this.followBottom = true;
      this.invalidateContentCache();
      this.scrollToBottom();
      this.updateGeneratingFooter();
      this.redrawContent();
      this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
    }
  }

  appendThinking(text: string, sessionId?: string): void {
    if (!text) return;
    // Protocol wakes (recap): never accumulate ∴ / Thought into the chat timeline.
    if (this.chatStreamMuted) return;
    let silent = false;
    if (
      !this.withLiveTurn(() => {
        if (!this.activeTurn || this.activeTurn.silentChat) {
          silent = true;
          return;
        }
        // Once the visible answer has started, late reasoning must not open a new
        // thinking entry (that splits the answer and used to re-paste answerText).
        if (this.activeTurn.answerText.trim() || this.activeTurn.phase === "answering") {
          return;
        }
        const entry = this.ensureOpenThinkingEntry();
        if (!entry || !this.activeTurn) return;
        entry.text += text;
        entry.lastChunkAt = Date.now();
        this.activeTurn.phase = "thinking";
        this.updateGeneratingFooter();
      }, sessionId)
    ) {
      return;
    }
    if (silent) return;
    this.redrawIfLiveTurnVisible(sessionId);
  }

  /** Stop the thought timer when the model finishes streaming reasoning. */
  endThinkingStream(sessionId?: string): void {
    if (this.chatStreamMuted) return;
    let silent = false;
    if (
      !this.withLiveTurn(() => {
        if (!this.activeTurn || this.activeTurn.silentChat) {
          silent = true;
          return;
        }
        this.finalizeOpenThinking();
      }, sessionId)
    ) {
      return;
    }
    if (silent) return;
    this.redrawIfLiveTurnVisible(sessionId);
  }

  appendAnswer(text: string, sessionId?: string): void {
    if (this.chatStreamMuted) return;
    let silent = false;
    if (
      !this.withLiveTurn(() => {
        if (!this.activeTurn || this.activeTurn.silentChat) {
          silent = true;
          return;
        }
        this.finalizeOpenThinking();
        if (!this.activeTurn.thinkingEndedAt) {
          this.activeTurn.thinkingEndedAt = Date.now();
          this.activeTurn.phase = "answering";
        }
        this.activeTurn.answerText += text;
        // Append only the delta to the open segment. Assigning full answerText here
        // re-pastes prior segments when thinking/events split the timeline mid-stream.
        this.ensureOpenAnswerEntry().text += text;
        this.updateGeneratingFooter();
      }, sessionId)
    ) {
      return;
    }
    if (silent) return;
    this.redrawIfLiveTurnVisible(sessionId);
  }

  /** Remove streamed answer chars (AskUserQuestion guard retry). */
  rollbackAnswer(charCount: number, sessionId?: string): void {
    if (charCount <= 0) return;
    if (this.chatStreamMuted) return;
    if (
      !this.withLiveTurn(() => {
        if (!this.activeTurn || this.activeTurn.silentChat) return;
        const nextLen = Math.max(0, this.activeTurn.answerText.length - charCount);
        this.activeTurn.answerText = this.activeTurn.answerText.slice(0, nextLen);
        const last = this.activeTurn.timeline[this.activeTurn.timeline.length - 1];
        if (last?.type === "answer") {
          // Trim only the open segment — do not assign full answerText (multi-segment turns).
          const segNext = Math.max(0, last.text.length - charCount);
          last.text = last.text.slice(0, segNext);
        }
        if (!this.activeTurn.answerText) {
          this.activeTurn.thinkingEndedAt = null;
          this.activeTurn.phase = "thinking";
        }
        this.updateGeneratingFooter();
      }, sessionId)
    ) {
      return;
    }
    this.redrawIfLiveTurnVisible(sessionId);
  }

  setTurnTokens(tokens: number, sessionId?: string): void {
    if (
      !this.withLiveTurn(() => {
        if (!this.activeTurn) return;
        this.activeTurn.outputTokens = tokens;
        this.updateGeneratingFooter();
      }, sessionId)
    ) {
      return;
    }
    this.redrawIfLiveTurnVisible(sessionId);
  }

  finishHarnessTurn(): void {
    if (!this.activeTurn) return;
    this.finalizeOpenThinking();
    this.activeTurn.harnessOnly = true;
    this.activeTurn.phase = "done";
    this.activeTurn.finishedAt = Date.now();
    if (!this.activeTurn.thinkingEndedAt) {
      this.activeTurn.thinkingEndedAt = this.activeTurn.finishedAt;
    }
    this.turns.push(this.activeTurn);
    this.activeTurn = null;
    this.turnExitRequested = false;
    this.tipText = null;
    this.stopTurnTick();
    if (!this.exitHintTimer) {
      this.shortcutsOverride = null;
    }
    this.maybeScrollToBottom();
    this.invalidateContentCache();
    this.redrawContent();
  }

  finishTurn(): void {
    this.finishTurnForSession(this.liveTurnSessionId ?? this.sessionId);
  }

  finishTurnForSession(sessionId: string): void {
    const bucket = this.liveTurnBucket(sessionId);
    if (!bucket.turn) return;
    const displayTurn = this.activeTurn;
    this.activeTurn = bucket.turn;
    try {
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
      this.activeTurn.doneVerb = this.activeTurn.planMode ? "Worked" : pickDoneVerb();
      // recapText is set by stepped-away wake (or callers via applyRecapToLastCompletedTurn),
      // not auto-derived from answer text.
      if (!this.activeTurn.thinkingEndedAt) {
        this.activeTurn.thinkingEndedAt = this.activeTurn.finishedAt;
      }
      // Silent protocol wakes (recap) must not remain as chat turns.
      if (!this.activeTurn.silentChat) {
        bucket.pushDone(this.activeTurn);
      }
      bucket.setTurn(null);
    } finally {
      if (this.isViewingAgentDetail() && sessionId === this.sessionId) {
        this.activeTurn = displayTurn;
      } else {
        this.activeTurn = sessionId === this.sessionId ? null : displayTurn;
      }
      if (this.liveTurnSessionId === sessionId) {
        this.liveTurnSessionId = this.findAnotherStreamingSessionId(sessionId);
      }
      if (sessionId === this.sessionId) {
        this.turnExitRequested = false;
        this.tipText = null;
        if (!this.isViewingAgentDetail()) {
          this.stopTurnTick();
        }
        if (!this.exitHintTimer) {
          this.shortcutsOverride = null;
        }
      } else if (!this.liveTurnSessionId || this.liveTurnSessionId === this.sessionId) {
        if (!this.activeTurn || this.activeTurn.phase === "done") {
          this.stopTurnTick();
        }
      }
      if (
        sessionId === this.sessionId &&
        !this.readingAgentsPanel &&
        !this.isViewingAgentDetail()
      ) {
        this.maybeScrollToBottom();
        this.invalidateContentCache();
        this.redrawContent();
      } else if (
        this.agentDetailChildSessionId === sessionId &&
        !this.readingAgentsPanel
      ) {
        this.syncAgentDetailFromChild(sessionId);
        this.maybeScrollToBottom();
        this.invalidateContentCache();
        this.redrawContent();
      }
      if (this.readingAgentsPanel) {
        void this.reloadAgentsPanelData().then(() => {
          if (this.readingAgentsPanel) this.drawAgentsPanel();
        });
      }
    }
  }

  private findAnotherStreamingSessionId(excludeId: string): string | null {
    if (
      this.sessionId !== excludeId &&
      this.activeTurn &&
      this.activeTurn.phase !== "done"
    ) {
      return this.sessionId;
    }
    for (const [id, park] of this.parkedSessions) {
      if (id === excludeId) continue;
      if (park.activeTurn && park.activeTurn.phase !== "done") return id;
    }
    return null;
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

  toggleThought(turnId: string, thoughtIndex: number): void {
    const turn = this.findTurn(turnId);
    if (!turn) return;
    toggleThoughtExpanded(turn, thoughtIndex);
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

  private clearCopyHint(): void {
    if (this.copyHintTimer) {
      clearTimeout(this.copyHintTimer);
      this.copyHintTimer = null;
    }
    this.copyHintText = null;
  }

  private clearInputSelection(): void {
    this.inputSelectAnchor = null;
    this.inputSelectEnd = null;
    this.inputMouseSelecting = false;
  }

  private inputSelectionRange(): InputSelectionRange | null {
    if (this.inputSelectAnchor === null || this.inputSelectEnd === null) return null;
    const range = normalizeSelectionRange(this.inputSelectAnchor, this.inputSelectEnd);
    if (range.start === range.end) return null;
    return range;
  }

  private showCopyHint(charCount: number): void {
    this.clearCopyHint();
    this.copyHintText = `copied ${charCount} chars to clipboard`;
    this.copyHintTimer = setTimeout(() => {
      this.copyHintTimer = null;
      this.copyHintText = null;
      if (this.active && this.readingLine) {
        this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
      }
    }, COPY_HINT_MS);
    if (this.active && this.readingLine) {
      this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
    }
  }

  private isInputMouseRow(row: number): boolean {
    // Chat input chrome is painted during readLine and during live turns — both
    // must accept click-to-focus so the caret can appear.
    if (this.inputRowsScreenCount <= 0 || this.isFooterOverlayActive()) return false;
    if (!this.readingLine && !this.isTurnInProgress() && !this.inputResolve) return false;
    const screenRow = row - this.inputRowsScreenStart;
    return screenRow >= 0 && screenRow < this.inputRowsScreenCount;
  }

  private enableMouseDragTracking(): void {
    if (this.mouseDragTracking) return;
    this.mouseDragTracking = true;
    if (process.stdout.isTTY) {
      process.stdout.write(ENABLE_MOUSE_DRAG);
    }
  }

  private disableMouseDragTracking(): void {
    if (!this.mouseDragTracking) return;
    this.mouseDragTracking = false;
    if (process.stdout.isTTY) {
      process.stdout.write(DISABLE_MOUSE_DRAG);
    }
  }

  private handleContentMouseClick(
    phase: "mouseDown" | "mouseUp",
    row: number,
    col: number,
  ): void {
    if (contentClickMousePhase(this.mouseDragTracking, phase) !== "click") return;
    this.handleClick(row, col);
  }

  private handleInputMouse(
    action: { type: "mouseDown" | "mouseDrag" | "mouseUp"; row: number; col: number },
  ): void {
    const screenRow = action.row - this.inputRowsScreenStart;
    if (screenRow < 0 || screenRow >= this.inputRowsScreenCount) return;

    const offset = inputOffsetFromScreen({
      value: this.inputBuffer,
      scrollRow: this.inputScrollRow,
      screenRow,
      screenCol: action.col,
    });

    if (action.type === "mouseDown") {
      this.clearCopyHint();
      // Clicking the input recovers focus from the agent list and shows the caret.
      if (this.agentSwitcherFocus === "list") {
        this.agentSwitcherFocus = "input";
        this.agentSwitcherSelected = currentSessionAgentIndex(
          this.sessionAgentRows(),
          this.agentDetailChildSessionId,
        );
      }
      this.inputSelectAnchor = offset;
      this.inputSelectEnd = offset;
      this.inputMouseSelecting = true;
      this.inputCursor = offset;
      this.syncInputScrollRow();
      this.refreshInputFooter(this.readLinePlain, this.readLinePlaceholder);
      return;
    }

    if (action.type === "mouseDrag" && this.inputMouseSelecting) {
      this.inputSelectEnd = offset;
      this.inputCursor = offset;
      this.syncInputScrollRow();
      this.refreshInputFooter(this.readLinePlain, this.readLinePlaceholder);
      return;
    }

    if (action.type === "mouseUp" && this.inputMouseSelecting) {
      this.inputSelectEnd = offset;
      this.inputMouseSelecting = false;
      this.inputCursor = offset;
      const anchor = this.inputSelectAnchor ?? offset;
      const text = selectedText(this.inputBuffer, anchor, offset);
      if (text) {
        void writeClipboardText(text).then((ok) => {
          if (ok) this.showCopyHint(text.length);
        });
      } else {
        this.clearInputSelection();
      }
      this.refreshInputFooter(this.readLinePlain, this.readLinePlaceholder);
    }
  }

  handleClick(row: number, _col: number): void {
    const action = resolveContentClickTarget({
      allLines: this.allRenderLines(),
      scrollOffset: this.scrollOffset,
      scrollHeight: this.scrollableContentHeight(),
      screenRow: row,
      headerHeight: this.headerHeight,
    });
    if (!action) return;
    switch (action.type) {
      case "toggleThought":
        this.toggleThought(action.turnId, action.thoughtIndex);
        break;
      case "toggleToolGroup":
        this.toggleToolGroup(action.turnId, action.groupId);
        break;
      case "toggleChoice":
        this.toggleChoice(action.turnId, action.choiceId);
        break;
      case "toggleToolError":
        this.toggleToolError(action.turnId, action.toolId);
        break;
      case "togglePlanTool":
        this.togglePlanTool(action.turnId, action.toolId);
        break;
      case "toggleWriteTool":
        this.toggleWriteEditTool(action.turnId, action.toolId, "write");
        break;
      case "toggleEditTool":
        this.toggleWriteEditTool(action.turnId, action.toolId, "edit");
        break;
      case "toggleSkillTool":
        this.toggleSkillTool(action.turnId, action.toolId);
        break;
      case "toggleAgentTool":
        this.toggleAgentTool(action.turnId, action.toolId);
        break;
    }
  }

  private startTurnTick(): void {
    this.stopTurnTick();
    // ~100ms for a fine loading-star morph (dot → cross → star → peak → shrink).
    this.turnTickTimer = setInterval(() => this.onTurnTick(), 100);
  }

  private stopTurnTick(): void {
    if (this.turnTickTimer) {
      clearInterval(this.turnTickTimer);
      this.turnTickTimer = null;
    }
  }

  private tickWaitingDotsOnTurn(turn: ChatTurn): void {
    for (const entry of turn.timeline) {
      if (entry.type !== "tool") continue;
      if (entry.status === "waiting") {
        entry.dotFrame = (entry.dotFrame + 1) % 4;
      }
      if (entry.childTools) {
        for (const child of entry.childTools) {
          if (child.status === "waiting") {
            child.dotFrame = (child.dotFrame + 1) % 4;
          }
        }
      }
    }
  }

  /** Pulse/redraw only the child transcript while Explore detail is open. */
  private onAgentDetailTurnTick(detailId: string): void {
    const park = this.parkedSessions.get(detailId);
    const childTurn = park?.activeTurn ?? this.activeTurn;
    const running = this.isChildAgentSessionRunning(detailId);
    const now = Date.now();
    const due = now - this.lastAgentDetailRefreshAt >= 500;

    // Live stream from beginTurnForSession — paint child only (no L0 churn).
    if (this.isLiveStreamingTurn(childTurn)) {
      childTurn!.pulseFrame = (childTurn!.pulseFrame + 1) % PULSE_FRAME_MOD;
      this.syncAgentDetailFromChild(detailId);
      this.tickWaitingDotsOnTurn(childTurn!);
      this.invalidateContentCache();
      if (childTurn!.expandedThoughts.size === 0) {
        this.maybeScrollToBottom();
      }
      this.updateGeneratingFooter();
      this.redrawContent();
      this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
      return;
    }

    // Fallback: L0 rebuild (e.g. after ctrl+b silence, or before live turn wired).
    if (running && due) {
      this.lastAgentDetailRefreshAt = now;
      void this.refreshAgentDetailPreservingScroll(detailId);
    } else if (childTurn && childTurn.phase !== "done") {
      childTurn.pulseFrame = (childTurn.pulseFrame + 1) % PULSE_FRAME_MOD;
      this.syncAgentDetailFromChild(detailId);
      this.tickWaitingDotsOnTurn(childTurn);
      this.invalidateContentCache();
      this.redrawContent();
      this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
    } else {
      this.updateGeneratingFooter();
      this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
    }
  }

  private onTurnTick(): void {
    if (this.readingConfirm) return;
    if (this.planReviewMode) return;
    if (this.workflowConfirmMode) return;
    if (this.toolApprovalMode) return;
    if (this.readingAgentsPanel) return;

    const detailId = this.agentDetailChildSessionId;
    if (detailId) {
      this.onAgentDetailTurnTick(detailId);
      return;
    }

    const turn =
      this.liveTurnSessionId === this.sessionId
        ? this.activeTurn
        : this.liveTurnBucket().turn ?? this.activeTurn;
    if (!turn || turn.phase === "done") return;
    turn.pulseFrame = (turn.pulseFrame + 1) % PULSE_FRAME_MOD;
    if (this.liveTurnSessionId !== this.sessionId) return;
    const elapsed = (Date.now() - turn.thinkingStartedAt) / 1000;
    if (elapsed >= 3 && !this.tipText) {
      this.tipText =
        CHAT_TIPS[Math.floor(Math.random() * CHAT_TIPS.length)] ?? CHAT_TIPS[0]!;
    }
    if (this.hasWaitingTools()) {
      this.tickWaitingToolDots();
    }
    this.invalidateContentCache();
    if (this.activeTurn && this.activeTurn.expandedThoughts.size === 0) {
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
    if (this.toolApprovalMode) return;
    // Detail focus: show the child's generating status, not the parent's.
    const statusTurn = this.isViewingAgentDetail()
      ? (this.activeTurn ?? this.agentDetailSnapshot?.activeTurn)
      : this.activeTurn;
    if (
      statusTurn &&
      statusTurn.phase !== "done" &&
      !statusTurn.silentChat
    ) {
      this.shortcutsOverride = renderGeneratingStatus(statusTurn);
    } else if (!this.exitHintTimer) {
      this.shortcutsOverride = null;
    }
  }

  redraw(): void {
    if (!this.active) return;
    if (this.readingAgentsPanel) {
      this.drawAgentsPanel();
      return;
    }
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
    if (this.toolApprovalMode) {
      this.syncToolApprovalFooterHeight();
    }
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
    this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
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
    if (this.readingAgentsPanel) {
      this.drawAgentsPanel();
      return;
    }
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
    if (this.toolApprovalMode) {
      this.syncToolApprovalFooterHeight();
    }
    if (this.lastContentRendered.length !== this.contentHeight) {
      this.invalidateContentCache();
    }
    if (this.readingWorkflowsPanel) {
      this.drawWorkflowsPanel();
      return;
    }
    if (this.readingAgentsPanel) {
      this.drawAgentsPanel();
      return;
    }
    if (this.effectiveHeaderMode() === "standard") {
      this.refreshHeader();
    }
    const { cols } = getTerminalSize();
    process.stdout.write(this.renderContentBuffer(cols, true));
    this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
  }

  private clearExitHint(): void {
    if (this.exitHintTimer) {
      clearTimeout(this.exitHintTimer);
      this.exitHintTimer = null;
    }
    this.shortcutsOverride = null;
  }

  private clearInputClearHint(): void {
    if (this.historyClearHintTimer) {
      clearTimeout(this.historyClearHintTimer);
      this.historyClearHintTimer = null;
    }
  }

  private clearRewindArmHint(): void {
    if (this.rewindArmHintTimer) {
      clearTimeout(this.rewindArmHintTimer);
      this.rewindArmHintTimer = null;
    }
  }

  private showRewindArmHint(): void {
    this.clearRewindArmHint();
    const plain = this.readLinePlain;
    const placeholder = this.readLinePlaceholder;
    this.rewindArmHintTimer = setTimeout(() => {
      this.rewindArmHintTimer = null;
      if (this.active && this.readingLine && !this.readingRewind) {
        this.refreshInputFooter(plain, placeholder);
      }
    }, REWIND_ARM_HINT_MS);
  }

  private showInputClearHint(): void {
    this.clearInputClearHint();
    const plain = this.readLinePlain;
    const placeholder = this.readLinePlaceholder;
    this.historyClearHintTimer = setTimeout(() => {
      this.historyClearHintTimer = null;
      if (this.active && this.readingLine) {
        this.refreshInputFooter(plain, placeholder);
      }
    }, HISTORY_CLEAR_HINT_MS);
  }

  private inputTopHintText(): string | null {
    if (this.copyHintText) return this.copyHintText;
    if (this.rewindArmHintTimer) return REWIND_ARM_HINT;
    if (this.historyClearHintTimer) return HISTORY_CLEAR_HINT;
    return null;
  }

  private handleInputEscape(plain: boolean, placeholder?: string): void {
    const canClear = this.inputHistory.isBrowsing() || this.inputBuffer.length > 0;
    if (!canClear) {
      if (this.rewindArmHintTimer) {
        this.clearRewindArmHint();
        void this.openRewindPanel();
        return;
      }
      this.showRewindArmHint();
      this.refreshInputFooter(plain, placeholder);
      return;
    }

    this.clearRewindArmHint();
    if (this.historyClearHintTimer) {
      this.clearInputClearHint();
      if (this.inputHistory.isBrowsing()) {
        this.inputHistory.resetBrowse();
      }
      this.inputBuffer = "";
      this.inputCursor = 0;
      this.inputScrollRow = 0;
      this.syncInputScrollRow();
    } else {
      this.showInputClearHint();
    }
    this.refreshInputFooter(plain, placeholder);
  }

  private showExitHint(): void {
    this.clearExitHint();
    this.shortcutsOverride = `${ansi.muted}${EXIT_HINT}${ansi.reset}`;
    this.exitHintTimer = setTimeout(() => {
      this.exitHintTimer = null;
      this.shortcutsOverride = null;
      if (this.active) {
        this.drawActiveFooter(this.inputBuffer, this.readLinePlaceholder);
      }
    }, EXIT_HINT_MS);
  }

  private footerShortcutLines(inputValue: string): string[] {
    // Browsing may happen while compose-while-busy (readingLine false) — still hide
    // mode / generating hints so the History n/n separator stays the focus.
    if (this.inputHistory.isBrowsing()) {
      return [""];
    }
    if (
      !this.readingConfirm &&
      !this.planReviewMode &&
      !this.workflowConfirmMode &&
      !this.toolApprovalMode
    ) {
      const busy = this.isTurnInProgress();
      const agentCount = this.sessionAgentRows().filter((r) => r.kind === "subagent").length;
      const modeLine = renderPermissionModeFooterHint(this.permissionMode, {
        busy,
        canManageAgents: this.sessionHasManageableAgents(),
        canInterrupt: busy && this.canInterruptActiveTurn(),
        agentCount,
      });
      if (this.readingLine) {
        if (inputValue.length > 0) return [""];
        if (this.exitHintTimer && this.shortcutsOverride) return [this.shortcutsOverride];
        if (this.agentSwitcherFocus === "list" && this.sessionHasManageableAgents()) {
          return [agentListShortcutsHint()];
        }
        if (this.interruptedHintCount > 0) {
          return [formatInterruptedResumeHint(this.interruptedHintCount)];
        }
        const wfLines = renderWorkflowFooterLines(this.workflowFooters, getTerminalSize().cols);
        if (wfLines.length > 0) return wfLines;
        return [modeLine];
      }
      return [modeLine];
    }
    if (this.readingLine) {
      if (inputValue.length > 0) return [""];
      if (this.exitHintTimer && this.shortcutsOverride) return [this.shortcutsOverride];
      if (this.interruptedHintCount > 0) {
        return [formatInterruptedResumeHint(this.interruptedHintCount)];
      }
      const wfLines = renderWorkflowFooterLines(this.workflowFooters, getTerminalSize().cols);
      if (wfLines.length > 0) return wfLines;
      return [this.footerParts.shortcuts];
    }
    if (this.shortcutsOverride) return [this.shortcutsOverride];
    return [this.footerParts.shortcuts];
  }

  private footerTopSeparator(cols: number): string {
    // Show History n/n whenever ↑/↓ browse is active — including mid-turn compose
    // when readingLine is false (canComposeWhileBusy).
    if (this.inputHistory.isBrowsing()) {
      const label = `History ${this.inputHistory.indicatorPosition()}/${this.inputHistory.length}`;
      return renderHistorySeparator(label, cols);
    }
    return inputFooterSeparator(cols);
  }

  private drawFooter(inputValue: string, placeholder?: string): void {
    if (this.isFooterOverlayActive()) {
      this.drawActiveFooter(inputValue, placeholder);
      return;
    }
    const { cols, rows } = getTerminalSize();
    const shortcutLines = this.footerShortcutLines(inputValue);
    const suggestions =
      this.readingLine && !this.readingChoice && !this.wizardMode && !this.readingWorkflowsPanel
        ? this.filteredSlashSuggestions()
        : [];

    if (this.readingLine) {
      this.updateSlashSuggestFooterHeight(suggestions, inputValue);
    } else {
      this.activeFooterHeight = this.clampFooterHeight(
        this.currentInputFooterHeight(inputValue),
      );
    }

    const top = this.footerTop;
    const inputRendered = renderMultilineInput({
      value: inputValue,
      cursor: this.inputCursor,
      scrollRow: this.inputScrollRow,
      cols,
      placeholder: this.inputResolve ? placeholder : undefined,
      selection: this.inputSelectionRange(),
    });
    this.inputScrollRow = inputRendered.scrollRow;

    const agentRows = this.sessionAgentRows();
    // Always show main/agent list while agents are live; ● = current view, ○ = other.
    const agentListLines =
      agentRows.length > 0
        ? renderSessionAgentListLines({
            rows: agentRows,
            selected: this.agentSwitcherSelected,
            currentIndex: currentSessionAgentIndex(
              agentRows,
              this.agentDetailChildSessionId,
            ),
            listFocused: this.agentSwitcherFocus === "list",
            cols,
          })
        : [];

    const shortcutBlock =
      suggestions.length && !this.inputHistory.isBrowsing()
        ? [padToWidth(SLASH_SUGGEST_HINT, cols)]
        : shortcutLines.map((line) => padToWidth(line, cols));

    const inputBlock = [
      ...(this.readingLine && this.inputTopHintText()
        ? [padToWidth(renderInputCopyHint(cols, this.inputTopHintText()!), cols)]
        : []),
      padToWidth(this.footerTopSeparator(cols), cols),
      ...inputRendered.rows.map((line) => padToWidth(line, cols)),
      padToWidth(inputFooterSeparator(cols), cols),
      ...shortcutBlock,
      // Blank line between shortcuts and main / explore.
      ...(agentListLines.length > 0
        ? [padToWidth("", cols), ...agentListLines.map((line) => padToWidth(line, cols))]
        : []),
    ];

    // Trailing rows after the input field: bottomSep + shortcuts (+ blank + agents).
    const agentTrailer = agentListLines.length > 0 ? 1 + agentListLines.length : 0;
    const inputRowOffset =
      inputBlock.length - inputRendered.rows.length - 1 - shortcutBlock.length - agentTrailer;
    const slashLines =
      suggestions.length > 0
        ? renderSlashSuggestLines({
            skills: suggestions,
            selectedIndex: this.slashSuggestSelected,
            cols,
            maxVisible: this.slashSuggestMaxVisible,
          })
        : [];
    this.inputRowsScreenStart = computeInputRowsScreenStart({
      footerTop: top,
      slashSuggestLineCount: slashLines.length,
      inputRowOffset,
    });
    this.inputRowsScreenCount = inputRendered.rows.length;

    const footerRows =
      slashLines.length > 0
        ? [
            padToWidth(footerSeparator(cols), cols),
            ...slashLines.map((line) => padToWidth(line, cols)),
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
    if (
      shouldShowChatInputCaret({
        listFocused: this.agentSwitcherFocus === "list",
        overlayActive: false,
        mouseSelecting: this.inputMouseSelecting,
        hasSelection: this.inputSelectionRange() !== null,
        awaitingLine: Boolean(this.inputResolve) || this.readingLine,
        turnInProgress: this.isTurnInProgress(),
      })
    ) {
      const col = Math.min(cols, inputRendered.cursorScreenCol);
      process.stdout.write(moveTo(this.inputRowsScreenStart + inputRendered.cursorScreenRow, col));
      process.stdout.write(SHOW_CURSOR);
    } else if (
      this.agentSwitcherFocus === "list" ||
      this.inputMouseSelecting ||
      this.inputSelectionRange()
    ) {
      process.stdout.write(HIDE_CURSOR);
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
    this.closeRewindPanel();
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

  private async openRewindPanel(): Promise<void> {
    if (!this.rewindHandlers || this.readingRewind || this.rewindBusy) return;
    this.clearRewindArmHint();
    this.clearInputClearHint();
    const anchors = await this.rewindHandlers.loadTurns();
    this.rewindRows = buildRewindListRows(anchors);
    this.rewindSelected = defaultRewindListSelection(this.rewindRows);
    this.rewindPhase = "list";
    this.rewindConfirmAnchor = null;
    this.rewindConfirmActionIndex = 0;
    this.rewindConfirmContext = "";
    this.readingRewind = true;
    this.updateRewindFooterHeight();
    this.invalidateContentCache();
    this.redrawContent();
    this.drawRewindFooter();
  }

  private closeRewindPanel(): void {
    if (!this.readingRewind) {
      this.clearRewindArmHint();
      return;
    }
    this.readingRewind = false;
    this.rewindPhase = "list";
    this.rewindRows = [];
    this.rewindConfirmAnchor = null;
    this.rewindConfirmHasCodeChanges = false;
    this.rewindConfirmContext = "";
    this.rewindBusy = false;
    this.skipRewindEnterUntil = 0;
    this.lastCtrlCAt = 0;
    // Rewind replaced the bottom chrome — restore chat input when readLine is still armed.
    // Without this, the UI looks blank/exited after Restore and the next Ctrl+C quit the app.
    this.activeFooterHeight = this.defaultFooterHeight;
    this.invalidateContentCache();
    if (!this.active) return;
    this.redrawContent();
    if (this.readingLine) {
      this.drawActiveFooter(
        this.inputBuffer,
        this.readLinePlain ? undefined : this.readLinePlaceholder,
      );
    } else if (this.activeTurn && this.activeTurn.phase !== "done") {
      this.updateGeneratingFooter();
    }
  }

  private updateRewindFooterHeight(): void {
    const { cols } = getTerminalSize();
    const lines =
      this.rewindPhase === "confirm"
        ? renderRewindConfirmPanel({
            messageText: this.rewindConfirmAnchor?.text ?? "",
            timestamp: this.rewindConfirmAnchor?.timestamp,
            actionIndex: this.rewindConfirmActionIndex,
            context: this.rewindConfirmContext,
            cols,
            hasCodeChanges: this.rewindConfirmHasCodeChanges,
            filesChanged: this.rewindConfirmAnchor?.filesChanged,
          })
        : renderRewindListPanel({
            rows: this.rewindRows,
            selected: this.rewindSelected,
            cols,
          });
    this.activeFooterHeight = this.clampFooterHeight(lines.length + 1);
  }

  private rewindSeparatorBadge(): string | undefined {
    const label = this.getWelcomeOpts().sessionLabel?.trim();
    if (!label) return undefined;
    const lower = label.toLowerCase();
    if (lower === "main" || lower.includes("new session") || lower.includes("new chat")) {
      return undefined;
    }
    // Prefer a trailing kebab job slug when the label is "model · job-name".
    const parts = label.split("·").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1] ?? label;
    return last.slice(0, 40);
  }

  private drawRewindFooter(): void {
    if (this.readingAgentsPanel) {
      this.drawAgentsPanel();
      return;
    }
    const { cols, rows } = getTerminalSize();
    const panelLines =
      this.rewindPhase === "confirm"
        ? renderRewindConfirmPanel({
            messageText: this.rewindConfirmAnchor?.text ?? "",
            timestamp: this.rewindConfirmAnchor?.timestamp,
            actionIndex: this.rewindConfirmActionIndex,
            context: this.rewindConfirmContext,
            cols,
            hasCodeChanges: this.rewindConfirmHasCodeChanges,
            filesChanged: this.rewindConfirmAnchor?.filesChanged,
          })
        : renderRewindListPanel({
            rows: this.rewindRows,
            selected: this.rewindSelected,
            cols,
          });
    // Top cyan rule (+ badge) only — Claude does not draw a second rule under hints.
    this.activeFooterHeight = this.clampFooterHeight(panelLines.length + 1);
    const top = this.footerTop;
    const sep = renderRewindSeparator(cols, this.rewindSeparatorBadge());
    const footerRows = [
      padToWidth(sep, cols),
      ...panelLines.map((line) => padToWidth(line, cols)),
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

  private async handleRewindInput(chunk: string): Promise<void> {
    if (this.rewindBusy) return;
    const combined = this.stdinRest + chunk;
    const { actions, rest } = parseInputActions(combined);
    this.stdinRest = rest;
    this.scheduleStdinRestFlush();
    let ignoreEnterInBurst = false;
    for (const action of actions) {
      if (action.type === "escape" || action.type === "interrupt") {
        if (this.rewindPhase === "confirm") {
          this.rewindPhase = "list";
          this.rewindConfirmAnchor = null;
          this.rewindConfirmHasCodeChanges = false;
          this.rewindConfirmContext = "";
          this.updateRewindFooterHeight();
          this.invalidateContentCache();
          this.redrawContent();
          this.drawRewindFooter();
        } else {
          this.closeRewindPanel();
        }
        continue;
      }
      if (action.type === "historyUp") {
        if (this.rewindPhase === "list") {
          this.rewindSelected = Math.max(0, this.rewindSelected - 1);
        } else {
          this.rewindConfirmActionIndex = Math.max(0, this.rewindConfirmActionIndex - 1);
        }
        this.drawRewindFooter();
        continue;
      }
      if (action.type === "historyDown") {
        if (this.rewindPhase === "list") {
          this.rewindSelected = Math.min(this.rewindRows.length - 1, this.rewindSelected + 1);
        } else {
          const max = rewindConfirmActions(this.rewindConfirmHasCodeChanges).length - 1;
          this.rewindConfirmActionIndex = Math.min(max, this.rewindConfirmActionIndex + 1);
        }
        this.drawRewindFooter();
        continue;
      }
      if (this.rewindPhase === "confirm") {
        const actionsList = rewindConfirmActions(this.rewindConfirmHasCodeChanges);
        const current = actionsList[this.rewindConfirmActionIndex];
        if (current?.editable) {
          if (action.type === "backspace") {
            this.rewindConfirmContext = this.rewindConfirmContext.slice(0, -1);
            this.drawRewindFooter();
            continue;
          }
          if (action.type === "char" && action.char !== "\n") {
            this.rewindConfirmContext += action.char;
            this.drawRewindFooter();
            continue;
          }
        }
      }
      if (action.type === "enter") {
        if (ignoreEnterInBurst) continue;
        // Delayed lone \\n after list→confirm (separate stdin chunk).
        if (Date.now() < this.skipRewindEnterUntil) {
          this.skipRewindEnterUntil = 0;
          continue;
        }
        // After restore/summarize close, trailing Enter is handled by readLine suppress.
        if (!this.readingRewind && this.isReadLineEnterSuppressed()) {
          continue;
        }
        const phaseBefore = this.rewindPhase;
        await this.submitRewindSelection();
        // Same keypress burst: do not also confirm Restore / leak Enter after close.
        if (
          (phaseBefore === "list" && this.rewindPhase === "confirm") ||
          (!this.readingRewind && this.isReadLineEnterSuppressed())
        ) {
          ignoreEnterInBurst = true;
        }
        continue;
      }
    }
  }

  private async submitRewindSelection(): Promise<void> {
    if (this.rewindBusy) return;
    if (this.rewindPhase === "list") {
      const row = this.rewindRows[this.rewindSelected];
      if (!row || row.kind === "current") {
        this.closeRewindPanel();
        return;
      }
      if (row.transcriptIndex === undefined || !row.timestamp) return;
      this.rewindConfirmHasCodeChanges = row.hasCodeChanges === true;
      this.rewindConfirmAnchor = {
        text: row.label,
        timestamp: row.timestamp,
        transcriptIndex: row.transcriptIndex,
        hasCodeChanges: row.hasCodeChanges,
        filesChanged: row.filesChanged,
      };
      this.rewindPhase = "confirm";
      this.rewindConfirmActionIndex = 0;
      this.rewindConfirmContext = "";
      this.updateRewindFooterHeight();
      this.invalidateContentCache();
      this.redrawContent();
      this.drawRewindFooter();
      // Brief window for a delayed lone \\n after the list Enter (not sticky).
      this.skipRewindEnterUntil = Date.now() + 120;
      return;
    }

    const action = rewindConfirmActions(this.rewindConfirmHasCodeChanges)[
      this.rewindConfirmActionIndex
    ]?.id as RewindConfirmAction | undefined;
    if (!action || !this.rewindHandlers || !this.rewindConfirmAnchor) return;
    if (action === "never_mind") {
      this.rewindPhase = "list";
      this.rewindConfirmAnchor = null;
      this.rewindConfirmHasCodeChanges = false;
      this.rewindConfirmContext = "";
      this.updateRewindFooterHeight();
      this.invalidateContentCache();
      this.redrawContent();
      this.drawRewindFooter();
      return;
    }

    const anchor = this.rewindConfirmAnchor;
    const context = this.rewindConfirmContext;
    const restoreText =
      action === "restore" || action === "restore_both" ? anchor.text : undefined;
    this.rewindBusy = true;
    try {
      if (action === "restore_code" || action === "restore_both") {
        await this.rewindHandlers.restoreCode(anchor);
      }
      if (action === "restore" || action === "restore_both") {
        await this.rewindHandlers.restore(anchor);
      } else if (action === "summarize_from") {
        await this.rewindHandlers.summarize("from_here", anchor, context);
      } else if (action === "summarize_up_to") {
        await this.rewindHandlers.summarize("up_to_here", anchor, context);
      }
      // Arm before close so a concurrent trailing \\n cannot win the race.
      this.armReadLineEnterSuppress();
      // Close Rewind before prefill so the chat footer (not the Rewind overlay) paints.
      this.closeRewindPanel();
      if (restoreText !== undefined) {
        this.prefillInput(restoreText);
        // Drop sticky exit flags so a prior Agents Ctrl+C cannot farewell the next turn.
        this.appExitRequested = false;
        this.turnExitRequested = false;
        this.lastCtrlCAt = 0;
      }
      debugLog("rewind:confirmSuccess", {
        action,
        restoreText: restoreText?.slice(0, 80),
        readingLine: this.readingLine,
        readingRewind: this.readingRewind,
        suppressUntil: this.suppressReadLineEnterUntil,
        bufPreview: this.inputBuffer.slice(0, 80),
      });
    } catch (err) {
      this.rewindBusy = false;
      debugLog("rewind:confirmError", {
        err: err instanceof Error ? err.message : String(err),
      });
      this.appendContent(
        renderError(err instanceof Error ? err.message : String(err)),
      );
      if (this.readingRewind) {
        this.drawRewindFooter();
      } else if (this.readingLine) {
        this.drawActiveFooter(
          this.inputBuffer,
          this.readLinePlain ? undefined : this.readLinePlaceholder,
        );
      }
    }
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
    this.choiceCustomText = "";
    this.choiceCustomChecked = false;
    this.lastCtrlCAt = 0;

    return new Promise((resolve, reject) => {
      this.choiceResolve = resolve;
      this.choiceReject = reject;
      this.readingChoice = true;
      this.updateChoiceFooterHeight();
      this.redrawChoicePanel();
    });
  }

  async readLine(options?: {
    placeholder?: string;
    plain?: boolean;
    initialValue?: string;
  }): Promise<string> {
    // Single outstanding line-reader: do not arm while Agents owns input.
    await this.waitForAgentsPanelClosed();
    if (this.appExitRequested) {
      debugStack("readLine:throw:appExitRequested");
      throw new ExitRequestedError();
    }

    // A fresh prompt must never inherit a leftover Rewind Enter guard.
    this.clearReadLineEnterSuppress();
    this.readLinePlaceholder = options?.placeholder;
    this.readLinePlain = options?.plain ?? false;
    // Keep text typed while the previous turn was still running.
    const composedDuringBusy = this.inputBuffer;
    this.inputBuffer =
      options?.initialValue !== undefined ? options.initialValue : composedDuringBusy;
    this.inputCursor = this.inputBuffer.length;
    this.inputScrollRow = 0;
    this.clearInputSelection();
    this.clearCopyHint();
    this.syncInputScrollRow();
    this.inputHistory.resetBrowse();
    this.inputRow = this.footerTop + 1;
    this.lastCtrlCAt = 0;

    debugLog("readLine:armed", {
      initialPreview: (options?.initialValue ?? "").slice(0, 80),
      plain: options?.plain ?? false,
    });

    return new Promise((resolve, reject) => {
      this.inputResolve = resolve;
      this.inputReject = reject;
      this.readingLine = true;
      this.enableMouseDragTracking();
      this.drawFooter(this.inputBuffer, this.readLinePlain ? undefined : this.readLinePlaceholder);
    });
  }

  /** True while the user requested turn exit (Esc / Ctrl+C) — polled until the turn ends. */
  isTurnExitRequested(): boolean {
    return this.turnExitRequested;
  }

  /**
   * Abort only the turn the user cancelled — never fan-out Esc from one session to
   * concurrent main-agent turns started from Agents.
   */
  isTurnExitRequestedFor(sessionId: string): boolean {
    if (!this.turnExitRequested) return false;
    if (this.liveTurnSessionId) return this.liveTurnSessionId === sessionId;
    return this.sessionId === sessionId;
  }

  clearTurnExitRequested(): void {
    this.turnExitRequested = false;
  }

  /**
   * Wait until this session can show a blocking overlay without clobbering another
   * concurrent turn's AskUserQuestion / tool approval.
   */
  async acquireSessionOverlay(sessionId: string): Promise<void> {
    for (;;) {
      if (this.canPresentSessionOverlay(sessionId)) {
        this.sessionOverlayOwner = sessionId;
        return;
      }
      await new Promise<void>((resolve) => {
        const list = this.sessionOverlayWaiters.get(sessionId) ?? [];
        list.push(resolve);
        this.sessionOverlayWaiters.set(sessionId, list);
      });
    }
  }

  releaseSessionOverlay(sessionId: string): void {
    if (this.sessionOverlayOwner === sessionId) {
      this.sessionOverlayOwner = null;
    }
    this.wakeSessionOverlayWaiters();
  }

  /** Call after Agents closes or the visible session changes. */
  wakeSessionOverlayWaiters(): void {
    if (this.readingAgentsPanel || !this.sessionId) return;
    const sid = this.sessionId;
    if (
      this.sessionOverlayOwner &&
      this.sessionOverlayOwner !== sid &&
      !this.parkedSessions.has(this.sessionOverlayOwner)
    ) {
      return;
    }
    const list = this.sessionOverlayWaiters.get(sid);
    if (!list?.length) return;
    const next = list.shift()!;
    if (list.length === 0) this.sessionOverlayWaiters.delete(sid);
    else this.sessionOverlayWaiters.set(sid, list);
    queueMicrotask(next);
  }

  canPresentSessionOverlay(sessionId: string): boolean {
    if (!this.sessionId || this.sessionId !== sessionId) return false;
    if (this.readingAgentsPanel) return false;
    if (this.sessionOverlayOwner && this.sessionOverlayOwner !== sessionId) {
      // Owner left mid-prompt — live layout is free for the focused session.
      if (this.parkedSessions.has(this.sessionOverlayOwner)) {
        return !this.hasForegroundBlockingOverlay();
      }
      return false;
    }
    if (this.hasForegroundBlockingOverlay() && this.sessionOverlayOwner !== sessionId) {
      return false;
    }
    return true;
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
    if (this.readingAgentsPanel) {
      this.drawAgentsPanel();
      return;
    }
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
    this.restoreChatScrollAfterOverlay();
    this.redraw();
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
    this.workflowsPanelState = createInitialWorkflowsPanelState();
    this.activeFooterHeight = this.defaultFooterHeight;
    this.invalidateContentCache();
    this.redraw();
    resolve?.();
  }

  private startAgentsPanelTicker(): void {
    this.stopAgentsPanelTicker();
    this.agentsPanelReloadTick = 0;
    this.agentsPanelTickTimer = setInterval(() => {
      void this.onAgentsPanelTick();
    }, 280);
  }

  private stopAgentsPanelTicker(): void {
    if (this.agentsPanelTickTimer) {
      clearInterval(this.agentsPanelTickTimer);
      this.agentsPanelTickTimer = null;
    }
  }

  private agentsComposeBusy(): boolean {
    if (this.agentsPanelState.mode === "reply") {
      // Empty reply with focus still animates Working icons on the selected row.
      return (this.agentsPanelState.replyBuffer ?? "").length > 0;
    }
    if (this.agentsPanelState.composeFocus) return true;
    if (this.agentsPanelState.composeBuffer.length > 0) return true;
    return false;
  }

  private agentsActiveInputText(): string {
    return this.agentsPanelState.mode === "reply"
      ? (this.agentsPanelState.replyBuffer ?? "")
      : this.agentsPanelState.composeBuffer;
  }

  private agentsActiveInputCursor(): number {
    return this.agentsPanelState.mode === "reply"
      ? this.agentsPanelState.replyCursor
      : this.agentsPanelState.composeCursor;
  }

  private setAgentsActiveInput(
    text: string,
    cursor: number,
    focus = true,
    scrollRow?: number,
  ): void {
    const nextCursor = Math.max(0, Math.min(cursor, text.length));
    const cursorLine = cursorLogicalLine(text, nextCursor);
    const totalLines = Math.max(1, text.split("\n").length);
    const nextScroll = clampInputScrollRow(
      scrollRow ??
        (this.agentsPanelState.mode === "reply"
          ? this.agentsPanelState.replyScrollRow
          : this.agentsPanelState.composeScrollRow),
      cursorLine,
      totalLines,
      AGENTS_INPUT_MAX_VISIBLE_LINES,
    );
    if (this.agentsPanelState.mode === "reply") {
      this.agentsPanelState = {
        ...this.agentsPanelState,
        replyBuffer: text,
        replyCursor: nextCursor,
        replyScrollRow: nextScroll,
        composeFocus: focus,
      };
    } else {
      this.agentsPanelState = {
        ...this.agentsPanelState,
        composeBuffer: text,
        composeCursor: nextCursor,
        composeScrollRow: nextScroll,
        composeFocus: focus,
      };
    }
  }

  private agentsSlashSuggestions(): SystemSkillEntry[] {
    if (!this.readingAgentsPanel) return [];
    if (this.agentsPanelState.mode === "reply") return [];
    const text = this.agentsPanelState.composeBuffer;
    const cursor = this.agentsPanelState.composeCursor;
    if (cursorLogicalLine(text, cursor) !== 0) return [];
    const lineText = text.slice(0, lineEndOffset(text, 0));
    if (!shouldShowSlashMenu(lineText, cursor)) return [];
    const query = slashSuggestQuery(lineText, cursor);
    if (query === null) return [];
    return filterSlashSuggestions(query, this.slashInvokableSkills);
  }

  private agentsSlashSuggestLines(cols: number): string[] {
    const suggestions = this.agentsSlashSuggestions();
    if (!suggestions.length) return [];
    return renderSlashSuggestLines({
      skills: suggestions,
      selectedIndex: this.slashSuggestSelected,
      cols,
      maxVisible: Math.min(4, this.slashSuggestMaxVisible || 4),
    });
  }

  private focusAgentsCompose(): void {
    const text = this.agentsActiveInputText();
    this.setAgentsActiveInput(text, text.length, true);
  }

  private blurAgentsCompose(): void {
    this.agentsPanelState = { ...this.agentsPanelState, composeFocus: false };
  }

  private invalidateAgentsPanelPaint(): void {
    this.lastAgentsPanelRendered = [];
    this.lastAgentsPanelSize = { cols: 0, rows: 0 };
  }

  private async onAgentsPanelTick(): Promise<void> {
    if (!this.readingAgentsPanel) return;
    const busy = this.agentsComposeBusy();
    // Avoid pulse/list churn while compose owns the keyboard.
    if (!busy) {
      this.agentsPanelState = {
        ...this.agentsPanelState,
        iconPulseFrame: this.agentsPanelState.iconPulseFrame + 1,
      };
    }
    this.agentsPanelReloadTick += 1;
    let reloaded = false;
    // Reload metas periodically so working → completed moves appear live.
    if (this.agentsPanelReloadTick % 4 === 0) {
      await this.reloadAgentsPanelData();
      reloaded = true;
    }
    if (busy && !reloaded) return;
    this.drawAgentsPanel();
  }

  private drawAgentsPanel(): void {
    const { cols, rows } = getTerminalSize();
    if (
      cols !== this.lastAgentsPanelSize.cols ||
      rows !== this.lastAgentsPanelSize.rows
    ) {
      this.invalidateAgentsPanelPaint();
      this.lastAgentsPanelSize = { cols, rows };
    }
    const pinSelection = this.agentsPinSelection;
    this.agentsPinSelection = true;
    const slashLines = this.agentsSlashSuggestLines(cols);
    const rendered = renderAgentsScreen(
      this.agentsPanelState,
      cols,
      rows,
      this.agentsPanelMetas,
      this.agentsPanelState.openedAt,
      { exitHint: this.agentsExitHintActive, pinSelection, slashLines },
    );
    if (rendered.listScrollOffset !== this.agentsPanelState.listScrollOffset) {
      this.agentsPanelState = {
        ...this.agentsPanelState,
        listScrollOffset: rendered.listScrollOffset,
      };
    }
    // Sync multiline scroll back into state (render may clamp it).
    if (this.agentsPanelState.mode === "reply") {
      if (this.agentsPanelState.replyScrollRow !== rendered.composePaint.scrollRow) {
        this.agentsPanelState = {
          ...this.agentsPanelState,
          replyScrollRow: rendered.composePaint.scrollRow,
        };
      }
    } else if (this.agentsPanelState.composeScrollRow !== rendered.composePaint.scrollRow) {
      this.agentsPanelState = {
        ...this.agentsPanelState,
        composeScrollRow: rendered.composePaint.scrollRow,
      };
    }

    let out = "";
    for (let i = 0; i < rows; i++) {
      const line = padToWidth(rendered.lines[i] ?? "", cols);
      if (this.lastAgentsPanelRendered[i] === line) continue;
      this.lastAgentsPanelRendered[i] = line;
      out += moveTo(i + 1);
      out += clearLine();
      out += line;
    }
    this.lastAgentsPanelRendered.length = rows;
    if (out) process.stdout.write(out);

    const showComposeCursor =
      this.agentsPanelState.composeFocus || this.agentsActiveInputText().length > 0;
    if (showComposeCursor) {
      const inputRow =
        rendered.inputScreenRow + rendered.composePaint.cursorScreenRow;
      const col = Math.min(cols, Math.max(1, rendered.composePaint.cursorScreenCol));
      process.stdout.write(moveTo(inputRow, col));
      process.stdout.write(SHOW_CURSOR);
      return;
    }
    process.stdout.write(HIDE_CURSOR);
  }

  private showAgentsExitHint(): void {
    this.clearExitHint();
    this.agentsExitHintActive = true;
    this.exitHintTimer = setTimeout(() => {
      this.exitHintTimer = null;
      this.agentsExitHintActive = false;
      if (this.readingAgentsPanel) {
        this.drawAgentsPanel();
      }
    }, EXIT_HINT_MS);
    this.drawAgentsPanel();
  }

  private requestAgentsAppExit(): void {
    debugStack("requestAgentsAppExit");
    this.agentsExitHintActive = false;
    this.clearExitHint();
    this.lastCtrlCAt = 0;
    this.appExitRequested = true;
    this.turnExitRequested = true;
    // Do not re-enter chat (flush / detached loop) after an exit request.
    this.afterAgentsClose = null;
    this.closeAgentsPanel({ exitApp: true });
    this.rejectPendingUiForAppExit();
  }

  /** Settle every waiting UI promise so the chat loop can break on ExitRequestedError. */
  private rejectPendingUiForAppExit(): void {
    debugStack("rejectPendingUiForAppExit", {
      readingLine: this.readingLine,
      readingChoice: this.readingChoice,
    });
    if (this.readingLine) {
      const inputReject = this.inputReject;
      this.finishReadLine();
      inputReject?.(new ExitRequestedError());
    }

    if (this.wizardReject) {
      const reject = this.wizardReject;
      this.finishWizard();
      reject(new ExitRequestedError());
    } else if (this.choiceReject) {
      const reject = this.choiceReject;
      this.finishChoice();
      reject(new ExitRequestedError());
    }

    if (this.confirmResolve) {
      this.finishConfirm(false);
    }
    if (this.planReviewResolve) {
      this.finishPlanReview({ action: "cancel" });
    }
    if (this.workflowConfirmResolve) {
      this.finishWorkflowConfirm({ action: "cancel" });
    }
    if (this.toolApprovalResolve) {
      this.finishToolApproval({ action: "deny" });
    }
    if (this.readingWorkflowsPanel) {
      this.closeWorkflowsPanel();
    }
  }

  private closeAgentsPanel(options?: { exitApp?: boolean }): void {
    if (!this.readingAgentsPanel) return;
    this.stopAgentsPanelTicker();
    this.agentsExitHintActive = false;
    this.clearExitHint();
    if (process.stdout.isTTY) {
      // Agents uses 1003 (any-event). Disabling it alone leaves mouse/wheel off in
      // many terminals — restore the default chat tracking used by attachInput().
      process.stdout.write(DISABLE_MOUSE_ANY_EVENT);
      process.stdout.write(
        buildTerminalInputModeEnablement({ mouseDrag: this.mouseDragTracking }),
      );
    }
    const row = this.agentsPanelState.rows[this.agentsPanelState.selectedIndex];
    this.agentsPanelResume = {
      selectedSessionId: row?.kind === "session" ? row.sessionId : undefined,
      listScrollOffset: this.agentsPanelState.listScrollOffset,
      collapsed: { ...this.agentsPanelState.collapsed },
    };
    const resolve = this.agentsPanelResolve;
    this.agentsPanelResolve = null;
    this.readingAgentsPanel = false;
    this.agentsPanelMetas = [];
    this.invalidateAgentsPanelPaint();
    this.agentsPanelState = createAgentsPanelState({
      entryCwd: "",
      entrySessionId: "",
      modelLabel: "",
      agentName: "main",
      version: "",
      metas: [],
    });
    this.invalidateContentCache();
    this.notifyAgentsPanelClosed();
    resolve?.();
    if (options?.exitApp) {
      // Mid-exit: do not re-enter interactive chat (no footer / overlay wake).
      return;
    }
    // Overlay (AskUserQuestion / approval) may still be armed under Agents —
    // recalculate footer height before paint (default chat height clips the picker).
    this.syncOverlayFooterAfterAgents();
    this.wakeSessionOverlayWaiters();
    const after = this.afterAgentsClose;
    this.afterAgentsClose = null;
    const onClosed = this.agentsPanelHandlers?.onAgentsClosed;
    if (after) {
      void after();
    } else if (onClosed) {
      void onClosed();
    }
  }

  private notifyAgentsPanelClosed(): void {
    const waiters = this.agentsPanelClosedWaiters;
    this.agentsPanelClosedWaiters = [];
    for (const waiter of waiters) waiter();
  }

  /** After Agents closes, restore the correct footer for any waiting modal UI. */
  private syncOverlayFooterAfterAgents(): void {
    if (this.readingChoice) {
      if (this.wizardMode) {
        this.redrawWizardPanel();
      } else {
        this.redrawChoicePanel();
      }
      return;
    }
    if (this.toolApprovalMode) {
      this.syncToolApprovalFooterHeight();
      this.redraw();
      this.drawActiveFooter();
      return;
    }
    if (this.planReviewMode) {
      this.redraw();
      this.drawActiveFooter();
      return;
    }
    if (this.workflowConfirmMode) {
      this.redraw();
      this.drawActiveFooter();
      return;
    }
    if (this.readingConfirm) {
      this.redraw();
      this.drawActiveFooter();
      return;
    }
    this.activeFooterHeight = this.defaultFooterHeight;
    this.redraw();
    this.drawActiveFooter();
  }

  /** Refresh one session's Agents list preview/duration after a background reply turn. */
  async refreshAgentsSessionPreview(sessionId: string): Promise<void> {
    if (!this.readingAgentsPanel) return;
    await this.reloadAgentsPanelData({ refreshIds: [sessionId] });
    if (this.readingAgentsPanel) this.drawAgentsPanel();
  }

  private async reloadAgentsPanelData(options?: {
    /** Force-refresh previews/durations for these sessions (e.g. after Agents reply). */
    refreshIds?: Iterable<string>;
  }): Promise<void> {
    const handlers = this.agentsPanelHandlers;
    if (!handlers) return;
    const metas = await handlers.loadSessions();
    const refresh = new Set(options?.refreshIds ?? []);
    const previews: Record<string, string> = { ...this.agentsPanelState.previews };
    const answerDurations: Record<string, number> = {
      ...this.agentsPanelState.answerDurations,
    };
    await Promise.all(
      metas.map(async (m) => {
        if (refresh.has(m.id) || previews[m.id] === undefined) {
          previews[m.id] = await handlers.previewForSession(m.id);
        }
        if (refresh.has(m.id) || answerDurations[m.id] === undefined) {
          answerDurations[m.id] = await handlers.answerDurationForSession(m.id);
        }
      }),
    );
    this.agentsPanelMetas = metas;
    this.agentsPanelState = {
      ...this.agentsPanelState,
      previews,
      answerDurations,
      bgTasks: handlers.loadBgTasks(),
      runningBgSessionIds: new Set(handlers.loadRunningBgSessionIds()),
      interruptedSessionIds: new Set(await handlers.loadInterruptedSessionIds()),
    };
    this.agentsPanelState = refreshAgentsPanelRows(this.agentsPanelState, metas);
  }

  /**
   * Agents Esc: pause in-flight reply/create turns first (chat contract), then
   * clear draft / leave reply / close panel.
   */
  private async handleAgentsPanelEscapeKey(): Promise<"continue" | "close"> {
    if (this.agentsPanelState.deleteArm) {
      this.agentsPanelState = { ...this.agentsPanelState, deleteArm: null };
      this.drawAgentsPanel();
      return "continue";
    }
    // Same contract as chat: Esc while generating pauses the turn. Must run
    // before "clear draft / leave reply" — otherwise Esc exits reply mode
    // and never aborts the in-flight reply.
    if (this.canInterruptActiveTurn()) {
      this.requestTurnCancelForEdit();
      return "continue";
    }
    const replyMode = this.agentsPanelState.mode === "reply";
    const hasInputText = this.agentsActiveInputText().length > 0;
    if (hasInputText) {
      this.setAgentsActiveInput("", 0, true);
      this.drawAgentsPanel();
      return "continue";
    }
    if (replyMode) {
      this.agentsPanelState = {
        ...this.agentsPanelState,
        mode: "list",
        replyBuffer: "",
        replyCursor: 0,
        replyScrollRow: 0,
        replyContext: undefined,
        replySessionId: undefined,
        composeFocus: false,
      };
      this.drawAgentsPanel();
      return "continue";
    }
    if (this.agentsPanelState.composeFocus) {
      this.blurAgentsCompose();
      this.drawAgentsPanel();
      return "continue";
    }
    this.closeAgentsPanel();
    return "close";
  }

  private async handleAgentsPanelInput(chunk: string): Promise<void> {
    const handlers = this.agentsPanelHandlers;
    if (!handlers) return;
    const combined = this.stdinRest + chunk;
    const { actions: rawActions, rest } = parseInputActions(combined);
    this.stdinRest = rest;
    this.scheduleStdinRestFlush();
    const inputActions = await this.expandPasteActions(rawActions);

    for (const action of inputActions) {
      if (action.type === "interrupt") {
        const now = Date.now();
        if (this.lastCtrlCAt && now - this.lastCtrlCAt < CTRL_C_EXIT_MS) {
          this.requestAgentsAppExit();
          return;
        }
        this.lastCtrlCAt = now;
        this.showAgentsExitHint();
        return;
      }

      // Pointer motion alone must not disarm double-Ctrl+C (any-event mouse floods).
      const isPointerMotion =
        action.type === "mouseMove" || action.type === "mouseDrag";
      if (!isPointerMotion) {
        this.lastCtrlCAt = 0;
        if (this.agentsExitHintActive) {
          this.agentsExitHintActive = false;
          this.clearExitHint();
        }
      }

      const replyMode = this.agentsPanelState.mode === "reply";
      const inputText = this.agentsActiveInputText();
      const hasInputText = inputText.length > 0;
      // Any non-empty compose/reply buffer owns arrow keys (cursor motion).
      const editingInput = hasInputText;
      const slashSuggestions = this.agentsSlashSuggestions();
      const slashOpen = slashSuggestions.length > 0;

      if (action.type === "escape") {
        if ((await this.handleAgentsPanelEscapeKey()) === "close") return;
        continue;
      }

      if (action.type === "scroll") {
        this.agentsPanelState = {
          ...this.agentsPanelState,
          listScrollOffset: this.agentsPanelState.listScrollOffset + action.delta,
        };
        this.agentsPinSelection = false;
        this.drawAgentsPanel();
        continue;
      }

      if (slashOpen && action.type === "historyUp") {
        this.slashSuggestSelected = Math.max(0, this.slashSuggestSelected - 1);
        this.drawAgentsPanel();
        continue;
      }
      if (slashOpen && action.type === "historyDown") {
        this.slashSuggestSelected = Math.min(
          slashSuggestions.length - 1,
          this.slashSuggestSelected + 1,
        );
        this.drawAgentsPanel();
        continue;
      }
      if (slashOpen && (action.type === "tab" || action.type === "shiftTab")) {
        const entry = slashSuggestions[this.slashSuggestSelected] ?? slashSuggestions[0];
        if (entry) {
          const completed = completeSlashSuggestion(inputText, entry);
          this.setAgentsActiveInput(completed, completed.length, true);
          this.slashSuggestSelected = 0;
          this.drawAgentsPanel();
        }
        continue;
      }

      // Editing: arrows move the caret. Empty input: arrows navigate the list.
      if (editingInput) {
        const cursor = this.agentsActiveInputCursor();
        if (action.type === "cursorLeft") {
          this.setAgentsActiveInput(inputText, prevCodePointIndex(inputText, cursor), true);
          this.drawAgentsPanel();
          continue;
        }
        if (action.type === "cursorRight") {
          this.setAgentsActiveInput(inputText, nextCodePointIndex(inputText, cursor), true);
          this.drawAgentsPanel();
          continue;
        }
        if (action.type === "cursorHome") {
          this.setAgentsActiveInput(
            inputText,
            lineStartOffset(inputText, cursorLogicalLine(inputText, cursor)),
            true,
          );
          this.drawAgentsPanel();
          continue;
        }
        if (action.type === "cursorEnd") {
          this.setAgentsActiveInput(
            inputText,
            lineEndOffset(inputText, cursorLogicalLine(inputText, cursor)),
            true,
          );
          this.drawAgentsPanel();
          continue;
        }
        if (action.type === "historyUp") {
          this.setAgentsActiveInput(inputText, moveCursorUp(inputText, cursor), true);
          this.drawAgentsPanel();
          continue;
        }
        if (action.type === "historyDown") {
          this.setAgentsActiveInput(inputText, moveCursorDown(inputText, cursor), true);
          this.drawAgentsPanel();
          continue;
        }
        if (action.type === "newline") {
          const next = insertNewlineAtCursor(inputText, cursor);
          this.setAgentsActiveInput(next.text, next.cursor, true);
          this.drawAgentsPanel();
          continue;
        }
      } else {
        if (action.type === "cursorLeft") {
          // ← is a no-op when the compose box is empty (← from chat opens Agents).
          continue;
        }
        if (action.type === "historyUp") {
          this.blurAgentsCompose();
          this.setAgentsSelectedIndex(
            Math.max(0, this.agentsPanelState.selectedIndex - 1),
          );
          this.pinAgentsSelection();
          this.drawAgentsPanel();
          continue;
        }
        if (action.type === "historyDown") {
          this.blurAgentsCompose();
          this.setAgentsSelectedIndex(
            Math.min(
              Math.max(0, this.agentsPanelState.rows.length - 1),
              this.agentsPanelState.selectedIndex + 1,
            ),
          );
          this.pinAgentsSelection();
          this.drawAgentsPanel();
          continue;
        }
        if (action.type === "cursorRight") {
          this.blurAgentsCompose();
          await this.activateAgentsPanelSelection();
          return;
        }
      }

      if (action.type === "ctrlX") {
        await this.handleAgentsDeleteKey();
        continue;
      }

      // Space on empty list focus → reply mode; empty reply → close. Typing inserts space.
      if (action.type === "char" && action.char === " " && !hasInputText) {
        if (replyMode) {
          this.agentsPanelState = {
            ...this.agentsPanelState,
            mode: "list",
            replyBuffer: "",
            replyCursor: 0,
            replyScrollRow: 0,
            replyContext: undefined,
            replySessionId: undefined,
            composeFocus: false,
          };
          this.drawAgentsPanel();
          continue;
        }
        const row = this.agentsPanelState.rows[this.agentsPanelState.selectedIndex];
        if (row?.kind === "session" && !this.agentsPanelState.composeFocus) {
          const ctx =
            this.agentsPanelState.previews[row.sessionId] ||
            (await handlers.previewForSession(row.sessionId));
          this.agentsPanelState = {
            ...this.agentsPanelState,
            mode: "reply",
            replySessionId: row.sessionId,
            replyContext: ctx,
            replyBuffer: "",
            replyCursor: 0,
            replyScrollRow: 0,
            composeFocus: true,
            deleteArm: null,
          };
          this.drawAgentsPanel();
          continue;
        }
      }

      if (action.type === "mouseMove" || action.type === "mouseDrag") {
        if (this.agentsComposeZoneAtScreen(action.row)) continue;
        const hit = this.agentsPanelRowAtScreen(action.row);
        if (hit === null || hit === this.agentsPanelState.selectedIndex) continue;
        this.blurAgentsCompose();
        this.setAgentsSelectedIndex(hit);
        this.pinAgentsSelection();
        this.drawAgentsPanel();
        continue;
      }

      if (action.type === "mouseDown") {
        if (this.agentsComposeZoneAtScreen(action.row)) {
          this.focusAgentsCompose();
          this.drawAgentsPanel();
          return;
        }
        const hit = this.agentsPanelRowAtScreen(action.row);
        if (hit === null) continue;
        this.blurAgentsCompose();
        if (hit !== this.agentsPanelState.selectedIndex) {
          this.setAgentsSelectedIndex(hit);
          this.pinAgentsSelection();
        }
        await this.activateAgentsPanelSelection();
        return;
      }

      if (action.type === "enter") {
        if (replyMode) {
          const text = inputText.trim();
          const sid = this.agentsPanelState.replySessionId;
          if (text && sid) {
            // Keep reply box open: context ← sent text, input cleared (Claude-style).
            // Turn runs in background; list preview refreshes when the turn finishes.
            // Sending a reply adopts that session as current (list label + chat focus).
            this.agentsPanelState = {
              ...this.agentsPanelState,
              mode: "reply",
              replySessionId: sid,
              replyContext: text,
              replyBuffer: "",
              replyCursor: 0,
              replyScrollRow: 0,
              composeFocus: true,
              entrySessionId: sid,
            };
            this.agentsPanelState = refreshAgentsPanelRows(
              this.agentsPanelState,
              this.agentsPanelMetas,
            );
            this.drawAgentsPanel();
            await handlers.onReplySession(sid, text);
            const idx = this.agentsPanelState.rows.findIndex(
              (r) => r.kind === "session" && r.sessionId === sid,
            );
            if (idx >= 0) {
              this.agentsPanelState = {
                ...this.agentsPanelState,
                selectedIndex: idx,
              };
              this.pinAgentsSelection();
            }
            this.drawAgentsPanel();
          }
          continue;
        }
        const compose = slashOpen
          ? resolveSlashSubmitValue(inputText, slashSuggestions, this.slashSuggestSelected)
          : inputText.trim();
        if (compose) {
          // Clear immediately so the compose box is empty once the task shows in Working.
          this.setAgentsActiveInput("", 0, false);
          this.slashSuggestSelected = 0;
          this.drawAgentsPanel();
          await handlers.onCreateSession(compose);
          await this.reloadAgentsPanelData();
          this.drawAgentsPanel();
          continue;
        }
        await this.activateAgentsPanelSelection();
        return;
      }

      if (action.type === "backspace") {
        const cursor = this.agentsActiveInputCursor();
        if (!hasInputText) {
          this.blurAgentsCompose();
          this.drawAgentsPanel();
          continue;
        }
        const at = prevCodePointIndex(inputText, cursor);
        this.setAgentsActiveInput(inputText.slice(0, at) + inputText.slice(cursor), at, true);
        this.drawAgentsPanel();
        continue;
      }

      if (action.type === "paste") {
        await this.handlePaste();
        continue;
      }

      if (action.type === "pasteText") {
        await this.handlePasteContent(action.text);
        continue;
      }

      if (action.type === "char") {
        const cursor = this.agentsPanelState.composeFocus
          ? this.agentsActiveInputCursor()
          : inputText.length;
        const next = inputText.slice(0, cursor) + action.char + inputText.slice(cursor);
        this.setAgentsActiveInput(next, cursor + action.char.length, true);
        const query = slashSuggestQuery(next, cursor + action.char.length) ?? "";
        if (query !== this.lastSlashSuggestQuery) {
          this.slashSuggestSelected = 0;
          this.lastSlashSuggestQuery = query;
        }
        this.drawAgentsPanel();
        continue;
      }
    }
  }

  private agentsComposeZoneAtScreen(screenRow: number): boolean {
    const { cols, rows } = getTerminalSize();
    return agentsComposeHitTest(
      this.agentsPanelState,
      screenRow,
      cols,
      rows,
      this.agentsPanelMetas,
      this.agentsPanelState.openedAt,
      this.agentsSlashSuggestLines(cols),
    );
  }

  /** Change list selection and force a full Agents repaint (avoids wrap leftovers). */
  private setAgentsSelectedIndex(selectedIndex: number): void {
    if (selectedIndex === this.agentsPanelState.selectedIndex) {
      this.agentsPanelState = { ...this.agentsPanelState, deleteArm: null };
      return;
    }
    this.invalidateAgentsPanelPaint();
    this.agentsPanelState = {
      ...this.agentsPanelState,
      deleteArm: null,
      selectedIndex,
    };
  }

  private agentsPanelRowAtScreen(screenRow: number): number | null {
    const { cols, rows } = getTerminalSize();
    return agentsPanelHitTest(
      this.agentsPanelState,
      screenRow,
      cols,
      rows,
      this.agentsPanelMetas,
      this.agentsPanelState.openedAt,
    );
  }

  private pinAgentsSelection(): void {
    const { cols, rows } = getTerminalSize();
    this.agentsPanelState = {
      ...this.agentsPanelState,
      listScrollOffset: pinAgentsSelectionInView(
        this.agentsPanelState,
        cols,
        rows,
        this.agentsPanelMetas,
        this.agentsPanelState.openedAt,
      ),
    };
    this.agentsPinSelection = true;
  }

  private async activateAgentsPanelSelection(): Promise<void> {
    const handlers = this.agentsPanelHandlers;
    if (!handlers) return;
    const row = this.agentsPanelState.rows[this.agentsPanelState.selectedIndex];
    if (!row) return;
    if (row.kind === "group") {
      const nextCollapsed = {
        ...this.agentsPanelState.collapsed,
        [row.bucket]: !row.collapsed,
      };
      this.agentsPanelState = {
        ...this.agentsPanelState,
        collapsed: nextCollapsed,
        deleteArm: null,
        rows: buildAgentsRows(
          this.agentsPanelMetas,
          this.agentsPanelState.previews,
          nextCollapsed,
          this.agentsPanelState.bgTasks,
          this.agentsPanelState.entrySessionId,
          this.agentsPanelState.sessionVisits,
          this.agentsPanelState.answerDurations,
          this.agentsPanelState.runningBgSessionIds,
          this.agentsPanelState.interruptedSessionIds,
        ),
      };
      this.drawAgentsPanel();
      return;
    }
    if (row.kind === "session") {
      const sessionVisits = await markAgentsSessionRead(row.sessionId);
      this.agentsPanelState = { ...this.agentsPanelState, sessionVisits };
      await handlers.onOpenSession(row.sessionId);
      this.closeAgentsPanel();
      return;
    }
    if (row.kind === "bg") {
      this.closeAgentsPanel();
    }
  }

  private async handleAgentsDeleteKey(): Promise<void> {
    const handlers = this.agentsPanelHandlers;
    if (!handlers) return;
    const row = this.agentsPanelState.rows[this.agentsPanelState.selectedIndex];
    const arm = this.agentsPanelState.deleteArm;

    if (arm?.target === "session" && row?.kind === "session" && arm.sessionId === row.sessionId) {
      await handlers.onDeleteSession(row.sessionId);
      this.agentsPanelState = { ...this.agentsPanelState, deleteArm: null };
      await this.reloadAgentsPanelData();
      this.drawAgentsPanel();
      return;
    }
    if (arm?.target === "group" && row?.kind === "group" && arm.bucket === row.bucket) {
      const toDelete = this.agentsPanelMetas.filter(
        (m) =>
          !m.parentSessionId &&
          classifySessionBucket(
            m,
            this.agentsPanelState.runningBgSessionIds,
            this.agentsPanelState.interruptedSessionIds,
          ) === row.bucket,
      );
      for (const m of toDelete) {
        await handlers.onDeleteSession(m.id);
      }
      this.agentsPanelState = { ...this.agentsPanelState, deleteArm: null };
      await this.reloadAgentsPanelData();
      this.drawAgentsPanel();
      return;
    }

    if (row?.kind === "session") {
      this.agentsPanelState = {
        ...this.agentsPanelState,
        deleteArm: { target: "session", sessionId: row.sessionId },
      };
      this.drawAgentsPanel();
      return;
    }
    if (row?.kind === "group") {
      this.agentsPanelState = {
        ...this.agentsPanelState,
        deleteArm: { target: "group", bucket: row.bucket },
      };
      this.drawAgentsPanel();
    }
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
    return prepareWorkflowRunsForPanel(this.workflowsPanelState.runs);
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
        if (key === "j" && this.workflowsPanelState.view === "agent") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            agentDetailScroll: this.workflowsPanelState.agentDetailScroll + 1,
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
          return;
        }
        if (key === "k" && this.workflowsPanelState.view === "agent") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            agentDetailScroll: Math.max(0, this.workflowsPanelState.agentDetailScroll - 1),
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
          return;
        }
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
            const runs = prepareWorkflowRunsForPanel(
              await loadWorkflowRuns(this.workflowsPanelSessionId),
            );
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
          detailFocus: "agent",
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
            detailFocus: "agent",
            agentDetailScroll: 0,
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
          return;
        }
        if (this.workflowsPanelState.view === "detail") {
          if (this.workflowsPanelState.detailFocus === "agent") {
            this.workflowsPanelState = {
              ...this.workflowsPanelState,
              detailFocus: "phase",
              selectedAgentIndex: 0,
              notice: undefined,
            };
            this.redrawWorkflowsPanel();
            return;
          }
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            view: "list",
            selectedPhaseIndex: 0,
            selectedAgentIndex: 0,
            detailFocus: "phase",
            agentDetailScroll: 0,
            phases: [],
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
          return;
        }
        this.closeWorkflowsPanel();
        return;
      }

      if (this.workflowsPanelState.view === "detail" && action.type === "left") {
        if (this.workflowsPanelState.detailFocus === "agent") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            detailFocus: "phase",
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
        }
        continue;
      }

      if (
        (action.type === "right" || action.type === "enter") &&
        this.workflowsPanelState.view === "detail"
      ) {
        const phase = this.workflowsPanelState.phases[this.workflowsPanelState.selectedPhaseIndex];
        if (this.workflowsPanelState.detailFocus === "phase") {
          if (phase?.agents.length) {
            this.workflowsPanelState = {
              ...this.workflowsPanelState,
              detailFocus: "agent",
              selectedAgentIndex: 0,
              notice: undefined,
            };
            this.redrawWorkflowsPanel();
          }
          continue;
        }
        if (phase?.agents.length) {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            view: "agent",
            agentDetailScroll: 0,
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
        }
        continue;
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
            detailFocus: "phase",
            selectedPhaseIndex: 0,
            selectedAgentIndex: 0,
            agentDetailScroll: 0,
            notice: undefined,
          };
          await this.loadWorkflowsPanelPhases(run);
          this.redrawWorkflowsPanel();
        }
        continue;
      }

      if (this.workflowsPanelState.view === "detail") {
        const phases = this.workflowsPanelState.phases;
        const phase = phases[this.workflowsPanelState.selectedPhaseIndex];
        const agents = phase?.agents ?? [];
        if (this.workflowsPanelState.detailFocus === "phase") {
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
        } else if (action.type === "up") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            selectedAgentIndex: Math.max(0, this.workflowsPanelState.selectedAgentIndex - 1),
            notice: undefined,
          };
          this.redrawWorkflowsPanel();
        } else if (action.type === "down") {
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
        continue;
      }

      if (this.workflowsPanelState.view === "agent") {
        const phase = this.workflowsPanelState.phases[this.workflowsPanelState.selectedPhaseIndex];
        const agents = phase?.agents ?? [];
        if (action.type === "up") {
          this.workflowsPanelState = {
            ...this.workflowsPanelState,
            selectedAgentIndex: Math.max(0, this.workflowsPanelState.selectedAgentIndex - 1),
            agentDetailScroll: 0,
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
            agentDetailScroll: 0,
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
    cwd?: string;
  }): Promise<WorkflowConfirmDecision> {
    const entry = this.findLastWaitingToolEntry();
    if (entry) entry.awaitingApproval = true;

    this.workflowConfirmMode = true;
    this.workflowConfirmMeta = opts.meta;
    this.workflowConfirmArgs = opts.args;
    this.workflowConfirmScriptSource = opts.scriptSource;
    this.workflowConfirmScriptPath = opts.scriptPath;
    this.workflowConfirmCwd = opts.cwd?.trim() || process.cwd();
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
      workflowConfirmPanelRowCount(cols, this.workflowConfirmView, {
        workflowName: this.workflowConfirmMeta?.name,
        cwd: this.workflowConfirmCwd,
      }),
    );
  }

  private drawWorkflowConfirmFooter(): void {
    if (this.readingAgentsPanel) {
      this.drawAgentsPanel();
      return;
    }
    const { cols, rows } = getTerminalSize();
    const top = this.footerTop;
    const panelLines = renderWorkflowConfirmPanelLines({
      state: this.workflowConfirmView,
      scriptPath: this.workflowConfirmScriptPath,
      cols,
      workflowName: this.workflowConfirmMeta?.name,
      cwd: this.workflowConfirmCwd,
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

    const rows = buildWorkflowConfirmChoiceRows(this.workflowConfirmView, {
      workflowName: this.workflowConfirmMeta?.name,
      cwd: this.workflowConfirmCwd,
    });
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
        if (optionIndex === WORKFLOW_CONFIRM_SCRIPT_OPTION_INDEX) {
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
    this.workflowConfirmCwd = "";
    this.workflowConfirmView = {
      scriptVisible: false,
      scriptToggled: false,
      selectedIndex: 0,
    };

    const entry = this.findLastWaitingToolEntry();
    if (entry) entry.awaitingApproval = false;

    this.restoreDefaultFooter();
    this.invalidateContentCache();
    this.restoreChatScrollAfterOverlay();
    this.redraw();
    if (this.activeTurn && this.activeTurn.phase !== "done") {
      this.updateGeneratingFooter();
    }
    resolve?.(decision);
  }

  async readToolApproval(opts: { toolCall: ToolCall; cwd: string }): Promise<ToolConfirmResult> {
    // AskUser / wizard may still hold choice chrome — approval must own the footer.
    this.readingChoice = false;
    this.wizardMode = false;
    this.finishChoice();
    this.finishWizard();

    const entry = this.findLastWaitingToolEntry();
    if (entry) {
      entry.awaitingApproval = true;
      entry.approvalRequired = true;
    }

    process.stdout.write(HIDE_CURSOR);
    this.toolApprovalMode = true;
    this.toolApprovalContent = null;
    this.toolApprovalSelected = 0;
    this.scrollOffset = 0;
    this.followBottom = false;
    this.shortcutsOverride = null;
    this.updateToolApprovalFooterHeight();
    this.invalidateContentCache();
    this.redraw();
    this.drawToolApprovalFooter();

    const { cols } = getTerminalSize();
    const content = await buildToolApprovalContent(opts.toolCall, opts.cwd, cols);

    this.toolApprovalContent = content;
    this.updateToolApprovalFooterHeight(content);
    this.invalidateContentCache();
    this.redraw();

    return new Promise((resolve) => {
      this.pendingToolApprovalCall = opts.toolCall;
      this.pendingToolApprovalCwd = opts.cwd;
      this.toolApprovalResolve = resolve;
    });
  }

  private buildToolApprovalContentLines(): RenderLine[] {
    const { cols } = getTerminalSize();
    const content = this.toolApprovalContent;
    if (!content) {
      return [{ text: `${ansi.muted}Loading preview…${ansi.reset}` }];
    }
    const texts = renderToolApprovalContentLines(content, cols);
    return texts.map((text) => ({ text }));
  }

  private updateToolApprovalFooterHeight(content?: ToolApprovalContent | null): void {
    const { cols } = getTerminalSize();
    this.activeFooterHeight = this.clampFooterHeight(
      toolApprovalPanelRowCount(cols, content ?? undefined),
    );
  }

  private syncToolApprovalFooterHeight(): void {
    if (!this.toolApprovalMode) return;
    const prev = this.activeFooterHeight;
    this.updateToolApprovalFooterHeight(this.toolApprovalContent);
    if (prev !== this.activeFooterHeight) {
      this.invalidateContentCache();
    }
  }

  private drawToolApprovalFooter(): void {
    if (this.readingAgentsPanel) {
      this.drawAgentsPanel();
      return;
    }
    this.syncToolApprovalFooterHeight();
    const { cols, rows } = getTerminalSize();
    const top = this.footerTop;
    const content = this.toolApprovalContent;

    const panelLines = content
      ? renderToolApprovalPanelLines({
          content,
          selectedIndex: this.toolApprovalSelected,
          cols,
        })
      : [`${ansi.muted}Loading preview…${ansi.reset}`];
    const sep = footerSeparator(cols);
    const footerRows = [
      padToWidth(sep, cols),
      ...padToolApprovalLines(panelLines, cols),
      padToWidth(sep, cols),
      padToWidth(TOOL_APPROVAL_HINT, cols),
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

  private handleToolApprovalInput(chunk: string): void {
    const content = this.toolApprovalContent;
    if (!content) return;

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
      if (action.type === "left") {
        if (shouldPopAgentDetailOnLeft(this.agentDetailSnapshot !== null)) {
          this.closeAgentDetail();
          return;
        }
        void this.openAgentsPanel(this.sessionId);
        return;
      }
      if (action.type === "interrupt" || action.type === "escape") {
        this.finishToolApproval({ action: "deny" });
        return;
      }
      if (action.type === "shiftTab") {
        this.toolApprovalSelected = 1;
        this.drawToolApprovalFooter();
        return;
      }
      if (action.type === "up") {
        this.toolApprovalSelected = Math.max(0, this.toolApprovalSelected - 1);
        this.drawToolApprovalFooter();
      }
      if (action.type === "down") {
        this.toolApprovalSelected = Math.min(content.rows.length - 1, this.toolApprovalSelected + 1);
        this.drawToolApprovalFooter();
      }
      if (action.type === "enter") {
        const row = content.rows[this.toolApprovalSelected];
        if (!row) return;
        this.finishToolApproval(toolApprovalDecisionFromRow(row, content.networkHosts));
        return;
      }
    }
  }

  private finishToolApproval(decision: ReturnType<typeof toolApprovalDecisionFromRow>): void {
    const resolve = this.toolApprovalResolve;
    const toolCall = this.pendingToolApprovalCall;
    const cwd = this.pendingToolApprovalCwd;

    this.toolApprovalResolve = null;
    this.toolApprovalMode = false;
    this.toolApprovalContent = null;
    this.toolApprovalSelected = 0;
    this.pendingToolApprovalCall = null;
    this.pendingToolApprovalCwd = undefined;

    const entry = this.findLastWaitingToolEntry();
    if (entry) {
      entry.awaitingApproval = false;
      entry.approvalRequired = true;
      entry.approvalGranted = decision.action !== "deny";
    }

    this.restoreDefaultFooter();
    this.invalidateContentCache();
    this.restoreChatScrollAfterOverlay();
    this.redraw();
    if (this.activeTurn && this.activeTurn.phase !== "done") {
      this.updateGeneratingFooter();
    }

    if (!resolve || !toolCall) {
      resolve?.({ allowed: false, denialReason: "User denied tool execution" });
      return;
    }

    resolve(toolConfirmResultFromDecision(toolCall, decision, cwd ?? undefined));
  }
}
