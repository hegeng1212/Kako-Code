import {
  extractSpreadsheetText,
  SPREADSHEET_PREVIEW_MAX_COLS,
} from "./read-media.js";

/** Sample spreadsheet sheets and first rows (bundled xlsx — safe for Bash via `kako peek-spreadsheet`). */
export async function peekSpreadsheet(
  filePath: string,
  maxRows = 5,
): Promise<string> {
  const rows = Math.max(1, Math.floor(maxRows) || 5);
  return extractSpreadsheetText(filePath, {
    maxRows: rows,
    maxCols: SPREADSHEET_PREVIEW_MAX_COLS,
  });
}

export function formatPeekSpreadsheetBashCommand(filePath: string, maxRows = 5): string {
  const rows = Math.max(1, Math.floor(maxRows) || 5);
  return `kako peek-spreadsheet ${JSON.stringify(filePath)} ${rows}`;
}
