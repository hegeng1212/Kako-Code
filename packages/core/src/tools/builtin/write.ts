import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_WRITE_DESCRIPTION } from "../claude-tool-text.js";
import { lineCount, resolvePath } from "./path.js";

export const WRITE_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_WRITE_DESCRIPTION);

export const writeToolDefinition: ToolDefinition = {
  name: "Write",
  description: WRITE_DESCRIPTION,
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      file_path: {
        type: "string",
        description: "The absolute path to the file to write (must be absolute, not relative)",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["file_path", "content"],
  },
};

export interface ParsedWriteInput {
  filePath: string;
  content: string;
}

export function parseWriteInput(raw: Record<string, unknown>): ParsedWriteInput {
  const filePath = String(raw.file_path ?? raw.path ?? "").trim();
  const content = String(raw.content ?? raw.contents ?? "");
  if (!filePath) {
    throw new Error("Write requires file_path");
  }
  if (!isAbsolute(filePath)) {
    throw new Error("Write requires file_path to be an absolute path");
  }
  return { filePath, content };
}

export const writeHandler: ToolHandler = async (input, context) => {
  const parsed = parseWriteInput(input);
  const path = resolvePath(parsed.filePath, context.cwd);

  let exists = false;
  try {
    const st = await stat(path);
    exists = st.isFile();
  } catch {
    exists = false;
  }

  if (exists) {
    const planPath = context.getPlanFilePath?.();
    const isPlanFile =
      planPath !== undefined && resolve(path) === resolve(resolvePath(planPath, context.cwd));
    if (!isPlanFile) {
      if (!context.hasReadFile || !context.hasReadFile(path)) {
        throw new Error(
          "You must use the Read tool on this file in the current conversation before overwriting it",
        );
      }
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, parsed.content, "utf-8");
  return `Wrote ${lineCount(parsed.content)} lines to ${path}`;
};
