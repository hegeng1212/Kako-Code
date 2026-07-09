import { readFile, stat } from "node:fs/promises";
import type { LLMContentBlock } from "@kako/shared";
import { unzipSync } from "fflate";
import { formatTextLines } from "../tools/builtin/text-format.js";
import {
  isImagePath,
  isOfficeDocumentPath,
  isPdfPath,
  isTextDocumentPath,
  mimeTypeForPath,
} from "./mime.js";
import { loadPdfParse } from "./pdf-env.js";

export const MAX_PDF_PAGES_PER_REQUEST = 20;
export const DOCUMENT_PREVIEW_MAX_CHARS = 2_000;
export const SPREADSHEET_PREVIEW_MAX_ROWS = 5;
export const SPREADSHEET_PREVIEW_MAX_COLS = 20;
/** Default row cap when Read is called on a spreadsheet without an explicit limit. */
export const SPREADSHEET_READ_PROBE_ROWS = 20;
export const SPREADSHEET_DEFAULT_MAX_ROWS = 200;
export const PRESENTATION_PREVIEW_MAX_SLIDES = 3;
export const PLAIN_TEXT_READ_MAX_LINES = 2_000;
const TEXT_SAMPLE_BYTES = 8_192;

export function isLikelyTextBuffer(buffer: Buffer): boolean {
  if (!buffer.length) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, TEXT_SAMPLE_BYTES));
  if (sample.includes(0)) return false;
  let nonText = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte >= 32 && byte <= 126) continue;
    if (byte >= 128) continue;
    nonText++;
  }
  return nonText / sample.length < 0.05;
}

function truncateDocumentPreview(header: string, body: string): string {
  if (body.length <= DOCUMENT_PREVIEW_MAX_CHARS) {
    return body ? `${header}\n\n${body}` : header;
  }
  return `${header}\n\n${body.slice(0, DOCUMENT_PREVIEW_MAX_CHARS)}\n\n… (preview truncated; use Read with offset/limit or Bash for more)`;
}

async function formatBinaryFileMessage(filePath: string): Promise<string> {
  const info = await stat(filePath);
  const mime = mimeTypeForPath(filePath);
  return `Binary file: ${filePath}\nType: ${mime}\nSize: ${info.size} bytes\n\nNo text preview available. Use Bash (file, xxd) or appropriate tools to inspect.`;
}

async function extractPlainTextPreview(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf-8");
  return truncateDocumentPreview(`Text from ${filePath}`, content);
}

async function extractPlainTextRead(
  filePath: string,
  options?: { offset?: number; limit?: number },
): Promise<string> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const offset = Math.max(1, options?.offset ?? 1);
  const limit = options?.limit ?? PLAIN_TEXT_READ_MAX_LINES;
  const body = formatTextLines(lines, offset, limit);
  return `Text from ${filePath}\n\n${body}`;
}

async function readTextOrBinaryFallback(
  filePath: string,
  mode: "preview" | "read",
  options?: { offset?: number; limit?: number },
): Promise<string> {
  const buffer = await readFile(filePath);
  if (!isLikelyTextBuffer(buffer)) {
    return formatBinaryFileMessage(filePath);
  }
  if (mode === "preview") {
    return truncateDocumentPreview(`Text from ${filePath}`, buffer.toString("utf-8"));
  }
  return extractPlainTextRead(filePath, options);
}

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

function slideNumberFromPath(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
}

function extractTextRunsFromOfficeXml(xml: string): string {
  return [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function extractPptxTextFromBuffer(
  buffer: Uint8Array,
  options: { maxSlides?: number } = {},
): string {
  const entries = unzipSync(buffer) as Record<string, Uint8Array>;
  const slideKeys = Object.keys(entries)
    .filter((key) => /^ppt\/slides\/slide\d+\.xml$/i.test(key))
    .sort((a, b) => slideNumberFromPath(a) - slideNumberFromPath(b));
  const noteKeys = new Map(
    Object.keys(entries)
      .filter((key) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(key))
      .map((key) => [slideNumberFromPath(key.replace("notesSlide", "slide")), key] as const),
  );

  const maxSlides = options.maxSlides ?? slideKeys.length;
  const sections: string[] = [];
  for (const slideKey of slideKeys.slice(0, maxSlides)) {
    const slideNum = slideNumberFromPath(slideKey);
    const slideText = extractTextRunsFromOfficeXml(
      new TextDecoder().decode(entries[slideKey]!),
    );
    const noteKey = noteKeys.get(slideNum);
    const noteText = noteKey
      ? extractTextRunsFromOfficeXml(new TextDecoder().decode(entries[noteKey]!))
      : "";
    const body = [slideText, noteText ? `Notes: ${noteText}` : ""].filter(Boolean).join("\n");
    if (body) {
      sections.push(`## Slide ${slideNum}\n${body}`);
    }
  }

  if (!sections.length) {
    throw new Error("No extractable slide text in PowerPoint file");
  }
  return sections.join("\n\n");
}

export async function extractPptxText(
  filePath: string,
  options: { maxSlides?: number } = {},
): Promise<string> {
  const buffer = await readFile(filePath);
  const body = extractPptxTextFromBuffer(buffer, options);
  const slideHint =
    options.maxSlides !== undefined ? ` (first ${options.maxSlides} slides)` : "";
  return `PowerPoint text from ${filePath}${slideHint}\n\n${body}`;
}

export async function formatLegacyPptMessage(filePath: string): Promise<string> {
  const info = await stat(filePath);
  return `PowerPoint legacy (.ppt) from ${filePath}\nSize: ${info.size} bytes\n\nBinary .ppt format — convert to .pptx externally, then use \`kako peek-presentation\`. Do not use python-pptx or pip install unless the user asks.`;
}

async function legacyPptGuidance(filePath: string): Promise<string> {
  return formatLegacyPptMessage(filePath);
}

export async function extractSpreadsheetText(
  filePath: string,
  options: SpreadsheetReadOptions = {},
): Promise<string> {
  const buffer = await readFile(filePath);
  const XLSX = await import("xlsx");
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const workbook =
    ext === ".tsv"
      ? XLSX.read(buffer.toString("utf-8"), { type: "string", FS: "\t" })
      : ext === ".csv"
        ? XLSX.read(buffer.toString("utf-8"), { type: "string" })
        : XLSX.read(buffer, { type: "buffer" });
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
    const truncateHint =
      sliceEnd < rows.length
        ? "\n… More rows exist. Use Read with offset/limit, or Bash to preprocess remaining data."
        : "";
    sections.push(`## Sheet: ${sheetName}${rowHint}\n${csv}${truncateHint}`);
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
  if (ext === ".pptx") {
    const full = await extractPptxText(filePath, {
      maxSlides: PRESENTATION_PREVIEW_MAX_SLIDES,
    });
    const body = full.split("\n\n").slice(1).join("\n\n");
    if (body.length <= DOCUMENT_PREVIEW_MAX_CHARS) return full;
    return `${full.split("\n\n")[0]}\n\n${body.slice(0, DOCUMENT_PREVIEW_MAX_CHARS)}\n\n… (preview truncated; use Bash slide-range extraction for more)`;
  }
  if (ext === ".ppt") {
    return legacyPptGuidance(filePath);
  }
  if ([".xlsx", ".xls", ".csv", ".tsv"].includes(ext)) {
    return extractSpreadsheetText(filePath, {
      maxRows: SPREADSHEET_PREVIEW_MAX_ROWS,
      maxCols: SPREADSHEET_PREVIEW_MAX_COLS,
    });
  }
  if (isTextDocumentPath(filePath)) {
    return extractPlainTextPreview(filePath);
  }
  return readTextOrBinaryFallback(filePath, "preview");
}

export async function readDocumentText(
  filePath: string,
  options?: { pages?: string; offset?: number; limit?: number; explicitLimit?: boolean },
): Promise<string> {
  if (isPdfPath(filePath)) {
    return extractPdfText(filePath, options?.pages);
  }
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (ext === ".docx") {
    return extractDocxText(filePath);
  }
  if (ext === ".pptx") {
    return extractPptxText(filePath);
  }
  if (ext === ".ppt") {
    return legacyPptGuidance(filePath);
  }
  if ([".xlsx", ".xls", ".csv", ".tsv"].includes(ext)) {
    const maxRows =
      options?.explicitLimit === false
        ? SPREADSHEET_READ_PROBE_ROWS
        : options?.limit ?? SPREADSHEET_DEFAULT_MAX_ROWS;
    return extractSpreadsheetText(filePath, {
      offsetRow: options?.offset,
      maxRows,
    });
  }
  if (isTextDocumentPath(filePath)) {
    return extractPlainTextRead(filePath, {
      offset: options?.offset,
      limit: options?.limit,
    });
  }
  return readTextOrBinaryFallback(filePath, "read", {
    offset: options?.offset,
    limit: options?.limit,
  });
}

export async function readMediaFile(
  filePath: string,
  options?: { pages?: string; offset?: number; limit?: number; explicitLimit?: boolean },
): Promise<string | LLMContentBlock[]> {
  if (isImagePath(filePath)) {
    return readImageBlocks(filePath);
  }
  if (isPdfPath(filePath) || isOfficeDocumentPath(filePath)) {
    return readDocumentText(filePath, {
      pages: options?.pages,
      offset: options?.offset,
      limit: options?.limit,
      explicitLimit: options?.explicitLimit,
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
