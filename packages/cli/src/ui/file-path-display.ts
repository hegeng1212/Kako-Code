import { basename } from "node:path";
import { unescapePathCandidate } from "@kako/core";

const FILE_PATH_PATTERN =
  /(\/(?:[^\n]|\\.)+?\.(?:xlsx|xls|csv|tsv|pdf|docx|doc|png|jpe?g|gif|webp|bmp|svg))/gi;

/** Absolute file paths embedded in user text (for chat branch labels). */
export function extractDisplayFilePaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(FILE_PATH_PATTERN)) {
    const raw = match[1];
    if (!raw || raw.includes("[Image #")) continue;
    const path = unescapePathCandidate(raw);
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

export function formatFileBranchLabel(path: string): string {
  return basename(path);
}
