import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";

/** Undo common shell / Finder escape sequences in pasted paths. */
export function unescapePathCandidate(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

/** Normalize clipboard text (file URLs, trailing newlines). */
export function normalizeClipboardPath(text: string): string {
  let trimmed = text.replace(/\r\n?/g, "\n").trim();
  if (trimmed.startsWith("file://")) {
    try {
      trimmed = decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      // keep raw text
    }
  }
  return trimmed;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function rawLengthForNormalizedPrefix(raw: string, normalizedEnd: number): number {
  let rawIdx = 0;
  let normIdx = 0;
  while (normIdx < normalizedEnd && rawIdx < raw.length) {
    if (raw[rawIdx] === "\\" && rawIdx + 1 < raw.length) {
      rawIdx += 2;
      normIdx += 1;
      continue;
    }
    rawIdx += 1;
    normIdx += 1;
  }
  return rawIdx;
}

/**
 * Find the longest absolute path prefix of `text` that exists on disk.
 * Handles paths with spaces and optional leading `@`.
 */
export async function findLeadingAbsolutePath(
  text: string,
): Promise<{ path: string; rest: string; endIndex: number } | null> {
  let index = 0;
  while (index < text.length && /\s/.test(text[index] ?? "")) index++;

  if (text[index] === "@") {
    index++;
    while (index < text.length && /\s/.test(text[index] ?? "")) index++;
  }

  if (text[index] !== "/") {
    return null;
  }

  const fromSlash = text.slice(index);
  const normalized = unescapePathCandidate(fromSlash);
  const candidates: number[] = [normalized.length];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === " " || normalized[i] === "\n") {
      candidates.push(i);
    }
  }

  for (const end of candidates.sort((a, b) => b - a)) {
    const candidate = normalized.slice(0, end).trimEnd();
    if (!candidate || !isAbsolute(candidate)) continue;
    if (await pathExists(candidate)) {
      const rawConsumed = rawLengthForNormalizedPrefix(fromSlash, end);
      return {
        path: candidate,
        rest: text.slice(index + rawConsumed).trim(),
        endIndex: index + rawConsumed,
      };
    }
  }

  return null;
}

/** Extract consecutive absolute file paths from pasted clipboard text. */
export async function parsePastedFilePaths(
  text: string,
): Promise<{ paths: string[]; rest: string }> {
  const paths: string[] = [];
  let remaining = text.replace(/\r\n/g, "\n");

  while (remaining.length) {
    remaining = remaining.replace(/^[\s\n]+/, "");
    if (!remaining) break;
    const leading = await findLeadingAbsolutePath(remaining);
    if (!leading) break;
    if (!paths.includes(leading.path)) paths.push(leading.path);
    remaining = leading.rest;
  }

  return { paths, rest: remaining.trim() };
}

async function extractSequentialBarePaths(
  text: string,
): Promise<{ paths: string[]; text: string }> {
  const { paths, rest } = await parsePastedFilePaths(text);
  return { paths, text: rest.replace(/\s+/g, " ").trim() };
}

/** Extract `@/absolute/path` markers, including paths with spaces when they exist on disk. */
export async function extractAtPathMarkers(
  text: string,
): Promise<Array<{ path: string; start: number; end: number }>> {
  const matches: Array<{ path: string; start: number; end: number }> = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const atIdx = text.indexOf("@", searchFrom);
    if (atIdx === -1) break;
    const parsed = await findLeadingAbsolutePath(text.slice(atIdx));
    if (parsed) {
      matches.push({
        path: parsed.path,
        start: atIdx,
        end: atIdx + parsed.endIndex,
      });
      searchFrom = atIdx + parsed.endIndex;
      continue;
    }
    searchFrom = atIdx + 1;
  }
  return matches;
}

export interface ParsedPathReferences {
  paths: string[];
  text: string;
}

/**
 * Resolve absolute file paths embedded in user text.
 * Supports `@/path` markers and a leading bare absolute path before the question.
 */
export async function parsePathReferences(text: string): Promise<ParsedPathReferences> {
  const paths: string[] = [];
  const markers = await extractAtPathMarkers(text);
  let remaining = text;

  if (markers.length) {
    let offset = 0;
    for (const marker of markers.sort((a, b) => a.start - b.start)) {
      const adjStart = marker.start - offset;
      const adjEnd = marker.end - offset;
      remaining = remaining.slice(0, adjStart) + remaining.slice(adjEnd);
      offset += marker.end - marker.start;
      if (!paths.includes(marker.path)) {
        paths.push(marker.path);
      }
    }
    remaining = remaining.replace(/\s+/g, " ").trim();
    return { paths, text: remaining };
  }

  const leading = await extractSequentialBarePaths(text);
  if (leading.paths.length) {
    return leading;
  }

  return { paths, text: text.trim() };
}