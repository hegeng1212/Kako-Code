import { stripAnsi } from "./ansi.js";

/** Word-wrap plain or ANSI text to fit terminal columns. */
export function wrapContentLines(text: string, width: number): string[] {
  if (width < 1) return [text];
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.length ? rawLine : "";
    if (stripAnsi(line).length <= width) {
      lines.push(line);
      continue;
    }
    const plain = stripAnsi(line);
    let start = 0;
    while (start < plain.length) {
      let end = Math.min(start + width, plain.length);
      if (end < plain.length) {
        const slice = plain.slice(start, end);
        const lastSpace = slice.lastIndexOf(" ");
        if (lastSpace > width * 0.4) end = start + lastSpace;
      }
      const chunk = plain.slice(start, end).trimEnd();
      if (chunk) lines.push(chunk);
      start = end;
      while (start < plain.length && plain[start] === " ") start++;
    }
    if (!line) lines.push("");
  }
  return lines.length ? lines : [""];
}
