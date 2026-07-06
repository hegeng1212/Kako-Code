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
export const XLSX_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);
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
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
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
  return DOCX_EXTENSIONS.has(ext) || DOC_EXTENSIONS.has(ext) || XLSX_EXTENSIONS.has(ext);
}

export function attachmentKindForPath(filePath: string): "image" | "document" {
  return isImagePath(filePath) ? "image" : "document";
}
