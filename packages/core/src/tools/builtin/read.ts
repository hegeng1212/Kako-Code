import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_READ_DESCRIPTION } from "../claude-tool-text.js";
import { findSkillByMdPath } from "../../skills/loader.js";
import { isImagePath, isOfficeDocumentPath, isPdfPath, NOTEBOOK_EXTENSION } from "../../media/mime.js";
import { readMediaFile } from "../../media/read-media.js";
import { formatNotebookForRead } from "./notebook.js";
import { formatTextLines } from "./text-format.js";

export const READ_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_READ_DESCRIPTION);

export const MAX_READ_LINES = 2000;

export const readToolDefinition: ToolDefinition = {
  name: "Read",
  description: READ_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      file_path: {
        type: "string",
        description: "The absolute path to the file to read",
      },
      offset: {
        type: "integer",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
        description:
          "The line number to start reading from. Only provide if the file is too large to read at once",
      },
      limit: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
        description:
          "The number of lines to read. Only provide if the file is too large to read at once.",
      },
      pages: {
        type: "string",
        description:
          'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request.',
      },
    },
    required: ["file_path"],
  },
};

export interface ParsedReadInput {
  filePath: string;
  offset: number;
  limit: number;
  pages?: string;
}

export function parseReadInput(raw: Record<string, unknown>): ParsedReadInput {
  const filePath = String(raw.file_path ?? raw.path ?? "").trim();
  if (!filePath) {
    throw new Error("Read requires file_path");
  }
  if (!isAbsolute(filePath)) {
    throw new Error("Read requires file_path to be an absolute path");
  }
  const offset = resolveReadOffset(raw.offset);
  const limit = resolveReadLimit(raw.limit);
  const pages = raw.pages !== undefined ? String(raw.pages).trim() : undefined;
  return { filePath, offset, limit, pages };
}

export function resolveReadOffset(offset: unknown): number {
  if (offset === undefined || offset === null) return 1;
  const n = Number(offset);
  if (!Number.isFinite(n) || n < 0) return 1;
  if (n === 0) return 1;
  return Math.floor(n);
}

export function resolveReadLimit(limit: unknown): number {
  if (limit === undefined || limit === null) return MAX_READ_LINES;
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return MAX_READ_LINES;
  return Math.min(Math.floor(n), MAX_READ_LINES);
}

export { formatCatNLine, formatTextLines } from "./text-format.js";
export { MAX_PDF_PAGES_PER_REQUEST } from "../../media/read-media.js";

function extensionOf(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
}

async function assertReadableFile(filePath: string): Promise<void> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }
  if (info.isDirectory()) {
    throw new Error(`Path is a directory: ${filePath}`);
  }
  if (info.size === 0) {
    throw new Error(`File is empty: ${filePath}`);
  }
}

export const readHandler: ToolHandler = async (input, context) => {
  const parsed = parseReadInput(input);
  await assertReadableFile(parsed.filePath);

  const ext = extensionOf(parsed.filePath);

  if (isImagePath(parsed.filePath) || isPdfPath(parsed.filePath) || isOfficeDocumentPath(parsed.filePath)) {
    const media = await readMediaFile(parsed.filePath, { pages: parsed.pages });
    if (typeof media !== "string") {
      return media;
    }
    return wrapSkillReadResult(parsed.filePath, media, context.cwd);
  }

  const content = await readFile(parsed.filePath, "utf-8");
  if (!content.length) {
    throw new Error(`File is empty: ${parsed.filePath}`);
  }

  if (ext === NOTEBOOK_EXTENSION) {
    const notebook = formatNotebookForRead(content, parsed.offset, parsed.limit);
    return wrapSkillReadResult(parsed.filePath, notebook, context.cwd);
  }

  const lines = content.split("\n");
  const text = formatTextLines(lines, parsed.offset, parsed.limit);
  return wrapSkillReadResult(parsed.filePath, text, context.cwd);
};

async function wrapSkillReadResult(
  filePath: string,
  body: string,
  cwd: string,
): Promise<string> {
  const skill = await findSkillByMdPath(filePath, cwd);
  if (!skill) return body;
  return `<command-${skill.name}>\n${body}\n</command-${skill.name}>`;
}
