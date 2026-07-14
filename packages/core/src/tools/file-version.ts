import { stat } from "node:fs/promises";
import { formatTextLines } from "./builtin/text-format.js";
import { MAX_READ_LINES } from "./builtin/read.js";

export interface FileVersionSnapshot {
  mtimeMs: number;
  size: number;
}

export const FILE_VERSION_REFRESH_TAG = "file-version-refresh";

export async function snapshotFileVersion(filePath: string): Promise<FileVersionSnapshot> {
  const st = await stat(filePath);
  return { mtimeMs: st.mtimeMs, size: st.size };
}

export function fileVersionChanged(
  known: FileVersionSnapshot,
  current: FileVersionSnapshot,
): boolean {
  return known.mtimeMs !== current.mtimeMs || known.size !== current.size;
}

export function formatFileVersionRefresh(filePath: string, content: string): string {
  const lines = content.split("\n");
  const body = formatTextLines(lines, 1, MAX_READ_LINES);
  return [
    `<${FILE_VERSION_REFRESH_TAG} path="${filePath}">`,
    "The file changed since your last Read or Write/Edit on this path. Current contents:",
    "",
    body,
    `</${FILE_VERSION_REFRESH_TAG}>`,
  ].join("\n");
}
