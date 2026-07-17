/** ANSI styling — Claude Code palette with light/dark terminal adaptation. */

import {
  applyThemePalette,
  detectTerminalTheme,
  getTerminalTheme,
  type TerminalTheme,
} from "./terminal-theme.js";

export const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  /** Coral/salmon border & section headers (Claude Code). */
  accent: "\x1b[38;5;210m",
  accentBold: "\x1b[1;38;5;210m",
  /** Primary body text. */
  text: "\x1b[38;5;255m",
  /** Secondary metadata. */
  muted: "\x1b[38;5;245m",
  /** Placeholder / hint text. */
  placeholder: "\x1b[38;5;243m",
  /** Input box border — bright white like Claude Code. */
  inputBorder: "\x1b[38;5;255m",
  /** Footer separator lines (non-input panels). */
  line: "\x1b[38;5;238m",
  /** Table box-drawing borders. */
  tableBorder: "\x1b[38;5;255m",
  /** Plan box border (cyan, Claude Code plan mode). */
  planBorder: "\x1b[38;5;117m",
  green: "\x1b[38;5;114m",
  /** Diff add gutter on green background — softer than neon, still above bg. */
  diffAdd: "\x1b[38;5;77m",
  yellow: "\x1b[38;5;221m",
  red: "\x1b[38;5;203m",
  /** Diff remove gutter on red background — softer than neon, still above bg. */
  diffRemove: "\x1b[38;5;203m",
  blue: "\x1b[38;5;117m",
  magenta: "\x1b[38;5;176m",
  /** User message bar in chat history — full-width strip. */
  userMessageBg: "\x1b[48;5;235m",
  /** Inline / block code background. */
  codeBg: "\x1b[48;5;236m",
  /** Selected text in the input box. */
  selectionBg: "\x1b[48;5;67m",
};

export function initTerminalTheme(theme?: TerminalTheme): TerminalTheme {
  const resolved = theme ?? detectTerminalTheme();
  applyThemePalette(ansi, resolved);
  return resolved;
}

export { getTerminalTheme, type TerminalTheme };

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Terminal display columns — wide chars (CJK etc.) count as 2. */
export function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fffd) ||
    (code >= 0x30000 && code <= 0x3fffd)
  );
}

/** Emoji and symbol pictographs — most terminals render these as width 2. */
export function isEmojiWideCodePoint(code: number): boolean {
  if (code === 0xfe0f || code === 0x200d) return false;
  return (
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x2600 && code <= 0x27bf) ||
    (code >= 0x2300 && code <= 0x23ff) ||
    (code >= 0x2b50 && code <= 0x2b55)
  );
}

export function charDisplayWidth(code: number): number {
  if (code === 0xfe0f || code === 0x200d) return 0;
  // Dingbat status marks — single column in common terminals (iTerm, VS Code, etc.)
  if (code === 0x2713 || code === 0x2714 || code === 0x2717 || code === 0x2718) return 1;
  // Eight-pointed black star (recap status) — keep aligned with ASCII `*` done lines.
  if (code === 0x2734) return 1;
  if (isWideCodePoint(code) || isEmojiWideCodePoint(code)) return 2;
  return 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of stripAnsi(text)) {
    width += charDisplayWidth(char.codePointAt(0)!);
  }
  return width;
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function pink(text: string): string {
  return `${ansi.accent}${text}${ansi.reset}`;
}

export function pinkBold(text: string): string {
  return `${ansi.accentBold}${text}${ansi.reset}`;
}
