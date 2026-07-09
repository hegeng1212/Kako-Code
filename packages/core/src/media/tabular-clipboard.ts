/** Detect tab-separated grid text typical of spreadsheet cell copies. */
export function isTabularClipboardText(text: string): boolean {
  if (!text.includes("\t")) return false;

  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return false;

  const colCounts = lines.filter((line) => line.includes("\t")).map((line) => line.split("\t").length);
  if (!colCounts.length) return false;

  const maxCols = Math.max(...colCounts);
  if (maxCols >= 2) return true;
  return colCounts.length >= 2;
}
