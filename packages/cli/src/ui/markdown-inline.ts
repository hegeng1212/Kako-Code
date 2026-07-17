import { ansi, displayWidth, stripAnsi } from "./ansi.js";
import {
  containingDirectory,
  isReportArtifactPath,
  OPEN_REPORT_DIR_LABEL,
  truncatePathForDisplay,
} from "./report-path.js";

export interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** File / resource path — light blue, no background. */
  path?: boolean;
  /** Count-like quantity (12+, 50%, “12 家”) — not list ordinals. */
  quantity?: boolean;
  link?: string;
  /** Clickable “打开目录” for report artifacts — value is the directory path. */
  openDir?: string;
}

export interface InlinePart {
  text: string;
  style: InlineStyle;
}

export type WrappedInlineLine = {
  text: string;
  /** Present when this wrapped line includes a report-dir open control. */
  openDir?: string;
};

function mergeParts(parts: InlinePart[]): InlinePart[] {
  const merged: InlinePart[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const prev = merged[merged.length - 1];
    if (
      prev &&
      styleKey(prev.style) === styleKey(part.style) &&
      !prev.style.code &&
      !part.style.code &&
      !prev.style.path &&
      !part.style.path &&
      !prev.style.quantity &&
      !part.style.quantity &&
      !prev.style.openDir &&
      !part.style.openDir
    ) {
      prev.text += part.text;
      continue;
    }
    merged.push({ ...part });
  }
  return merged;
}

function styleKey(style: InlineStyle): string {
  return `${style.bold ? "b" : ""}${style.italic ? "i" : ""}${style.code ? "c" : ""}${style.path ? "p" : ""}${style.quantity ? "q" : ""}${style.openDir ? `o:${style.openDir}` : ""}${style.link ?? ""}`;
}

/**
 * Absolute / home / relative file or directory paths.
 * Directories may end with `/`; files need an extension or 2+ path segments.
 */
const INLINE_PATH_RE =
  /(?:~\/[\w.\-+~/]+\/?|\/(?:Users|tmp|home|var|opt|etc|usr|private)(?:\/[\w.\-+~]+)+\/?|\/[\w.\-+~]+(?:\/[\w.\-+~]+)+(?:\/|\.\w{1,12})?|\b[\w.\-+]+(?:\/[\w.\-+]+)+(?:\/|\.\w{1,12})\b)/g;
const INLINE_COMMAND_RE =
  /\b(?:python3?|node|npm|pnpm|npx|bash|sh|cargo|rustc|go run)\s+[^\s,;。，)）]+/g;
const INLINE_EXPR_RE =
  /\b\d+(?:\.\d+)?\s*\+\s*\d+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s*=\s*\d+(?:\.\d+)?\b/g;
/**
 * Quantities / counts — not CJK/ASCII list ordinals (`1、` / leading `1.`).
 * Structural: `12+`, `50%`, or a number before a Han measure phrase (`12 家`).
 */
const INLINE_QUANTITY_RE =
  /\b\d+(?:\.\d+)?\+|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?(?=\s+\p{Script=Han})/gu;

type PlainMatchKind = "path" | "code" | "quantity";

/** Structural path shape (file or directory) — not domain-specific lists. */
export function looksLikePath(text: string): boolean {
  const trimmed = text.trim().replace(/^`+|`+$/g, "");
  if (!trimmed) return false;
  if (trimmed.startsWith("~/") || trimmed.startsWith("/")) return true;
  if (/^[\w.\-+]+(?:\/[\w.\-+]+)+\/$/.test(trimmed)) return true;
  if (/^[\w.\-+]+(?:\/[\w.\-+]+)+\.\w{1,12}$/.test(trimmed)) return true;
  // Multi-segment path without extension (package / dir references).
  if (/^[\w.\-+]+(?:\/[\w.\-+]+){2,}$/.test(trimmed)) return true;
  return /(?:^|[\s`"'(])[\w.\-+]+(?:\/[\w.\-+]+)+(?:\/|\.\w{1,12})\b/.test(` ${trimmed}`);
}

function splitPlainTextTokens(text: string): InlinePart[] {
  if (!text) return [];
  const matches: Array<{ start: number; end: number; value: string; kind: PlainMatchKind }> = [];
  const patterns: Array<{ re: RegExp; kind: PlainMatchKind }> = [
    { re: INLINE_PATH_RE, kind: "path" },
    // Arithmetic before quantities so "23 + 47" is not split by Han-lookahead counts.
    { re: INLINE_EXPR_RE, kind: "code" },
    { re: INLINE_QUANTITY_RE, kind: "quantity" },
    { re: INLINE_COMMAND_RE, kind: "code" },
  ];

  for (const { re, kind } of patterns) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const value = match[0];
      if (!value) continue;
      const start = match.index ?? 0;
      const end = start + value.length;
      const overlaps = matches.some((m) => start < m.end && end > m.start);
      if (!overlaps) matches.push({ start, end, value, kind });
    }
  }

  matches.sort((a, b) => a.start - b.start);
  const parts: InlinePart[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      parts.push({ text: text.slice(cursor, match.start), style: {} });
    }
    const style: InlineStyle =
      match.kind === "path"
        ? { path: true }
        : match.kind === "quantity"
          ? { quantity: true }
          : { code: true };
    parts.push({ text: match.value, style });
    cursor = match.end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), style: {} });
  }
  return parts.length ? parts : [{ text, style: {} }];
}

/** Mid-word `_x_` / `*x*` is not emphasis (paths like open_api/… must stay intact). */
function canOpenEmphasis(input: string, index: number, marker: string): boolean {
  if (input[index] !== marker) return false;
  const prev = index > 0 ? input[index - 1]! : "";
  if (/[\w]/.test(prev)) return false;
  return true;
}

/**
 * Next index that can start a markdown inline construct.
 * Mid-word `_` / `*` (e.g. ai_memory, factory.go neighbors) must not split the scan,
 * or path highlighting only paints the suffix (looks like `.go` is a separate color).
 */
function findNextInlineSpecial(input: string, from: number): number {
  for (let i = from; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "`" || ch === "[") return i;
    if ((ch === "*" || ch === "_") && canOpenEmphasis(input, i, ch)) return i;
  }
  return -1;
}

/** Parse inline markdown into styled text segments. */
export function parseInlineParts(input: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let index = 0;

  while (index < input.length) {
    const rest = input.slice(index);

    const codeMatch = /^`([^`]+)`/.exec(rest);
    if (codeMatch) {
      const body = codeMatch[1]!;
      parts.push({
        text: body,
        style: looksLikePath(body) ? { path: true } : { code: true },
      });
      index += codeMatch[0].length;
      continue;
    }

    const boldMatch = /^\*\*(.+?)\*\*/.exec(rest);
    if (boldMatch) {
      parts.push({ text: boldMatch[1]!, style: { bold: true } });
      index += boldMatch[0].length;
      continue;
    }

    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
    if (linkMatch) {
      parts.push({ text: linkMatch[1]!, style: { link: linkMatch[2]! } });
      index += linkMatch[0].length;
      continue;
    }

    if (canOpenEmphasis(input, index, "*")) {
      const italicMatch = /^\*([^*]+)\*/.exec(rest);
      if (italicMatch) {
        parts.push({ text: italicMatch[1]!, style: { italic: true } });
        index += italicMatch[0].length;
        continue;
      }
    }

    if (canOpenEmphasis(input, index, "_")) {
      const underlineMatch = /^_([^_]+)_/.exec(rest);
      if (underlineMatch) {
        parts.push({ text: underlineMatch[1]!, style: { italic: true } });
        index += underlineMatch[0].length;
        continue;
      }
    }

    const nextSpecial = findNextInlineSpecial(input, index + 1);
    const end = nextSpecial === -1 ? rest.length : nextSpecial - index;
    parts.push(...splitPlainTextTokens(rest.slice(0, end)));
    index += end;
  }

  return mergeParts(parts);
}

export function renderInlinePart(part: InlinePart): string {
  // File / folder paths — light cyan/blue (distinct from inline code).
  if (part.style.path) {
    return `${ansi.blue}${part.text}${ansi.reset}`;
  }
  if (part.style.openDir) {
    return `${ansi.accent}${part.text}${ansi.reset}`;
  }
  // Quantities / counts — warm yellow (distinct from white ordinals).
  if (part.style.quantity) {
    return `${ansi.yellow}${part.text}${ansi.reset}`;
  }
  // Inline `code` — soft yellow (not the same as paths).
  if (part.style.code) {
    return `${ansi.yellow}${part.text}${ansi.reset}`;
  }
  if (part.style.link) {
    return `${ansi.accent}${part.text}${ansi.reset}${ansi.muted} (${part.style.link})${ansi.reset}`;
  }
  if (part.style.bold && part.style.italic) {
    return `${ansi.bold}${ansi.italic}${part.text}${ansi.reset}`;
  }
  if (part.style.bold) {
    return `${ansi.bold}${part.text}${ansi.reset}`;
  }
  if (part.style.italic) {
    return `${ansi.italic}${part.text}${ansi.reset}`;
  }
  return part.text;
}

export function renderInlineMarkdown(input: string): string {
  return parseInlineParts(input).map(renderInlinePart).join("");
}

function splitWords(text: string): string[] {
  if (!text) return [];
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/**
 * Report artifacts: truncate long paths and append a blue 「打开目录」 control.
 * Code paths stay unchanged (no open-dir affordance).
 */
export function expandReportArtifactParts(parts: InlinePart[], width: number): InlinePart[] {
  const out: InlinePart[] = [];
  for (const part of parts) {
    if (!part.style.path || !isReportArtifactPath(part.text)) {
      out.push(part);
      continue;
    }
    const fullPath = part.text.trim().replace(/^`+|`+$/g, "");
    const dir = containingDirectory(fullPath);
    const gap = " ";
    const linkBudget = displayWidth(gap) + displayWidth(OPEN_REPORT_DIR_LABEL);
    const maxPathWidth =
      width > linkBudget + 4 ? Math.max(8, width - linkBudget) : Math.max(8, width);
    const shown = truncatePathForDisplay(fullPath, maxPathWidth);
    out.push({ text: shown, style: { path: true } });
    out.push({ text: `${gap}${OPEN_REPORT_DIR_LABEL}`, style: { openDir: dir } });
  }
  return out;
}

/** Word-wrap inline parts to terminal width, preserving styles. */
export function wrapInlinePartsDetailed(
  parts: InlinePart[],
  width: number,
  renderPart: (part: InlinePart) => string = renderInlinePart,
): WrappedInlineLine[] {
  const expanded = expandReportArtifactParts(parts, width);
  if (width < 1) {
    const openDir = expanded.find((p) => p.style.openDir)?.style.openDir;
    return [{ text: expanded.map(renderPart).join(""), openDir }];
  }

  const lines: InlinePart[][] = [[]];
  let lineWidth = 0;

  const pushPart = (part: InlinePart, leadingSpace = false): void => {
    const rendered = renderPart(part);
    const partWidth = displayWidth(stripAnsi(rendered));
    let needsSpace = leadingSpace;

    if (lineWidth + (needsSpace ? 1 : 0) + partWidth > width && lineWidth > 0) {
      lines.push([]);
      lineWidth = 0;
      needsSpace = false;
    }

    if (needsSpace && lineWidth > 0) {
      const currentLine = lines[lines.length - 1]!;
      const lastPart = currentLine[currentLine.length - 1];
      if (
        lastPart &&
        !lastPart.style.code &&
        !part.style.code &&
        !lastPart.style.path &&
        !part.style.path &&
        !lastPart.style.quantity &&
        !part.style.quantity &&
        !lastPart.style.openDir &&
        !part.style.openDir
      ) {
        lastPart.text += " ";
        lineWidth += 1;
      }
    }

    const currentLine = lines[lines.length - 1]!;
    const prev = currentLine[currentLine.length - 1];
    if (prev && styleKey(prev.style) === styleKey(part.style)) {
      prev.text += part.text;
    } else {
      currentLine.push({ ...part });
    }
    lineWidth += partWidth;
  };

  for (const part of expanded) {
    if (part.style.code || part.style.path || part.style.quantity || part.style.openDir) {
      pushPart(part);
      continue;
    }

    const words = splitWords(part.text);
    for (const word of words) {
      if (/^\s+$/.test(word)) continue;
      pushPart({ text: word, style: part.style }, lineWidth > 0);
    }
  }

  return lines.map((lineParts) => ({
    text: lineParts.map(renderPart).join(""),
    openDir: lineParts.find((p) => p.style.openDir)?.style.openDir,
  }));
}

export function wrapInlineParts(
  parts: InlinePart[],
  width: number,
  renderPart: (part: InlinePart) => string = renderInlinePart,
): string[] {
  return wrapInlinePartsDetailed(parts, width, renderPart).map((line) => line.text);
}

export function wrapMarkdownParagraph(text: string, width: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return wrapInlineParts(parseInlineParts(trimmed), width);
}
