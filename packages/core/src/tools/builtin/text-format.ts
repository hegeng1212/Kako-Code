export function formatCatNLine(lineNum: number, line: string): string {
  return `${String(lineNum).padStart(6)}\t${line}`;
}

export function formatTextLines(
  lines: string[],
  offset: number,
  limit: number,
): string {
  const startIdx = Math.max(0, offset - 1);
  const slice = lines.slice(startIdx, startIdx + limit);
  const numbered = slice.map((line, i) => formatCatNLine(offset + i, line));
  let result = numbered.join("\n");
  const remaining = lines.length - (startIdx + slice.length);
  if (remaining > 0) {
    result += `\n... (${remaining} more lines)`;
  }
  return result;
}
