import { displayWidth } from "./ansi.js";

const HORIZONTAL_FILL = /[─═━_=\-]/;

/**
 * Lines that should be treated as preformatted ASCII / box diagrams.
 * Must not go through word-wrap (which collapses spaces and breaks right borders).
 */
export function looksLikeAsciiArtLine(line: string): boolean {
  const t = line.trimEnd();
  if (!t.trim()) return false;
  if (/[┌┬┐├┼┤└┴┘│─━┃╔╗╚╝╠╣╬═]/.test(t)) return true;
  // Content / border rows: | … |
  if (/^\s*\|.*\|\s*$/.test(t)) return true;
  // Top/bottom rules commonly used for ASCII boxes (longer than markdown HR).
  if (/^\s*[_=-]{6,}\s*$/.test(t)) return true;
  // Simple connectors between stacked boxes.
  if (/^\s*(?:\|+|v|V|\^|↓|▼)\s*$/.test(t)) return true;
  return false;
}

/** Flow connector between stacked diagram / list steps (not a paragraph). */
export function isListConnectorLine(raw: string): boolean {
  return /^\s*(?:\|+|v|V|\^|↓|▼)\s*$/.test(raw);
}

function isConnectorLine(raw: string): boolean {
  return isListConnectorLine(raw);
}

function padInnerToWidth(
  indent: string,
  left: string,
  inner: string,
  right: string,
  targetWidth: number,
): string {
  const prefix = `${indent}${left}`;
  const innerTarget = targetWidth - displayWidth(prefix) - displayWidth(right);
  if (innerTarget < 1) return `${prefix}${inner}${right}`;
  const innerW = displayWidth(inner);
  if (innerW >= innerTarget) return `${prefix}${inner}${right}`;
  return `${prefix}${inner}${" ".repeat(innerTarget - innerW)}${right}`;
}

function padHorizontalToWidth(
  indent: string,
  left: string,
  fillChar: string,
  right: string,
  targetWidth: number,
): string {
  const prefix = `${indent}${left}`;
  const fillTarget = targetWidth - displayWidth(prefix) - displayWidth(right);
  if (fillTarget < 1) return `${prefix}${right}`;
  return `${prefix}${fillChar.repeat(fillTarget)}${right}`;
}

/**
 * Pad ASCII / Unicode box rows so the right border shares one display column.
 * Fixes CJK double-width drift when the model padded by character count.
 */
export function realignAsciiArtLines(lines: readonly string[]): string[] {
  const artCount = lines.filter((l) => looksLikeAsciiArtLine(l)).length;
  if (artCount < 2) return [...lines];

  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, displayWidth(line.trimEnd()));
  }
  if (maxWidth < 4) return [...lines];

  return lines.map((line) => {
    const raw = line.trimEnd();
    if (!raw.trim() || isConnectorLine(raw)) return raw;

    const vertical = /^(\s*)([│|┃║])(.*)([│|┃║])\s*$/.exec(raw);
    if (vertical) {
      return padInnerToWidth(
        vertical[1]!,
        vertical[2]!,
        vertical[3]!,
        vertical[4]!,
        maxWidth,
      );
    }

    const asciiPipe = /^(\s*)\|(.*)\|\s*$/.exec(raw);
    if (asciiPipe) {
      return padInnerToWidth(asciiPipe[1]!, "|", asciiPipe[2]!, "|", maxWidth);
    }

    const horizontal = /^(\s*)([┌└├╔╠╚])([─═━_=\-]+)([┐┘┤╝╣╗])\s*$/.exec(raw);
    if (horizontal) {
      const fillChar = horizontal[3]!.match(HORIZONTAL_FILL)?.[0] ?? "─";
      return padHorizontalToWidth(
        horizontal[1]!,
        horizontal[2]!,
        fillChar,
        horizontal[4]!,
        maxWidth,
      );
    }

    const rule = /^(\s*)([_=-]+)\s*$/.exec(raw);
    if (rule) {
      const indent = rule[1]!;
      const fillChar = rule[2]![0]!;
      const fillW = Math.max(1, maxWidth - displayWidth(indent));
      return `${indent}${fillChar.repeat(fillW)}`;
    }

    return raw;
  });
}
