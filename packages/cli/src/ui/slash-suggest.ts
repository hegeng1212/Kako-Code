import type { SystemSkillEntry } from "@kako/core";
import { ansi, displayWidth, visibleLength } from "./ansi.js";
import { wrapContentLines } from "./text-wrap.js";

export const SLASH_SUGGEST_HINT = `${ansi.muted}↑/↓ select · Tab complete · Enter submit${ansi.reset}`;

/** Selected slash command name — cyan, Claude Code slash menu. */
const SLASH_CMD_SELECTED = `${ansi.planBorder}${ansi.bold}`;
const SLASH_CMD_UNSELECTED = ansi.muted;
const SLASH_DESC_SELECTED = ansi.text;
const SLASH_DESC_UNSELECTED = ansi.muted;

/** Input line: slash command token uses the same cyan as the suggest menu. */
export function renderSlashInputText(value: string): string {
  if (!value.startsWith("/")) {
    return `${ansi.text}${value}${ansi.reset}`;
  }
  const spaceIdx = value.indexOf(" ");
  if (spaceIdx === -1) {
    return `${SLASH_CMD_SELECTED}${value}${ansi.reset}`;
  }
  const command = value.slice(0, spaceIdx);
  const args = value.slice(spaceIdx);
  return `${SLASH_CMD_SELECTED}${command}${ansi.reset}${ansi.text}${args}${ansi.reset}`;
}

function padPlain(text: string, width: number): string {
  const len = displayWidth(text);
  if (len >= width) return text;
  return text + " ".repeat(width - len);
}

export function slashSuggestCommandWidth(cols: number): number {
  return Math.min(28, Math.max(20, Math.floor(cols * 0.26)));
}

export function filterSlashSuggestions(
  query: string,
  skills: SystemSkillEntry[],
): SystemSkillEntry[] {
  const needle = query.toLowerCase();
  return skills.filter((skill) => skill.name.toLowerCase().startsWith(needle));
}

export interface RenderSlashSuggestOptions {
  skills: SystemSkillEntry[];
  selectedIndex: number;
  cols: number;
  /** Max skill entries in the scroll window (each may wrap to multiple lines). */
  maxVisible?: number;
}

function formatDescription(entry: SystemSkillEntry): string {
  const tag = entry.tag ? `[${entry.tag}] ` : "";
  return `${tag}${entry.description}`;
}

function renderSlashSuggestEntry(
  entry: SystemSkillEntry,
  selected: boolean,
  cols: number,
): string[] {
  const cmdWidth = slashSuggestCommandWidth(cols);
  const descWidth = Math.max(10, cols - cmdWidth - 1);
  const command = `/${entry.name}`;
  const descLines = wrapContentLines(formatDescription(entry), descWidth);

  const cmdOpen = selected ? SLASH_CMD_SELECTED : SLASH_CMD_UNSELECTED;
  const descOpen = selected ? SLASH_DESC_SELECTED : SLASH_DESC_UNSELECTED;
  const indent = " ".repeat(cmdWidth + 1);

  if (!descLines.length) {
    return [`${cmdOpen}${padPlain(command, cmdWidth)}${ansi.reset}`];
  }

  return descLines.map((desc, index) => {
    if (index === 0) {
      return `${cmdOpen}${padPlain(command, cmdWidth)}${ansi.reset} ${descOpen}${desc}${ansi.reset}`;
    }
    return `${indent}${descOpen}${desc}${ansi.reset}`;
  });
}

/** Flattened panel lines for the slash-skill menu (excludes separators and hint). */
export function renderSlashSuggestLines(opts: RenderSlashSuggestOptions): string[] {
  const { skills, selectedIndex, cols, maxVisible = 4 } = opts;
  if (!skills.length) return [];

  const start = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(maxVisible / 2), skills.length - maxVisible),
  );
  const window = skills.slice(start, start + maxVisible);
  const windowSelected = selectedIndex - start;

  const lines: string[] = [];
  window.forEach((entry, index) => {
    lines.push(...renderSlashSuggestEntry(entry, index === windowSelected, cols));
  });
  return lines;
}

export function slashSuggestPanelRowCount(opts: RenderSlashSuggestOptions): number {
  if (!opts.skills.length) return 0;
  return renderSlashSuggestLines(opts).length + 2;
}

export function slashSuggestFooterHeight(
  opts: RenderSlashSuggestOptions,
  inputFooterHeight = 4,
): number {
  const panelRows = slashSuggestPanelRowCount(opts);
  return panelRows > 0 ? panelRows + inputFooterHeight : inputFooterHeight;
}

/** Fit slash menu rows within a footer budget — shrinks maxVisible before overlapping header. */
export function planSlashSuggestFooter(
  opts: RenderSlashSuggestOptions & { maxHeight: number; inputFooterHeight?: number },
): { lines: string[]; height: number; maxVisible: number } {
  const inputFooterHeight = opts.inputFooterHeight ?? 4;
  const maxFooter = opts.maxHeight;
  if (!opts.skills.length) {
    return { lines: [], height: inputFooterHeight, maxVisible: 0 };
  }
  let maxVisible = opts.maxVisible ?? 4;
  while (maxVisible >= 1) {
    const lines = renderSlashSuggestLines({ ...opts, maxVisible });
    const height = lines.length + 2 + inputFooterHeight;
    if (height <= maxFooter) {
      return { lines, height, maxVisible };
    }
    maxVisible--;
  }
  return { lines: [], height: inputFooterHeight, maxVisible: 0 };
}

function slashArgsSuffix(currentInput: string): string {
  const trimmed = currentInput.trimStart();
  const spaceIdx = trimmed.indexOf(" ");
  return spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
}

/** Tab completion keeps a trailing space so the user can type args. */
export function completeSlashSuggestion(
  currentInput: string,
  entry: SystemSkillEntry,
): string {
  const args = slashArgsSuffix(currentInput);
  return args ? `/${entry.name} ${args}` : `/${entry.name} `;
}

/** Value to submit on Enter while the slash menu is open. */
export function resolveSlashSubmitValue(
  currentInput: string,
  suggestions: SystemSkillEntry[],
  selectedIndex: number,
): string {
  if (!suggestions.length) return currentInput.trim();
  const entry = suggestions[selectedIndex] ?? suggestions[0]!;
  const args = slashArgsSuffix(currentInput);
  return args ? `/${entry.name} ${args}` : `/${entry.name}`;
}

/** True when the cursor is editing the slash command token (before the first space). */
export function isEditingSlashCommand(input: string, cursor: number): boolean {
  if (!input.startsWith("/")) return false;
  const spaceIdx = input.indexOf(" ");
  return spaceIdx === -1 || cursor <= spaceIdx;
}

export function slashSuggestQuery(input: string, cursor: number): string | null {
  if (!isEditingSlashCommand(input, cursor)) return null;
  const body = input.slice(1);
  const spaceIdx = body.indexOf(" ");
  return spaceIdx === -1 ? body : body.slice(0, spaceIdx);
}

/** Whether the slash menu should stay open for the current input. */
export function shouldShowSlashMenu(input: string, cursor: number): boolean {
  if (!input.startsWith("/")) return false;
  return isEditingSlashCommand(input, cursor);
}
