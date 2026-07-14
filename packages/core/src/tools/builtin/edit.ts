import { readFile, writeFile } from "node:fs/promises";
import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_EDIT_DESCRIPTION } from "../claude-tool-text.js";
import { formatFileVersionRefresh } from "../file-version.js";
import { resolvePath, resolveWorkspacePath } from "./path.js";
import { loadSecurityPolicy } from "../../security/policy-store.js";

export const EDIT_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_EDIT_DESCRIPTION);

export const editToolDefinition: ToolDefinition = {
  name: "Edit",
  description: EDIT_DESCRIPTION,
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      file_path: {
        type: "string",
        description: "The absolute path to the file to modify",
      },
      old_string: {
        type: "string",
        description: "The text to replace",
      },
      new_string: {
        type: "string",
        description: "The text to replace it with (must be different from old_string)",
      },
      replace_all: {
        type: "boolean",
        default: false,
        description: "Replace all occurrences of old_string (default false)",
      },
    },
    required: ["file_path", "old_string", "new_string"],
  },
};

export interface ParsedEditInput {
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

export function parseEditInput(raw: Record<string, unknown>): ParsedEditInput {
  const filePath = String(raw.file_path ?? "").trim();
  const oldString = String(raw.old_string ?? "");
  const newString = String(raw.new_string ?? "");
  if (!filePath) {
    throw new Error("Edit requires file_path");
  }
  if (!oldString) {
    throw new Error("Edit requires old_string");
  }
  if (oldString === newString) {
    throw new Error("Edit requires new_string to differ from old_string");
  }
  return {
    filePath,
    oldString,
    newString,
    replaceAll: raw.replace_all === true,
  };
}

export function countOccurrences(content: string, needle: string): number {
  if (needle.length === 0) return 0;
  return content.split(needle).length - 1;
}

export function applyStringReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): { content: string; replacements: number } {
  const occurrences = countOccurrences(content, oldString);
  if (occurrences === 0) {
    throw new Error("old_string not found in file");
  }
  if (!replaceAll && occurrences > 1) {
    throw new Error(
      "old_string is not unique in file; use replace_all or provide more context",
    );
  }
  if (replaceAll) {
    return {
      content: content.split(oldString).join(newString),
      replacements: occurrences,
    };
  }
  const idx = content.indexOf(oldString);
  return {
    content: content.slice(0, idx) + newString + content.slice(idx + oldString.length),
    replacements: 1,
  };
}

export function formatEditResult(filePath: string, replacements: number): string {
  const noun = replacements === 1 ? "occurrence" : "occurrences";
  return `Replaced ${replacements} ${noun} in ${filePath}`;
}

function shouldAttachFileRefresh(message: string): boolean {
  return message.includes("not found") || message.includes("not unique");
}

export const editHandler: ToolHandler = async (input, context) => {
  const parsed = parseEditInput(input);
  const policy = await loadSecurityPolicy(context.cwd);
  await resolveWorkspacePath(
    parsed.filePath,
    context.cwd,
    policy,
    context.getCapability?.() ?? "WorkspaceWrite",
  );
  const filePath = resolvePath(parsed.filePath, context.cwd);

  if (!context.hasReadFile || !context.hasReadFile(filePath)) {
    throw new Error(
      "You must Read the file in this conversation before editing, or the call will fail.",
    );
  }

  const content = await readFile(filePath, "utf-8");
  const stale = context.isFileVersionStale
    ? await context.isFileVersionStale(filePath)
    : false;

  try {
    const { content: updated, replacements } = applyStringReplace(
      content,
      parsed.oldString,
      parsed.newString,
      parsed.replaceAll,
    );
    await writeFile(filePath, updated, "utf-8");
    await context.noteFileVersion?.(filePath);
    let result = formatEditResult(filePath, replacements);
    if (stale) {
      result += `\n\n${formatFileVersionRefresh(filePath, updated)}`;
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (stale || shouldAttachFileRefresh(message)) {
      throw new Error(`${message}\n\n${formatFileVersionRefresh(filePath, content)}`);
    }
    throw error;
  }
};
