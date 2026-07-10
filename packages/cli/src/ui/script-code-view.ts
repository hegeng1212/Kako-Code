import { ansi } from "./ansi.js";

const JS_KEYWORDS = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "let",
  "new",
  "null",
  "of",
  "return",
  "switch",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "while",
  "yield",
]);

function highlightJsToken(token: string): string {
  if (!token) return token;
  if (/^\/\/.*/.test(token) || /^\/\*[\s\S]*?\*\//.test(token)) {
    return `${ansi.muted}${token}${ansi.reset}`;
  }
  if (/^['"`]/.test(token)) {
    return `${ansi.green}${token}${ansi.reset}`;
  }
  if (/^\d/.test(token)) {
    return `${ansi.blue}${token}${ansi.reset}`;
  }
  if (JS_KEYWORDS.has(token)) {
    return `${ansi.magenta}${token}${ansi.reset}`;
  }
  return `${ansi.text}${token}${ansi.reset}`;
}

/** Highlight a single JS source line for terminal display. */
export function highlightJsLine(line: string): string {
  const parts = line.split(/(\/\/.*$|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|\s+|[^\s\w'".`]+)/g);
  return parts.map((part) => highlightJsToken(part)).join("");
}

export function renderScriptCodeBlock(source: string, cols: number): string[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const lineNumWidth = Math.max(2, String(lines.length).length);
  const gutter = lineNumWidth + 2;
  const innerWidth = Math.max(20, cols - gutter - 4);
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = String(i + 1).padStart(lineNumWidth);
    const raw = lines[i] ?? "";
    const clipped = raw.length > innerWidth ? raw.slice(0, innerWidth) : raw;
    const highlighted = highlightJsLine(clipped);
    out.push(
      `${ansi.line}│${ansi.reset} ${ansi.muted}${lineNo}${ansi.reset} ${ansi.line}${ansi.codeBg}${highlighted}${" ".repeat(Math.max(0, innerWidth - clipped.length))} ${ansi.reset}`,
    );
  }

  if (!lines.length) {
    out.push(`${ansi.line}│${ansi.reset} ${ansi.muted}(empty)${ansi.reset}`);
  }

  return out;
}
