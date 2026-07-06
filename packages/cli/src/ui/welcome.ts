import { homedir } from "node:os";
import { basename } from "node:path";
import {
  ansi,
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
import { KAKO_DINO } from "./mascot.js";

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
