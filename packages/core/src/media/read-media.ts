import { readFile } from "node:fs/promises";
import type { LLMContentBlock } from "@kako/shared";
import { isImagePath, isOfficeDocumentPath, isPdfPath, mimeTypeForPath } from "./mime.js";
import { loadPdfParse } from "./pdf-env.js";

export const MAX_PDF_PAGES_PER_REQUEST = 20;
export const DOCUMENT_PREVIEW_MAX_CHARS = 2_000;
export const SPREADSHEET_PREVIEW_MAX_ROWS = 5;
export const SPREADSHEET_PREVIEW_MAX_COLS = 20;
export const SPREADSHEET_DEFAULT_MAX_ROWS = 200;

export interface SpreadsheetReadOptions {
  sheet?: string;
  maxRows?: number;
  maxCols?: number;
  offsetRow?: number;
}

export function parsePdfPageRange(pages: string): number[] {
  const trimmed = pages.trim();
  if (!trimmed) {
    throw new Error("PDF pages parameter is required for PDF files");
  }
  if (trimmed.includes("-")) {
    const [startRaw, endRaw] = trimmed.split("-", 2);
    const start = Number(startRaw);
    const end = Number(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
      throw new Error(`Invalid PDF page range: ${pages}`);
    }
    const count = end - start + 1;
    if (count > MAX_PDF_PAGES_PER_REQUEST) {
      throw new Error(
        `PDF page range exceeds maximum of ${MAX_PDF_PAGES_PER_REQUEST} pages per request`,
      );
    }
    return Array.from({ length: count }, (_, i) => start + i);
  }
  const page = Number(trimmed);
  if (!Number.isFinite(page) || page < 1) {
    throw new Error(`Invalid PDF page range: ${pages}`);
  }
  return [page];
}

export async function readImageBlocks(filePath: string): Promise<LLMContentBlock[]> {
  const data = await readFile(filePath);
  const mediaType = mimeTypeForPath(filePath);
  return [
    {
      type: "image",
      source: data.toString("base64"),
      mediaType,
    },
    {
      type: "text",
      text: `Image file: ${filePath} (${mediaType}, ${data.length} bytes)`,
    },
  ];
}

export async function extractPdfText(filePath: string, pages?: string): Promise<string> {
  const buffer = await readFile(filePath);
  const { PDFParse } = await loadPdfParse();
  const parser = new PDFParse({ data: buffer });
  try {
    const pageList = pages?.trim() ? parsePdfPageRange(pages) : undefined;
    const result = await parser.getText(pageList ? { partial: pageList } : undefined);
    const text = result.text?.trim() ?? "";
    if (!text) {
      throw new Error(`No extractable text in PDF: ${filePath}`);
    }
    const header = pageList
      ? `PDF pages ${pageList.join(", ")} from ${filePath}`
      : `PDF text from ${filePath}`;
    return `${header}\n\n${text}`;
  } finally {
    await parser.destroy();
  }
}

export async function extractDocxText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  if (!text) {
    throw new Error(`No extractable text in document: ${filePath}`);
  }
  return `Document text from ${filePath}\n\n${text}`;
}

export async function extractSpreadsheetText(
  filePath: string,
  options: SpreadsheetReadOptions = {},
): Promise<string> {
  const buffer = await readFile(filePath);
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const maxCols = options.maxCols ?? Number.POSITIVE_INFINITY;
  const offsetRow = Math.max(1, options.offsetRow ?? 1);
  const sections: string[] = [`Spreadsheet from ${filePath}`];
  const sheetNames = options.sheet ? [options.sheet] : workbook.SheetNames;

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      if (options.sheet) {
        throw new Error(`Sheet not found: ${options.sheet}`);
      }
      continue;
    }
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as string[][];
    if (!rows.length) continue;

    const sliceStart = offsetRow - 1;
    const sliceEnd =
      Number.isFinite(maxRows) && maxRows > 0 ? sliceStart + maxRows : rows.length;
    const sliced = rows.slice(sliceStart, sliceEnd).map((row) =>
      row.slice(0, Number.isFinite(maxCols) && maxCols > 0 ? maxCols : row.length),
    );
    const csv = sliced.map((row) => row.join(",")).join("\n").trim();
    if (!csv) continue;

    const rowHint =
      offsetRow > 1 || sliceEnd < rows.length
        ? ` (rows ${offsetRow}-${Math.min(sliceEnd, rows.length)} of ${rows.length})`
        : rows.length > sliced.length
          ? ` (first ${sliced.length} of ${rows.length} rows)`
          : "";
    sections.push(`## Sheet: ${sheetName}${rowHint}\n${csv}`);
  }

  if (sections.length === 1) {
    throw new Error(`No extractable data in spreadsheet: ${filePath}`);
  }
  return sections.join("\n\n");
}

export async function previewDocumentText(filePath: string): Promise<string> {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (isPdfPath(filePath)) {
    return extractPdfText(filePath, "1");
  }
  if (ext === ".docx") {
    const full = await extractDocxText(filePath);
    const body = full.split("\n\n").slice(1).join("\n\n");
    if (body.length <= DOCUMENT_PREVIEW_MAX_CHARS) return full;
    return `${full.split("\n\n")[0]}\n\n${body.slice(0, DOCUMENT_PREVIEW_MAX_CHARS)}\n\n… (preview truncated; use Read with offset/limit or Bash for more)`;
  }
  if ([".xlsx", ".xls", ".csv"].includes(ext)) {
    return extractSpreadsheetText(filePath, {
      maxRows: SPREADSHEET_PREVIEW_MAX_ROWS,
      maxCols: SPREADSHEET_PREVIEW_MAX_COLS,
    });
  }
  throw new Error(`Unsupported document type: ${filePath}`);
}

export async function readDocumentText(
  filePath: string,
  options?: { pages?: string; offset?: number; limit?: number },
): Promise<string> {
  if (isPdfPath(filePath)) {
    return extractPdfText(filePath, options?.pages);
  }
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (ext === ".docx") {
    return extractDocxText(filePath);
  }
  if ([".xlsx", ".xls", ".csv"].includes(ext)) {
    return extractSpreadsheetText(filePath, {
      offsetRow: options?.offset,
      maxRows: options?.limit ?? SPREADSHEET_DEFAULT_MAX_ROWS,
    });
  }
  throw new Error(`Unsupported document type: ${filePath}`);
}

export async function readMediaFile(
  filePath: string,
  options?: { pages?: string; offset?: number; limit?: number },
): Promise<string | LLMContentBlock[]> {
  if (isImagePath(filePath)) {
    return readImageBlocks(filePath);
  }
  if (isPdfPath(filePath) || isOfficeDocumentPath(filePath)) {
    return readDocumentText(filePath, {
      pages: options?.pages,
      offset: options?.offset,
      limit: options?.limit,
    });
  }
  throw new Error(`Unsupported media file: ${filePath}`);
}

export function isToolMultimodalOutput(output: unknown): output is LLMContentBlock[] {
  return (
    Array.isArray(output) &&
    output.every(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        (block.type === "text" || block.type === "image"),
    )
  );
}

export function toolOutputToLlmContent(output: unknown): string | LLMContentBlock[] {
  if (typeof output === "string") return output;
  if (isToolMultimodalOutput(output)) return output;
  return String(output ?? "");
}
