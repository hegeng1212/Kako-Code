import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSessionMemoryDir } from "../config/paths.js";

const DEFAULT_PERSIST_ABOVE_CHARS = 8000;
const DEFAULT_PREVIEW_CHARS = 2048;

export interface BoundToolResultOptions {
  sessionId: string;
  toolCallId: string;
  content: string;
  persistAboveChars?: number;
  previewChars?: number;
}

function safeToolResultId(toolCallId: string): string {
  const trimmed = toolCallId.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, "-");
  return safe || "tool-result";
}

export async function boundToolResultForModel(
  options: BoundToolResultOptions,
): Promise<string> {
  const persistAboveChars = options.persistAboveChars ?? DEFAULT_PERSIST_ABOVE_CHARS;
  const previewChars = options.previewChars ?? DEFAULT_PREVIEW_CHARS;
  const { content, sessionId, toolCallId } = options;

  if (content.length <= persistAboveChars) {
    return content;
  }

  const dir = join(getSessionMemoryDir(sessionId), "tool-results");
  await mkdir(dir, { recursive: true });
  const absPath = join(dir, `${safeToolResultId(toolCallId)}.txt`);
  await writeFile(absPath, content, "utf-8");

  const sizeKb = Math.ceil(content.length / 1024);
  const preview = content.slice(0, previewChars);
  const previewLabel =
    previewChars === DEFAULT_PREVIEW_CHARS ? "2KB" : `${Math.ceil(previewChars / 1024)}KB`;

  return [
    `Output too large (${sizeKb}KB). Full output saved to: ${absPath}`,
    "",
    `Preview (first ${previewLabel}):`,
    preview,
    "",
    `Use Read to load the rest from: ${absPath}`,
  ].join("\n");
}
