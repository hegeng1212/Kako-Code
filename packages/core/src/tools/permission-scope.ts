import { isAbsolute, relative, resolve } from "node:path";
import type { ToolCall } from "@kako/shared";
import { getKakoHome } from "../config/paths.js";
import { resolvePath } from "./builtin/path.js";

const SCOPE_AWARE_TOOLS = new Set(["Read", "Write", "Edit", "NotebookEdit", "Bash"]);

/** True when `targetPath` equals or is nested under one of `roots` (after resolve). */
export function isPathWithinTrustedRoots(targetPath: string, roots: string[]): boolean {
  const normalized = resolve(targetPath);
  return roots.some((root) => {
    const base = resolve(root);
    if (normalized === base) return true;
    const rel = relative(base, normalized);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
}

export function trustedRootsForSession(cwd: string): string[] {
  return [resolve(cwd), resolve(getKakoHome())];
}

function filePathFromInput(input: Record<string, unknown>, cwd: string): string | null {
  const raw = input.file_path ?? input.path ?? input.notebook_path;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return resolvePath(raw, cwd);
}

/** Skip y/n confirmation when file/bash cwd targets stay inside the session cwd or ~/.kako. */
export function isToolCallInTrustedScope(toolCall: ToolCall, cwd: string): boolean {
  if (!SCOPE_AWARE_TOOLS.has(toolCall.name)) return false;

  const roots = trustedRootsForSession(cwd);
  const input = toolCall.input;

  if (
    toolCall.name === "Read" ||
    toolCall.name === "Write" ||
    toolCall.name === "Edit" ||
    toolCall.name === "NotebookEdit"
  ) {
    const path = filePathFromInput(input, cwd);
    if (!path) return false;
    return isPathWithinTrustedRoots(path, roots);
  }

  if (toolCall.name === "Bash") {
    const workDir =
      input.working_directory !== undefined && String(input.working_directory).trim()
        ? resolvePath(String(input.working_directory), cwd)
        : resolve(cwd);
    return isPathWithinTrustedRoots(workDir, roots);
  }

  return false;
}
