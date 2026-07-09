import type { ToolCall } from "@kako/shared";
import { parseEditInput } from "./builtin/edit.js";
import { parseWriteInput } from "./builtin/write.js";

const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

function writeArgsMissing(raw: Record<string, unknown>): boolean {
  const hasPath = Boolean(String(raw.file_path ?? raw.path ?? "").trim());
  const hasContent =
    typeof raw.content === "string" || typeof raw.contents === "string";
  return !hasPath || !hasContent;
}

export function validateToolCallInput(toolCall: ToolCall): string | null {
  if (toolCall.name === "Write") {
    if (Object.keys(toolCall.input).length === 0 || writeArgsMissing(toolCall.input)) {
      return "Write arguments were incomplete (tool call may have been truncated during streaming). Retry with smaller chunks or use Bash.";
    }
    try {
      parseWriteInput(toolCall.input);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid Write input";
    }
  }

  if (toolCall.name === "Edit" || toolCall.name === "NotebookEdit") {
    try {
      parseEditInput(toolCall.input);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : `Invalid ${toolCall.name} input`;
    }
  }

  if (toolCall.name === "Bash") {
    const command = String(toolCall.input.command ?? "").trim();
    if (!command) return "Bash requires command";
    return null;
  }

  if (WRITE_TOOLS.has(toolCall.name)) {
    return null;
  }

  return null;
}
