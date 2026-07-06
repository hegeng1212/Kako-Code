import { ansi } from "./ansi.js";
import { parseMarkdownBlocks, type MarkdownBlock } from "./markdown-blocks.js";
import { parseInlineParts, wrapInlineParts } from "./markdown-inline.js";
import { renderTableLines } from "./markdown-table.js";

function gapBefore(lines: string[]): void {
  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
}

function renderHeading(text: string, level: number, width: number): string[] {
  const content = wrapInlineParts(parseInlineParts(text), width);
  if (level === 1) {
    return content.map((line) => `${ansi.accentBold}${line}${ansi.reset}`);
  }
  if (level === 2) {
    return content.map((line) => `${ansi.accent}${ansi.bold}${line}${ansi.reset}`);
  }
  return content.map((line) => `${ansi.bold}${line}${ansi.reset}`);
}

function renderCodeBlock(lines: string[], width: number): string[] {
  const innerWidth = Math.max(20, width - 4);
  const out: string[] = [];
  gapBefore(out);

  for (const line of lines) {
    const content = line.length > innerWidth ? line.slice(0, innerWidth) : line;
    out.push(
      `${ansi.line}│${ansi.reset} ${ansi.line}\x1b[48;5;236m${ansi.text} ${content.padEnd(innerWidth)} ${ansi.reset}`,
    );
  }

  if (lines.length === 0) {
    out.push(`${ansi.line}│${ansi.reset} ${ansi.muted}(empty)${ansi.reset}`);
  }

  return out;
}

function renderBlockquote(lines: string[], width: number): string[] {
  const prefix = `${ansi.line}▏${ansi.reset} `;
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

function renderList(items: string[], width: number, ordered: boolean): string[] {
  const out: string[] = [];
  const indent = "  ";
  const innerWidth = Math.max(10, width - indent.length - 4);

  items.forEach((item, index) => {
    const marker = ordered ? `${index + 1}.` : "•";
    const prefix = `${indent}${ansi.muted}${marker}${ansi.reset} `;
    const wrapped = wrapInlineParts(parseInlineParts(item), innerWidth);
    wrapped.forEach((line, lineIndex) => {
      out.push(lineIndex === 0 ? `${prefix}${line}` : `${indent}   ${line}`);
    });
    if (index < items.length - 1) {
      out.push("");
    }
  });

  return out;
}

function renderHorizontalRule(width: number): string[] {
  const ruleWidth = Math.min(Math.max(20, width), 48);
  return [`${ansi.line}${"─".repeat(ruleWidth)}${ansi.reset}`];
}

function renderParagraph(text: string, width: number): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];

  for (const paragraph of paragraphs) {
    const chunks = paragraph.split("\n");
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      out.push(...wrapInlineParts(parseInlineParts(trimmed), width));
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
      return renderList(block.items, width, true);
    case "code":
      return renderCodeBlock(block.lines, width);
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
    if (block.type === "table" || block.type === "code" || block.type === "hr") {
      gapBefore(lines);
    }

    lines.push(...renderBlock(block, wrapWidth));

    if (block.type === "table" || block.type === "code" || block.type === "heading") {
      lines.push("");
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.length ? lines : [""];
}
