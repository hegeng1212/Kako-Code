import { ansi, displayWidth } from "./ansi.js";
import { realignAsciiArtLines } from "./markdown-ascii-art.js";
import { parseMarkdownBlocks, type MarkdownBlock } from "./markdown-blocks.js";
import { clipToDisplayWidth, highlightCodeLine } from "./markdown-code-highlight.js";
import { parseInlineParts, wrapInlineParts } from "./markdown-inline.js";
import { renderTableLines } from "./markdown-table.js";

function gapBefore(lines: string[]): void {
  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
}

function renderHeading(text: string, _level: number, width: number): string[] {
  const content = wrapInlineParts(parseInlineParts(text), width);
  // All heading levels: white bold (not coral/red accent).
  return content.map((line) => `${ansi.bold}${ansi.text}${line}${ansi.reset}`);
}

/** Fenced code — syntax colors, no left gutter bar, no background strip. */
function renderCodeBlock(lines: string[], width: number, language?: string): string[] {
  const innerWidth = Math.max(20, width);
  const out: string[] = [];
  gapBefore(out);
  const source = realignAsciiArtLines(lines);

  for (const line of source) {
    const clipped = clipToDisplayWidth(line, innerWidth);
    const highlighted = highlightCodeLine(clipped, language);
    const pad = Math.max(0, innerWidth - displayWidth(clipped));
    out.push(`${highlighted}${" ".repeat(pad)}`);
  }

  if (source.length === 0) {
    out.push(`${ansi.muted}(empty)${ansi.reset}`);
  }

  return out;
}

/** Unfenced ASCII / box diagrams — preserve spaces; align right borders. */
function renderPreBlock(lines: string[], width: number): string[] {
  const innerWidth = Math.max(20, width);
  const out: string[] = [];
  gapBefore(out);
  for (const line of realignAsciiArtLines(lines)) {
    const clipped = clipToDisplayWidth(line, innerWidth);
    out.push(`${ansi.text}${clipped}${ansi.reset}`);
  }
  return out;
}

function renderBlockquote(lines: string[], width: number): string[] {
  // Soft quote marker (not a heavy black bar).
  const prefix = `${ansi.muted}▎${ansi.reset} `;
  const innerWidth = Math.max(10, width - 2);
  const out: string[] = [];

  for (const line of lines) {
    const wrapped = wrapInlineParts(parseInlineParts(line), innerWidth);
    for (const wrappedLine of wrapped) {
      out.push(`${prefix}${ansi.muted}${wrappedLine}${ansi.reset}`);
    }
  }

  return out;
}

function renderList(
  items: string[],
  width: number,
  ordered: boolean,
  connectors?: readonly string[],
): string[] {
  const out: string[] = [];
  const indent = "  ";
  const innerWidth = Math.max(10, width - indent.length - 4);

  items.forEach((item, index) => {
    const marker = ordered ? `${index + 1}.` : "•";
    // Ordinals / bullets stay white; quantity tokens inside the item use inline colors.
    const prefix = `${indent}${ansi.text}${marker}${ansi.reset} `;
    const wrapped = wrapInlineParts(parseInlineParts(item), innerWidth);
    wrapped.forEach((line, lineIndex) => {
      out.push(lineIndex === 0 ? `${prefix}${line}` : `${indent}   ${line}`);
    });
    if (index < items.length - 1) {
      const connector = connectors?.[index];
      if (connector) {
        out.push(`${indent}  ${ansi.text}${connector}${ansi.reset}`);
      }
      out.push("");
    }
  });

  return out;
}

function renderHorizontalRule(width: number): string[] {
  const ruleWidth = Math.min(Math.max(20, width), 48);
  return [`${ansi.muted}${"─".repeat(ruleWidth)}${ansi.reset}`];
}

function renderParagraphLine(text: string, width: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const ordinal = /^(\d+\.)(\s+)(.*)$/.exec(trimmed);
  if (ordinal) {
    const prefix = `${ansi.text}${ordinal[1]}${ansi.reset}${ordinal[2]}`;
    const wrapped = wrapInlineParts(parseInlineParts(ordinal[3]!), width);
    return wrapped.map((line, lineIndex) => (lineIndex === 0 ? `${prefix}${line}` : line));
  }
  return wrapInlineParts(parseInlineParts(trimmed), width);
}

function renderParagraph(text: string, width: number): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];

  for (const paragraph of paragraphs) {
    const chunks = paragraph.split("\n");
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      out.push(...renderParagraphLine(trimmed, width));
      out.push("");
    }
    if (paragraph !== paragraphs[paragraphs.length - 1]) {
      out.push("");
    }
  }

  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
  }

  return out;
}

function renderBlock(block: MarkdownBlock, width: number): string[] {
  switch (block.type) {
    case "paragraph":
      return renderParagraph(block.text, width);
    case "heading":
      return renderHeading(block.text, block.level, width);
    case "ul":
      return renderList(block.items, width, false);
    case "ol":
      return renderList(block.items, width, true, block.connectors);
    case "code":
      return renderCodeBlock(block.lines, width, block.language);
    case "pre":
      return renderPreBlock(block.lines, width);
    case "blockquote":
      return renderBlockquote(block.lines, width);
    case "hr":
      return renderHorizontalRule(width);
    case "table":
      return renderTableLines(block.table, width);
  }
}

/** Render markdown-rich assistant content for the terminal. */
export function renderRichContentLines(text: string, width: number): string[] {
  const wrapWidth = Math.max(20, width);
  const trimmed = text.trim();
  if (!trimmed) return [""];

  const blocks = parseMarkdownBlocks(trimmed);
  const lines: string[] = [];

  for (const block of blocks) {
    if (
      block.type === "table" ||
      block.type === "code" ||
      block.type === "pre" ||
      block.type === "hr"
    ) {
      gapBefore(lines);
    }

    lines.push(...renderBlock(block, wrapWidth));

    if (
      block.type === "table" ||
      block.type === "code" ||
      block.type === "pre" ||
      block.type === "heading"
    ) {
      lines.push("");
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.length ? lines : [""];
}
