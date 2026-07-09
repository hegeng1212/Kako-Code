export const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
]);

export const PDF_EXTENSION = ".pdf";
export const DOCX_EXTENSIONS = new Set([".docx"]);
export const DOC_EXTENSIONS = new Set([".doc"]);
export const PPTX_EXTENSIONS = new Set([".pptx"]);
export const PPT_EXTENSIONS = new Set([".ppt"]);
export const XLSX_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".tsv"]);
export const TEXT_DOCUMENT_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);
export const NOTEBOOK_EXTENSION = ".ipynb";

const EXTENSION_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
};

export function extensionOf(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
}

export function mimeTypeForPath(filePath: string): string {
  const ext = extensionOf(filePath);
  return EXTENSION_MIME[ext] ?? "application/octet-stream";
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(filePath));
}

export function isPdfPath(filePath: string): boolean {
  return extensionOf(filePath) === PDF_EXTENSION;
}

export function isOfficeDocumentPath(filePath: string): boolean {
  const ext = extensionOf(filePath);
  return (
    DOCX_EXTENSIONS.has(ext) ||
    DOC_EXTENSIONS.has(ext) ||
    PPTX_EXTENSIONS.has(ext) ||
    PPT_EXTENSIONS.has(ext) ||
    XLSX_EXTENSIONS.has(ext)
  );
}

export function isPresentationPath(filePath: string): boolean {
  const ext = extensionOf(filePath);
  return PPTX_EXTENSIONS.has(ext) || PPT_EXTENSIONS.has(ext);
}

export function isSpreadsheetPath(filePath: string): boolean {
  return XLSX_EXTENSIONS.has(extensionOf(filePath));
}

export function isTextDocumentPath(filePath: string): boolean {
  return TEXT_DOCUMENT_EXTENSIONS.has(extensionOf(filePath));
}

/** PDF, Word, PowerPoint, plain text, markdown — long-form bodies that may need chunked summarization. */
export function isProseDocumentPath(filePath: string): boolean {
  const ext = extensionOf(filePath);
  return (
    isPdfPath(filePath) ||
    DOCX_EXTENSIONS.has(ext) ||
    DOC_EXTENSIONS.has(ext) ||
    isPresentationPath(filePath) ||
    TEXT_DOCUMENT_EXTENSIONS.has(ext)
  );
}

export function attachmentKindForPath(filePath: string): "image" | "document" {
  return isImagePath(filePath) ? "image" : "document";
}
