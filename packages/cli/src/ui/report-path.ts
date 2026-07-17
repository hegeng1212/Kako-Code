import { basename, dirname, extname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { clipToDisplayWidth } from "./markdown-code-highlight.js";
import { displayWidth } from "./ansi.js";

/** Report / document artifacts — open containing folder; code paths stay plain. */
const REPORT_ARTIFACT_EXTENSIONS = new Set([
  "md",
  "markdown",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "prd",
  "pdf",
  "csv",
  "tsv",
]);

export const OPEN_REPORT_DIR_LABEL = "打开目录";

export function isReportArtifactPath(filePath: string): boolean {
  const cleaned = filePath.trim().replace(/^`+|`+$/g, "");
  if (!cleaned) return false;
  const ext = extname(cleaned).toLowerCase().replace(/^\./, "");
  return REPORT_ARTIFACT_EXTENSIONS.has(ext);
}

export function containingDirectory(filePath: string): string {
  const cleaned = filePath.trim().replace(/^`+|`+$/g, "");
  return dirname(resolve(cleaned));
}

/** Truncate a long path for one terminal row, preferring to keep the basename. */
export function truncatePathForDisplay(filePath: string, maxWidth: number): string {
  const cleaned = filePath.trim();
  if (maxWidth < 4) return clipToDisplayWidth(cleaned, Math.max(1, maxWidth));
  if (displayWidth(cleaned) <= maxWidth) return cleaned;
  const name = basename(cleaned);
  const prefix = "…/";
  const withName = `${prefix}${name}`;
  if (displayWidth(withName) <= maxWidth) return withName;
  return clipToDisplayWidth(withName, maxWidth);
}

/**
 * Open a directory in the OS file manager.
 * macOS: `open`; Windows: `explorer`; Linux: `xdg-open`.
 */
export function openDirectory(dirPath: string): Promise<boolean> {
  const dir = resolve(dirPath.trim());
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const args = process.platform === "win32" ? [dir] : [dir];
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", () => resolvePromise(false));
    child.once("spawn", () => {
      child.unref();
      resolvePromise(true);
    });
  });
}

/**
 * Open the folder that contains `filePath` in the OS file manager.
 */
export function openContainingDirectory(filePath: string): Promise<boolean> {
  return openDirectory(containingDirectory(filePath));
}
