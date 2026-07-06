import { ansi, displayWidth, stripAnsi } from "./ansi.js";

export interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

export interface InlinePart {
  text: string;
  style: InlineStyle;
}

function mergeParts(parts: InlinePart[]): InlinePart[] {
  const merged: InlinePart[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const prev = merged[merged.length - 1];
    if (
      prev &&
      styleKey(prev.style) === styleKey(part.style) &&
      !prev.style.code &&
      !part.style.code
    ) {
      prev.text += part.text;
      continue;
    }
    merged.push({ ...part });
  }
  return merged;
}

function styleKey(style: InlineStyle): string {
  return `${style.bold ? "b" : ""}${style.italic ? "i" : ""}${style.code ? "c" : ""}${style.link ?? ""}`;
}

/** Parse inline markdown into styled text segments. */
export function parseInlineParts(input: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let index = 0;

  while (index < input.length) {
    const rest = input.slice(index);

    const codeMatch = /^`([^`]+)`/.exec(rest);
    if (codeMatch) {
      parts.push({ text: codeMatch[1]!, style: { code: true } });
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

    const italicMatch = /^\*([^*]+)\*/.exec(rest);
    if (italicMatch) {
      parts.push({ text: italicMatch[1]!, style: { italic: true } });
      index += italicMatch[0].length;
      continue;
    }

    const underlineMatch = /^_([^_]+)_/.exec(rest);
    if (underlineMatch) {
      parts.push({ text: underlineMatch[1]!, style: { italic: true } });
      index += underlineMatch[0].length;
      continue;
    }

    const nextSpecial = rest.slice(1).search(/[`[*_]/);
    const end = nextSpecial === -1 ? rest.length : nextSpecial + 1;
    parts.push({ text: rest.slice(0, end), style: {} });
    index += end;
  }

  return mergeParts(parts);
}

export function renderInlinePart(part: InlinePart): string {
  if (part.style.code) {
    return `${ansi.line}\x1b[48;5;236m${ansi.text} ${part.text} ${ansi.reset}`;
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

/** Word-wrap inline parts to terminal width, preserving styles. */
export function wrapInlineParts(parts: InlinePart[], width: number): string[] {
  if (width < 1) {
    return [parts.map(renderInlinePart).join("")];
  }

  const lines: InlinePart[][] = [[]];
  let lineWidth = 0;

  const pushPart = (part: InlinePart, leadingSpace = false): void => {
    const rendered = renderInlinePart(part);
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
      if (lastPart && !lastPart.style.code && !part.style.code) {
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

  for (const part of parts) {
    if (part.style.code) {
      pushPart(part);
      continue;
    }

    const words = splitWords(part.text);
    for (const word of words) {
      if (/^\s+$/.test(word)) continue;
      pushPart({ text: word, style: part.style }, lineWidth > 0);
    }
  }

  return lines.map((lineParts) => lineParts.map(renderInlinePart).join(""));
}

export function wrapMarkdownParagraph(text: string, width: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return wrapInlineParts(parseInlineParts(trimmed), width);
}
