import { homedir } from "node:os";
import { basename } from "node:path";
import {
  ansi,
  displayWidth,
  pink,
  pinkBold,
  stripAnsi,
  visibleLength,
} from "./ansi.js";
import {
  computeClaudeBoxLayout,
  type ClaudeFooterParts,
  pinLeftColumnBottom,
  renderClaudeFooter,
  renderClaudeFooterParts,
  renderClaudeTwoColumnBox,
} from "./box.js";
import { KAKO_DINO, KAKO_DINO_MINI } from "./mascot.js";
import type { ChatHeaderMode } from "./cli-usage.js";

const H = "─";

export interface WelcomeScreenOptions {
  version: string;
  agentName: string;
  /** Display label: alias, else model/endpoint ID (no provider name). */
  modelLabel: string;
  cwd: string;
  contextPath?: string;
  globalContextPath?: string;
  sessionId: string;
  sessionLabel: string;
  dataDir: string;
}

/** Small dinosaur mascot for the welcome panel. */
export { KAKO_DINO } from "./mascot.js";

function shortenPath(path: string, maxLen = 28): string {
  const home = homedir();
  const display = path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  if (display.length <= maxLen) return display;
  return `…${display.slice(-maxLen + 1)}`;
}

function wrapPlain(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function sectionHeader(title: string): string {
  return pinkBold(title);
}

function bodyText(text: string): string {
  return `${ansi.text}${text}${ansi.reset}`;
}

function italicMuted(text: string): string {
  return `${ansi.muted}${ansi.italic}${text}${ansi.reset}`;
}

function buildLeftTop(opts: WelcomeScreenOptions): string[] {
  return [
    "",
    pinkBold("Welcome back!"),
    "",
    ...KAKO_DINO.map((row) => pink(row)),
    "",
    bodyText(opts.modelLabel),
  ];
}

function buildRightColumn(opts: WelcomeScreenOptions): string[] {
  const layout = computeClaudeBoxLayout();
  const w = layout.rightContentWidth;

  const tipLines = wrapPlain(
    opts.contextPath
      ? `Project context loaded from ${basename(opts.contextPath)}. Edit ~/.kako/KAKO.md for global preferences.`
      : opts.globalContextPath
        ? "Edit ~/.kako/KAKO.md for global instructions. Add KAKO.md in your project for project context."
        : "Add KAKO.md in your project root for project context. Edit ~/.kako/KAKO.md for global preferences.",
    w,
  );

  const newsLines = wrapPlain(
    "Use /sessions and /resume to switch chats. Configure providers in the Web UI (pnpm dev:web).",
    w,
  );

  const lines: string[] = [
    sectionHeader("Tips for getting started"),
    ...tipLines.map(bodyText),
    pink(H.repeat(w)),
    sectionHeader("What's new"),
    ...newsLines.map(bodyText),
    italicMuted("/help for more"),
  ];
  return lines;
}

export function renderWelcomeScreen(opts: WelcomeScreenOptions): string {
  const title = `Kako v${opts.version}`;
  const rightLines = buildRightColumn(opts);
  const leftLines = pinLeftColumnBottom(
    buildLeftTop(opts),
    bodyText(shortenPath(opts.cwd)),
    rightLines.length,
  );
  return renderClaudeTwoColumnBox(title, leftLines, rightLines, {
    leftAlign: "center",
  });
}

const MINI_ICON_WIDTH = 10;
const MINI_LEFT_MARGIN = " ";
const MINI_ICON_TEXT_GAP = " ";

function padMiniIconColumn(text: string): string {
  const w = displayWidth(text);
  if (w >= MINI_ICON_WIDTH) return text;
  return text + " ".repeat(MINI_ICON_WIDTH - w);
}

function miniHeaderTitle(version: string): string {
  return `${ansi.text}${ansi.bold}Kako${ansi.reset} ${ansi.muted}v${version}${ansi.reset}`;
}

function miniHeaderMetaLine(opts: WelcomeScreenOptions): string {
  return `${ansi.muted}${opts.modelLabel} · ${opts.agentName} agent${ansi.reset}`;
}

/** Compact pinned header — icon + version, model, cwd (Claude Code mini style). */
export function renderMiniHeader(opts: WelcomeScreenOptions, cols = process.stdout.columns ?? 80): string {
  const pathBudget = Math.max(16, cols - MINI_ICON_WIDTH - MINI_LEFT_MARGIN.length - MINI_ICON_TEXT_GAP.length - 2);
  const textLines = [
    miniHeaderTitle(opts.version),
    miniHeaderMetaLine(opts),
    `${ansi.muted}${shortenPath(opts.cwd, pathBudget)}${ansi.reset}`,
  ];
  const iconLines = KAKO_DINO_MINI.map((row) => pink(row));
  const out: string[] = [""];
  for (let i = 0; i < textLines.length; i++) {
    out.push(
      `${MINI_LEFT_MARGIN}${padMiniIconColumn(iconLines[i] ?? "")}${MINI_ICON_TEXT_GAP}${textLines[i] ?? ""}`,
    );
  }
  return out.join("\n");
}

export function renderChatHeader(
  opts: WelcomeScreenOptions,
  mode: ChatHeaderMode,
  cols = process.stdout.columns ?? 80,
): string {
  return mode === "standard" ? renderWelcomeScreen(opts) : renderMiniHeader(opts, cols);
}

/** Below this terminal height, the standard welcome box is replaced by mini header. */
export const COMPACT_HEADER_MAX_ROWS = 32;

export function shouldUseCompactHeader(size: { rows: number; cols: number }): boolean {
  return size.rows < COMPACT_HEADER_MAX_ROWS;
}

export function resolveEffectiveHeaderMode(
  preferred: ChatHeaderMode,
  size: { rows: number; cols: number },
): ChatHeaderMode {
  if (preferred === "mini") return "mini";
  if (shouldUseCompactHeader(size)) return "mini";
  return "standard";
}

export function renderInputHint(): string {
  return renderClaudeFooter({
    placeholder: 'Try "explain this codebase"',
    shortcuts: "? for shortcuts · /help for commands",
  });
}

export function renderInitialInputFooter(): ClaudeFooterParts {
  return renderClaudeFooterParts({
    placeholder: 'Try "explain this codebase"',
    shortcuts: "? for shortcuts · click Thought to expand · drag to select · /help",
  });
}

export function renderPrompt(): string {
  return `${ansi.text}${ansi.bold}>${ansi.reset} `;
}

export function renderAssistantPrefix(): string {
  return `${ansi.text}${ansi.bold}Kako${ansi.reset}${ansi.muted} · ${ansi.reset}`;
}

export function renderToolStart(name: string, detail: string): string {
  return `\n${ansi.yellow}▶ ${name}${ansi.reset} ${ansi.muted}${detail}${ansi.reset}`;
}

export function renderToolEnd(name: string, status: string): string {
  const color = status === "success" ? ansi.green : ansi.red;
  return `${color}✓ ${name} (${status})${ansi.reset}`;
}

export function renderError(message: string): string {
  return `${ansi.red}${message}${ansi.reset}`;
}

export function renderInfo(message: string): string {
  return `${ansi.muted}${message}${ansi.reset}`;
}

export function renderSessionSwitch(sessionId: string): string {
  return `\n${ansi.green}Switched to session ${sessionId}${ansi.reset}\n`;
}

export function renderFarewell(): string {
  return `\n${ansi.muted}Session saved. See you next time.${ansi.reset}\n`;
}

export { stripAnsi, visibleLength };
