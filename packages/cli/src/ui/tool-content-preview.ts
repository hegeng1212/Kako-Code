import { basename } from "node:path";
import { ansi, displayWidth } from "./ansi.js";
import { wrapContentLines } from "./text-wrap.js";

const PY_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield",
]);

const DEFAULT_VISIBLE_LINES = 10;
export const DEFAULT_DIFF_CONTEXT_LINES = 3;

export type CompactDiffRow =
  | { type: "line"; line: DiffLine }
  | { type: "fold"; count: number };

const CODE_EXTENSIONS = new Set([
  ".py",
  ".pyw",
  ".pyi",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".r",
  ".lua",
  ".pl",
  ".ex",
  ".exs",
  ".erl",
  ".hs",
  ".dart",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".vue",
  ".svelte",
  ".yaml",
  ".yml",
  ".json",
  ".jsonc",
  ".toml",
]);

/** True for source/script files that use unified diff preview styling. */
export function isCodeFilePath(filePath: string): boolean {
  const name = basename(filePath).toLowerCase();
  if (name === "dockerfile" || name === "makefile" || name === "cmakelists.txt") {
    return true;
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return CODE_EXTENSIONS.has(name.slice(dot));
}

const BG_ADD = "\x1b[48;5;22m";
const BG_REMOVE = "\x1b[48;5;52m";

const PY_LINE_PART =
  /(#.*$|"""(?:\\.|[^"\\])*"""|'''(?:\\.|[^'\\])*'''|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w]*\b|\s+|[^\s\w'".]+)/g;

function nextNonSpacePart(parts: string[], fromIndex: number): string | undefined {
  for (let i = fromIndex + 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part || /^\s+$/.test(part)) continue;
    return part;
  }
  return undefined;
}

function stylePyPart(
  part: string,
  opts: { pendingDefName: boolean; funcCall: boolean },
): { text: string; pendingDefName: boolean } {
  if (!part || /^\s+$/.test(part)) {
    return { text: part, pendingDefName: opts.pendingDefName };
  }
  if (/^#.*$/.test(part)) return { text: `${ansi.muted}${part}`, pendingDefName: false };
  if (/^['"]/.test(part) || /^"""/.test(part) || /^'''/.test(part)) {
    return { text: `${ansi.green}${part}`, pendingDefName: false };
  }
  if (/^\d/.test(part)) return { text: `${ansi.blue}${part}`, pendingDefName: false };
  if (part === "def" || part === "class") {
    return { text: `${ansi.magenta}${part}`, pendingDefName: true };
  }
  if (PY_KEYWORDS.has(part)) {
    return { text: `${ansi.magenta}${part}`, pendingDefName: false };
  }
  if (opts.pendingDefName || opts.funcCall) {
    return { text: `${ansi.yellow}${part}`, pendingDefName: false };
  }
  return { text: `${ansi.text}${part}`, pendingDefName: false };
}

function highlightPyParts(parts: string[], withReset: boolean): string {
  let pendingDefName = false;
  return parts
    .map((part, index) => {
      const next = nextNonSpacePart(parts, index);
      const funcCall =
        /^[A-Za-z_]\w*$/.test(part) &&
        !PY_KEYWORDS.has(part) &&
        next === "(";
      const styled = stylePyPart(part, { pendingDefName, funcCall });
      pendingDefName = styled.pendingDefName;
      const text = styled.text;
      if (!withReset || !text || /^\s+$/.test(part)) return text;
      return `${text}${ansi.reset}`;
    })
    .join("");
}

/** Python syntax colors that preserve an active background fill. */
function highlightPyLineOnBackground(line: string, bg: string): string {
  return `${bg}${highlightPyParts(line.split(PY_LINE_PART), false)}`;
}

/** Highlight a single Python source line for terminal display. */
export function highlightPyLine(line: string): string {
  return highlightPyParts(line.split(PY_LINE_PART), true);
}

export function fileBasenameFromDetail(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) return "file";
  return basename(trimmed);
}

export function countSourceLines(source: string): number {
  if (!source) return 0;
  return source.replace(/\r\n/g, "\n").split("\n").length;
}

/** Apply an Edit tool replacement to file content (approval / preview). */
export function applyEditPreview(
  before: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): string {
  if (!oldString) return before;
  if (replaceAll) {
    return before.split(oldString).join(newString);
  }
  const idx = before.indexOf(oldString);
  if (idx === -1) return before;
  return before.slice(0, idx) + newString + before.slice(idx + oldString.length);
}

/** Reconstruct pre-edit file content from post-edit content + Edit input. */
export function reconstructBeforeEdit(
  after: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): string {
  if (!newString && oldString) return after;
  if (replaceAll) {
    return after.split(newString).join(oldString);
  }
  const idx = after.indexOf(newString);
  if (idx === -1) return after;
  return after.slice(0, idx) + oldString + after.slice(idx + newString.length);
}

function detectLanguage(path: string): "python" | "plain" {
  if (/\.pyw?$/i.test(path)) return "python";
  return "plain";
}

function highlightOnBackground(
  line: string,
  bg: string,
  language: "python" | "plain",
): string {
  if (language === "python") return highlightPyLineOnBackground(line, bg);
  return `${bg}${ansi.text}${line}`;
}

function highlightPlainLine(line: string, language: "python" | "plain"): string {
  if (language === "python") return highlightPyLine(line);
  return `${ansi.text}${line}${ansi.reset}`;
}

function codeGutterColumns(lineNumWidth: number): number {
  // │ + space + lineNo + sign
  return lineNumWidth + 3;
}

function codeInnerWidth(cols: number, indent: number, lineNumWidth: number): number {
  return Math.max(20, cols - indent - codeGutterColumns(lineNumWidth));
}

type CodeRowKind = "add" | "remove" | "context" | "code";

function rowBackground(kind: CodeRowKind): string {
  if (kind === "add") return BG_ADD;
  if (kind === "remove") return BG_REMOVE;
  if (kind === "code") return ansi.codeBg;
  return "";
}

function gutterForeground(kind: CodeRowKind): string {
  if (kind === "add") return ansi.diffAdd;
  if (kind === "remove") return ansi.diffRemove;
  return ansi.muted;
}

function renderCodeGutterRow(options: {
  pad: string;
  lineNo: string;
  sign: string;
  clipped: string;
  innerWidth: number;
  language: "python" | "plain";
  kind: CodeRowKind;
}): string {
  const { pad, lineNo, sign, clipped, innerWidth, language, kind } = options;
  const padCols = Math.max(0, innerWidth - displayWidth(clipped));
  const codePad = " ".repeat(padCols);
  const bg = rowBackground(kind);
  const bar = `${ansi.text}│${ansi.reset}`;

  if (!bg) {
    const gutter = `${bar} ${ansi.muted}${lineNo}${ansi.reset}${sign}`;
    const highlighted = highlightPlainLine(clipped, language);
    return `${pad}${gutter}${highlighted}${codePad}`;
  }

  const gutterFg = gutterForeground(kind);
  const highlighted = highlightOnBackground(clipped, bg, language);
  const gutter =
    `${bg}${ansi.text}│${ansi.reset}${bg} ${gutterFg}${lineNo}${ansi.reset}${bg}${gutterFg}${sign}${ansi.reset}${bg}`;
  return `${pad}${gutter}${highlighted}${bg}${codePad}${ansi.reset}`;
}

export interface FoldableCodeOptions {
  indent?: number;
  maxVisibleLines?: number;
  collapsed: boolean;
  filePath?: string;
}

/** Syntax-highlighted code block with optional fold (Claude Code Write preview). */
export function renderFoldableCodeLines(
  source: string,
  cols: number,
  options: FoldableCodeOptions,
): string[] {
  const indent = options.indent ?? 0;
  const maxVisible = options.maxVisibleLines ?? DEFAULT_VISIBLE_LINES;
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const language = detectLanguage(options.filePath ?? "");
  const lineNumWidth = Math.max(2, String(lines.length).length);
  const innerWidth = codeInnerWidth(cols, indent, lineNumWidth);
  const visibleCount = options.collapsed ? Math.min(maxVisible, lines.length) : lines.length;
  const out: string[] = [];
  const pad = " ".repeat(indent);

  for (let i = 0; i < visibleCount; i++) {
    const lineNo = String(i + 1).padStart(lineNumWidth);
    const raw = lines[i] ?? "";
    const clipped = raw.length > innerWidth ? `${raw.slice(0, innerWidth - 1)}…` : raw;
    out.push(
      renderCodeGutterRow({
        pad,
        lineNo,
        sign: " ",
        clipped,
        innerWidth,
        language,
        kind: "code",
      }),
    );
  }

  if (options.collapsed && lines.length > maxVisible) {
    const hidden = lines.length - maxVisible;
    out.push(`${pad}${ansi.muted}   … +${hidden} lines${ansi.reset}`);
  }

  return out;
}

/** Plain text preview for non-code files (no diff gutter or colored backgrounds). */
export function renderPlainTextPreviewLines(
  source: string,
  cols: number,
  options: {
    indent?: number;
    maxVisibleLines?: number;
    collapsed: boolean;
  },
): string[] {
  const indent = options.indent ?? 0;
  const maxVisible = options.maxVisibleLines ?? DEFAULT_VISIBLE_LINES;
  const logicalLines = source.replace(/\r\n/g, "\n").split("\n");
  const width = Math.max(20, cols - indent);
  const pad = " ".repeat(indent);
  const visibleLogical = options.collapsed
    ? logicalLines.slice(0, maxVisible)
    : logicalLines;
  const out: string[] = [];
  for (const raw of visibleLogical) {
    for (const wrapped of wrapContentLines(raw, width)) {
      out.push(`${pad}${ansi.text}${wrapped}${ansi.reset}`);
    }
  }
  if (options.collapsed && logicalLines.length > maxVisible) {
    const hidden = logicalLines.length - maxVisible;
    out.push(`${pad}${ansi.muted}   … +${hidden} lines${ansi.reset}`);
  }
  return out;
}

/** File body preview — unified diff for code, plain text for documents. */
export function renderFilePreviewLines(
  before: string,
  after: string,
  cols: number,
  options: FoldableDiffOptions,
): string[] {
  if (isCodeFilePath(options.filePath ?? "")) {
    return renderFoldableDiffLines(before, after, cols, options);
  }
  return renderPlainTextPreviewLines(after || before, cols, {
    indent: options.indent,
    maxVisibleLines: options.maxVisibleLines,
    collapsed: options.collapsed,
  });
}

export interface DiffLine {
  kind: "add" | "remove" | "context";
  text: string;
  oldLineNo?: number;
  newLineNo?: number;
}

type DiffOp =
  | { kind: "context"; text: string; oldLineNo: number; newLineNo: number }
  | { kind: "remove"; text: string; oldLineNo: number }
  | { kind: "add"; text: string; newLineNo: number };

function buildLcsTable(oldLines: string[], newLines: string[]): number[][] {
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const dp = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }
  return dp;
}

/** Unified line diff with unchanged context (Claude Code Edit preview). */
export function computeUnifiedLineDiff(before: string, after: string): DiffLine[] {
  const oldLines = before.replace(/\r\n/g, "\n").split("\n");
  const newLines = after.replace(/\r\n/g, "\n").split("\n");
  const dp = buildLcsTable(oldLines, newLines);
  const ops: DiffOp[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({
        kind: "context",
        text: oldLines[i - 1] ?? "",
        oldLineNo: i,
        newLineNo: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({ kind: "add", text: newLines[j - 1] ?? "", newLineNo: j });
      j--;
    } else if (i > 0) {
      ops.push({ kind: "remove", text: oldLines[i - 1] ?? "", oldLineNo: i });
      i--;
    }
  }

  ops.reverse();
  return ops.map((op) => {
    if (op.kind === "context") {
      return {
        kind: "context" as const,
        text: op.text,
        oldLineNo: op.oldLineNo,
        newLineNo: op.newLineNo,
      };
    }
    if (op.kind === "add") {
      return { kind: "add" as const, text: op.text, newLineNo: op.newLineNo };
    }
    return { kind: "remove" as const, text: op.text, oldLineNo: op.oldLineNo };
  });
}

/** @deprecated Use computeUnifiedLineDiff with full file before/after. */
export function computeEditDiff(oldString: string, newString: string): DiffLine[] {
  return computeUnifiedLineDiff(oldString, newString);
}

export function countEditDiffStats(before: string, after: string): {
  added: number;
  removed: number;
} {
  const diff = computeUnifiedLineDiff(before, after);
  return {
    added: diff.filter((d) => d.kind === "add").length,
    removed: diff.filter((d) => d.kind === "remove").length,
  };
}

export interface FoldableDiffOptions {
  indent?: number;
  maxVisibleLines?: number;
  /** Truncate long single-file previews (new writes). */
  collapsed?: boolean;
  /** Full diff (true) vs compact hunks around changes (false, default). */
  expanded?: boolean;
  /** Context lines shown above/below each change hunk. */
  contextLines?: number;
  filePath?: string;
}

/** Select diff rows around changes with fold markers for skipped unchanged regions. */
export function buildCompactDiffRows(
  diff: DiffLine[],
  contextLines = DEFAULT_DIFF_CONTEXT_LINES,
): CompactDiffRow[] {
  const visible = new Set<number>();
  for (let i = 0; i < diff.length; i++) {
    if (diff[i]!.kind !== "context") {
      for (
        let j = Math.max(0, i - contextLines);
        j <= Math.min(diff.length - 1, i + contextLines);
        j++
      ) {
        visible.add(j);
      }
    }
  }

  if (visible.size === 0) {
    return diff.map((line) => ({ type: "line" as const, line }));
  }

  const indices = [...visible].sort((a, b) => a - b);
  const rows: CompactDiffRow[] = [];
  if (indices[0]! > 0) {
    rows.push({ type: "fold", count: indices[0]! });
  }
  for (let k = 0; k < indices.length; k++) {
    const idx = indices[k]!;
    if (k > 0) {
      const gap = idx - indices[k - 1]! - 1;
      if (gap > 0) {
        rows.push({ type: "fold", count: gap });
      }
    }
    rows.push({ type: "line", line: diff[idx]! });
  }
  const lastIdx = indices[indices.length - 1]!;
  if (lastIdx < diff.length - 1) {
    rows.push({ type: "fold", count: diff.length - 1 - lastIdx });
  }
  return rows;
}

function diffLineNumber(row: DiffLine): number {
  return row.oldLineNo ?? row.newLineNo ?? 1;
}

function renderDiffLineRow(
  row: DiffLine,
  opts: {
    pad: string;
    lineNumWidth: number;
    innerWidth: number;
    language: "python" | "plain";
  },
): string {
  const lineNo = String(diffLineNumber(row)).padStart(opts.lineNumWidth);
  const sign = row.kind === "add" ? "+" : row.kind === "remove" ? "-" : " ";
  const raw = row.text;
  const clipped =
    raw.length > opts.innerWidth ? `${raw.slice(0, opts.innerWidth - 1)}…` : raw;
  return renderCodeGutterRow({
    pad: opts.pad,
    lineNo,
    sign,
    clipped,
    innerWidth: opts.innerWidth,
    language: opts.language,
    kind: row.kind,
  });
}

/** Green/red unified diff with compact hunks or full file view. */
export function renderFoldableDiffLines(
  before: string,
  after: string,
  cols: number,
  options: FoldableDiffOptions,
): string[] {
  const indent = options.indent ?? 0;
  const maxVisible = options.maxVisibleLines ?? DEFAULT_VISIBLE_LINES;
  const expanded = options.expanded ?? false;
  const contextLines = options.contextLines ?? DEFAULT_DIFF_CONTEXT_LINES;
  const diff = computeUnifiedLineDiff(before, after);
  const language = detectLanguage(options.filePath ?? "");
  const maxLineNo = Math.max(...diff.map(diffLineNumber), 1);
  const lineNumWidth = Math.max(2, String(maxLineNo).length);
  const innerWidth = codeInnerWidth(cols, indent, lineNumWidth);
  const out: string[] = [];
  const pad = " ".repeat(indent);
  const rowOpts = { pad, lineNumWidth, innerWidth, language };

  if (expanded) {
    const visibleCount = options.collapsed ? Math.min(maxVisible, diff.length) : diff.length;
    for (let i = 0; i < visibleCount; i++) {
      out.push(renderDiffLineRow(diff[i]!, rowOpts));
    }
    if (options.collapsed && diff.length > maxVisible) {
      const hidden = diff.length - maxVisible;
      out.push(`${pad}${ansi.muted}   … +${hidden} lines${ansi.reset}`);
    }
    return out;
  }

  const rows = buildCompactDiffRows(diff, contextLines);
  const allAdds = diff.length > 0 && diff.every((d) => d.kind === "add");
  if (allAdds && options.collapsed && diff.length > maxVisible) {
    for (let i = 0; i < maxVisible; i++) {
      out.push(renderDiffLineRow(diff[i]!, rowOpts));
    }
    const hidden = diff.length - maxVisible;
    out.push(
      `${pad}${ansi.muted}   … +${hidden} lines (click to expand)${ansi.reset}`,
    );
    return out;
  }

  for (const row of rows) {
    if (row.type === "fold") {
      const label =
        row.count === 1
          ? "1 unchanged line"
          : `${row.count} unchanged lines`;
      out.push(
        `${pad}${ansi.muted}   … ${label} (click to expand)${ansi.reset}`,
      );
      continue;
    }
    out.push(renderDiffLineRow(row.line, rowOpts));
  }

  return out;
}
