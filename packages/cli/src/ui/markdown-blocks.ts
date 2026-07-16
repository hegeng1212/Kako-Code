import { isListConnectorLine, looksLikeAsciiArtLine } from "./markdown-ascii-art.js";
import { extractMarkdownTable, type ParsedTable } from "./markdown-table.js";

export type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[]; connectors?: string[] }
  | { type: "code"; language?: string; lines: string[] }
  /** Preformatted ASCII / box diagrams — spaces and borders preserved. */
  | { type: "pre"; lines: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "hr" }
  | { type: "table"; table: ParsedTable };

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function headingMatch(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
  if (!match) return null;
  return { level: match[1]!.length, text: match[2]!.trim() };
}

function unorderedMatch(line: string): string | null {
  const match = /^[-*+]\s+(.+)$/.exec(line.trim());
  return match?.[1]?.trim() ?? null;
}

function orderedMatch(line: string): string | null {
  const match = /^\d+\.\s+(.+)$/.exec(line.trim());
  return match?.[1]?.trim() ?? null;
}

function blockquoteMatch(line: string): string | null {
  const match = /^>\s?(.*)$/.exec(line);
  return match ? match[1]! : null;
}

function isHorizontalRule(line: string): boolean {
  const trimmed = line.trim();
  return /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed);
}

function flushParagraph(buffer: string[], blocks: MarkdownBlock[]): void {
  if (buffer.length === 0) return;
  blocks.push({ type: "paragraph", text: buffer.join("\n") });
  buffer.length = 0;
}

/** Split markdown source into renderable blocks. */
export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  const paragraphBuffer: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (isBlank(line)) {
      flushParagraph(paragraphBuffer, blocks);
      index++;
      continue;
    }

    const table = extractMarkdownTable(lines, index);
    if (table) {
      flushParagraph(paragraphBuffer, blocks);
      blocks.push({ type: "table", table: table.table });
      index += table.linesConsumed;
      continue;
    }

    if (line.trim().startsWith("```")) {
      flushParagraph(paragraphBuffer, blocks);
      const language = line.trim().slice(3).trim() || undefined;
      const codeLines: string[] = [];
      index++;
      while (index < lines.length && !lines[index]!.trim().startsWith("```")) {
        codeLines.push(lines[index]!);
        index++;
      }
      if (index < lines.length) index++;
      blocks.push({ type: "code", language, lines: codeLines });
      continue;
    }

    const heading = headingMatch(line);
    if (heading) {
      flushParagraph(paragraphBuffer, blocks);
      blocks.push({ type: "heading", level: heading.level, text: heading.text });
      index++;
      continue;
    }

    // ASCII boxes before HR — underscore tops must not become thematic breaks.
    if (looksLikeAsciiArtLine(line)) {
      flushParagraph(paragraphBuffer, blocks);
      const artLines: string[] = [];
      while (index < lines.length && looksLikeAsciiArtLine(lines[index]!)) {
        artLines.push(lines[index]!);
        index++;
      }
      blocks.push({ type: "pre", lines: artLines });
      continue;
    }

    if (isHorizontalRule(line)) {
      flushParagraph(paragraphBuffer, blocks);
      blocks.push({ type: "hr" });
      index++;
      continue;
    }

    const quote = blockquoteMatch(line);
    if (quote !== null) {
      flushParagraph(paragraphBuffer, blocks);
      const quoteLines: string[] = [quote];
      index++;
      while (index < lines.length) {
        const nextQuote = blockquoteMatch(lines[index]!);
        if (nextQuote === null) break;
        quoteLines.push(nextQuote);
        index++;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    const unordered = unorderedMatch(line);
    if (unordered !== null) {
      flushParagraph(paragraphBuffer, blocks);
      const items: string[] = [unordered];
      index++;
      while (index < lines.length) {
        const nextItem = unorderedMatch(lines[index]!);
        if (nextItem === null) break;
        items.push(nextItem);
        index++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    const ordered = orderedMatch(line);
    if (ordered !== null) {
      flushParagraph(paragraphBuffer, blocks);
      const items: string[] = [ordered];
      const connectors: string[] = [];
      index++;
      while (index < lines.length) {
        if (isListConnectorLine(lines[index]!)) {
          connectors.push(lines[index]!.trim());
          index++;
          continue;
        }
        const nextItem = orderedMatch(lines[index]!);
        if (nextItem === null) break;
        items.push(nextItem);
        index++;
      }
      blocks.push({
        type: "ol",
        items,
        connectors: connectors.length > 0 ? connectors : undefined,
      });
      continue;
    }

    paragraphBuffer.push(line);
    index++;
  }

  flushParagraph(paragraphBuffer, blocks);
  return blocks;
}
