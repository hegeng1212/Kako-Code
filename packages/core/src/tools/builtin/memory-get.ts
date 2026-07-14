import { isAbsolute, relative, resolve } from "node:path";
import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { getMemoryDir } from "../../config/paths.js";
import { memoryGet } from "../../memory/index-fts.js";

export const MEMORY_GET_DESCRIPTION = `Read a memory file by absolute or memory-relative path, optionally by line range.
Use after MemorySearch when a snippet is insufficient. Output is capped; narrow the range for large files.
Only paths under the Kako memory directory are allowed.`;

export const memoryGetToolDefinition: ToolDefinition = {
  name: "MemoryGet",
  description: MEMORY_GET_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        description: "Path to a memory file (absolute under ~/.kako/memory, or relative to it).",
      },
      startLine: {
        type: "number",
        description: "1-based start line (inclusive).",
      },
      endLine: {
        type: "number",
        description: "1-based end line (inclusive).",
      },
      maxChars: {
        type: "number",
        description: "Max characters to return (default 12000).",
      },
    },
    required: ["path"],
  },
};

export function resolveMemoryPath(pathInput: string): string {
  const memoryRoot = resolve(getMemoryDir());
  const raw = pathInput.trim();
  if (!raw) throw new Error("path is required");
  const abs = resolve(isAbsolute(raw) ? raw : resolve(memoryRoot, raw));
  const rel = relative(memoryRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Access denied: path must be under ${memoryRoot}`);
  }
  return abs;
}

export const memoryGetHandler: ToolHandler = async (input) => {
  const raw = input as {
    path?: unknown;
    startLine?: unknown;
    endLine?: unknown;
    maxChars?: unknown;
  };
  const path = resolveMemoryPath(String(raw.path ?? ""));
  const startLine =
    typeof raw.startLine === "number" && Number.isFinite(raw.startLine)
      ? Math.floor(raw.startLine)
      : undefined;
  const endLine =
    typeof raw.endLine === "number" && Number.isFinite(raw.endLine)
      ? Math.floor(raw.endLine)
      : undefined;
  const maxChars =
    typeof raw.maxChars === "number" && Number.isFinite(raw.maxChars)
      ? Math.floor(raw.maxChars)
      : undefined;

  return memoryGet({ path, startLine, endLine, maxChars });
};
