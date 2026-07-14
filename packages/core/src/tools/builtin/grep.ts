import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { loadSecurityPolicy } from "../../security/policy-store.js";
import { isDeniedSecretPath } from "../../security/secret-guard.js";
import { resolveWorkspacePath } from "./path.js";
import {
  listWorkspaceFiles,
  readWorkspaceTextFile,
  relativeDisplayPath,
} from "./workspace-walk.js";

export const GREP_DESCRIPTION = `Search file contents in the workspace using a regular expression.

- \`pattern\` is a JavaScript regular expression (not grep(1) syntax).
- \`path\` is optional — file or directory to search. Relative paths resolve from the session cwd.
- \`glob\` filters which files are searched (e.g. \`*.ts\` or recursive ts patterns).
- \`output_mode\`: \`content\` (default) shows matching lines; \`files_with_matches\` lists paths only; \`count\` shows per-file match counts.
- \`head_limit\` caps total matches returned (default 100).
- Use Read for full file contents after locating candidates with Grep.`;

export type GrepOutputMode = "content" | "files_with_matches" | "count";

export interface ParsedGrepInput {
  pattern: string;
  path: string;
  glob?: string;
  outputMode: GrepOutputMode;
  headLimit: number;
  caseInsensitive: boolean;
  multiline: boolean;
}

const DEFAULT_HEAD_LIMIT = 100;

export function parseGrepInput(raw: Record<string, unknown>, cwd: string): ParsedGrepInput {
  const pattern = String(raw.pattern ?? "").trim();
  if (!pattern) {
    throw new Error("Grep requires pattern");
  }

  const pathRaw = String(raw.path ?? cwd).trim() || cwd;
  const path = isAbsolute(pathRaw) ? pathRaw : resolve(cwd, pathRaw);

  const outputRaw = String(raw.output_mode ?? "content").trim() as GrepOutputMode;
  const outputMode: GrepOutputMode =
    outputRaw === "files_with_matches" || outputRaw === "count" ? outputRaw : "content";

  const headLimitRaw = raw.head_limit;
  const headLimit =
    typeof headLimitRaw === "number" && headLimitRaw > 0
      ? Math.min(headLimitRaw, 1000)
      : DEFAULT_HEAD_LIMIT;

  const glob = raw.glob !== undefined ? String(raw.glob).trim() : undefined;
  const caseInsensitive = raw.case_insensitive === true || raw["-i"] === true;
  const multiline = raw.multiline === true;

  return { pattern, path, glob, outputMode, headLimit, caseInsensitive, multiline };
}

export function compileGrepRegex(pattern: string, opts: Pick<ParsedGrepInput, "caseInsensitive" | "multiline">): RegExp {
  try {
    return new RegExp(pattern, `${opts.caseInsensitive ? "i" : ""}${opts.multiline ? "m" : ""}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid Grep pattern: ${message}`);
  }
}

export interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

export function grepFileContent(
  filePath: string,
  content: string,
  regex: RegExp,
  remaining: number,
): { matches: GrepMatch[]; remaining: number } {
  const matches: GrepMatch[] = [];
  const lines = content.split("\n");
  let left = remaining;

  if (regex.flags.includes("m")) {
    const m = content.match(regex);
    if (m && left > 0) {
      matches.push({ filePath, lineNumber: 1, line: m[0] });
      left--;
    }
    return { matches, remaining: left };
  }

  for (let i = 0; i < lines.length; i++) {
    if (left <= 0) break;
    const line = lines[i] ?? "";
    if (regex.test(line)) {
      matches.push({ filePath, lineNumber: i + 1, line });
      left--;
      regex.lastIndex = 0;
    }
  }
  return { matches, remaining: left };
}

export function formatGrepOutput(
  matches: GrepMatch[],
  mode: GrepOutputMode,
  cwd: string,
): string {
  if (!matches.length) {
    return "No matches found.";
  }

  if (mode === "files_with_matches") {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const m of matches) {
      const display = relativeDisplayPath(m.filePath, cwd);
      if (seen.has(display)) continue;
      seen.add(display);
      lines.push(display);
    }
    return lines.join("\n");
  }

  if (mode === "count") {
    const counts = new Map<string, number>();
    for (const m of matches) {
      const display = relativeDisplayPath(m.filePath, cwd);
      counts.set(display, (counts.get(display) ?? 0) + 1);
    }
    return [...counts.entries()].map(([path, count]) => `${path}:${count}`).join("\n");
  }

  return matches
    .map((m) => {
      const display = relativeDisplayPath(m.filePath, cwd);
      return `${display}:${m.lineNumber}:${m.line}`;
    })
    .join("\n");
}

export const grepToolDefinition: ToolDefinition = {
  name: "Grep",
  description: GREP_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pattern: {
        type: "string",
        description: "Regular expression pattern to search for",
      },
      path: {
        type: "string",
        description: "File or directory to search (relative to cwd or absolute)",
      },
      glob: {
        type: "string",
        description: 'Optional glob filter (e.g. "*.ts", "**/*.go")',
      },
      output_mode: {
        type: "string",
        enum: ["content", "files_with_matches", "count"],
        description: "Output format",
      },
      head_limit: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: 1000,
        description: "Maximum number of matches to return",
      },
      case_insensitive: {
        type: "boolean",
        description: "Case insensitive search",
      },
      multiline: {
        type: "boolean",
        description: "Enable multiline mode (^ and $ match line boundaries)",
      },
    },
    required: ["pattern"],
  },
};

export const grepHandler: ToolHandler = async (input, context) => {
  const parsed = parseGrepInput(input, context.cwd);
  const policy = await loadSecurityPolicy(context.cwd);

  if (isDeniedSecretPath(parsed.path, policy)) {
    throw new Error(`Access denied: ${parsed.path} contains sensitive configuration`);
  }

  await resolveWorkspacePath(
    parsed.path,
    context.cwd,
    policy,
    context.getCapability?.() ?? "ReadOnly",
  );

  let pathStat;
  try {
    pathStat = await stat(parsed.path);
  } catch {
    throw new Error(`Path not found: ${parsed.path}`);
  }

  const regex = compileGrepRegex(parsed.pattern, parsed);
  const files = await listWorkspaceFiles({
    cwd: context.cwd,
    root: parsed.path,
    policy,
    capability: context.getCapability?.() ?? "ReadOnly",
    globFilter: parsed.glob,
  });

  if (!files.length) {
    return pathStat.isDirectory() ? "No searchable files found." : "No matches found.";
  }

  const allMatches: GrepMatch[] = [];
  let remaining = parsed.headLimit;

  for (const filePath of files) {
    if (remaining <= 0) break;
    const content = await readWorkspaceTextFile(filePath);
    if (content == null) continue;
    const result = grepFileContent(filePath, content, regex, remaining);
    allMatches.push(...result.matches);
    remaining = result.remaining;
  }

  return formatGrepOutput(allMatches, parsed.outputMode, context.cwd);
};
