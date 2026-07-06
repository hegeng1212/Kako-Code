import { readFile } from "node:fs/promises";
import type { LLMContentBlock } from "@kako/shared";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import { isImagePath, isOfficeDocumentPath, isPdfPath, mimeTypeForPath } from "./mime.js";

export const MAX_PDF_PAGES_PER_REQUEST = 20;

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
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  if (!text) {
    throw new Error(`No extractable text in document: ${filePath}`);
  }
  return `Document text from ${filePath}\n\n${text}`;
}

export async function extractSpreadsheetText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sections: string[] = [`Spreadsheet from ${filePath}`];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet).trim();
    if (!csv) continue;
    sections.push(`## Sheet: ${sheetName}\n${csv}`);
  }
  if (sections.length === 1) {
    throw new Error(`No extractable data in spreadsheet: ${filePath}`);
  }
  return sections.join("\n\n");
}

export async function readDocumentText(filePath: string, pages?: string): Promise<string> {
  if (isPdfPath(filePath)) {
    return extractPdfText(filePath, pages);
  }
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (ext === ".docx") {
    return extractDocxText(filePath);
  }
  if ([".xlsx", ".xls", ".csv"].includes(ext)) {
    return extractSpreadsheetText(filePath);
  }
  throw new Error(`Unsupported document type: ${filePath}`);
}

export async function readMediaFile(
  filePath: string,
  options?: { pages?: string },
): Promise<string | LLMContentBlock[]> {
  if (isImagePath(filePath)) {
    return readImageBlocks(filePath);
  }
  if (isPdfPath(filePath) || isOfficeDocumentPath(filePath)) {
    return readDocumentText(filePath, options?.pages);
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
