import { charDisplayWidth, displayWidth, stripAnsi } from "./ansi.js";

/**
 * Word-wrap plain or ANSI text to fit terminal *display columns*
 * (CJK / emoji count as 2). ANSI codes are stripped for measurement;
 * returned chunks are plain (callers re-apply colors).
 */
export function wrapContentLines(text: string, width: number): string[] {
  if (width < 1) return [stripAnsi(text)];
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const plain = stripAnsi(rawLine.length ? rawLine : "");
    if (displayWidth(plain) <= width) {
      lines.push(plain);
      continue;
    }
    let start = 0;
    while (start < plain.length) {
      let end = takeDisplayEnd(plain, start, width);
      if (end < plain.length) {
        const slice = plain.slice(start, end);
        const lastSpace = slice.lastIndexOf(" ");
        if (lastSpace > 0 && displayWidth(slice.slice(0, lastSpace)) > width * 0.4) {
          end = start + lastSpace;
        }
      }
      const chunk = plain.slice(start, end).trimEnd();
      if (chunk) lines.push(chunk);
      start = end;
      while (start < plain.length && plain[start] === " ") start++;
      // Safety: ensure forward progress on pathological wide graphemes.
      if (start < plain.length && end === start) {
        start += plain.codePointAt(start)! > 0xffff ? 2 : 1;
      }
    }
    if (!plain) lines.push("");
  }
  return lines.length ? lines : [""];
}

/** Exclusive end index such that plain[start:end] fits in maxCols display columns. */
function takeDisplayEnd(plain: string, start: number, maxCols: number): number {
  let cols = 0;
  let i = start;
  while (i < plain.length) {
    const cp = plain.codePointAt(i)!;
    const cw = charDisplayWidth(cp);
    if (cols + cw > maxCols) break;
    cols += cw;
    i += cp > 0xffff ? 2 : 1;
  }
  // Always consume at least one code point so we never stall.
  if (i === start && start < plain.length) {
    const cp = plain.codePointAt(start)!;
    return start + (cp > 0xffff ? 2 : 1);
  }
  return i;
}
