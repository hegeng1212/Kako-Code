import { ansi, displayWidth } from "./ansi.js";

/**
 * VS Code Dark+ token colors (256-color approximations).
 * @see https://github.com/microsoft/vscode/blob/main/extensions/theme-defaults/themes/dark_plus.json
 */
const darkPlus = {
  /** keyword — #569CD6 */
  keyword: "\x1b[38;5;75m",
  /** string — #CE9178 */
  string: "\x1b[38;5;173m",
  /** comment — #6A9955 */
  comment: "\x1b[38;5;65m",
  /** number — #B5CEA8 */
  number: "\x1b[38;5;151m",
  /** function — #DCDCAA */
  function: "\x1b[38;5;187m",
  /** type / class — #4EC9B0 */
  type: "\x1b[38;5;79m",
  /** variable / property key — #9CDCFE */
  variable: "\x1b[38;5;117m",
  /** punctuation / default — editor foreground */
  foreground: ansi.text,
  /** dim punctuation */
  punctuation: ansi.muted,
} as const;

function paint(color: string, text: string): string {
  if (!text) return text;
  return `${color}${text}${ansi.reset}`;
}

/** Clip source to a display-column budget (CJK-aware). */
export function clipToDisplayWidth(text: string, maxWidth: number): string {
  if (maxWidth < 1) return "";
  if (displayWidth(text) <= maxWidth) return text;
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = displayWidth(ch);
    if (w + cw > maxWidth) break;
    out += ch;
    w += cw;
  }
  return out;
}

/**
 * Clip ANSI-colored text by display width without stripping colors.
 * Always ends with reset so truncated cells cannot leak styles.
 */
export function clipAnsiToDisplayWidth(text: string, maxWidth: number): string {
  if (maxWidth < 1) return ansi.reset;
  if (displayWidth(text) <= maxWidth) return text;
  let out = "";
  let w = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\x1b") {
      const m = /^\x1b\[[0-9;]*m/.exec(text.slice(i));
      if (m) {
        out += m[0]!;
        i += m[0]!.length;
        continue;
      }
    }
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const cw = displayWidth(ch);
    if (w + cw > maxWidth) break;
    out += ch;
    w += cw;
    i += ch.length;
  }
  return `${out}${ansi.reset}`;
}

function normalizeLang(language?: string): string {
  const lang = (language ?? "").trim().toLowerCase();
  if (!lang) return "plain";
  if (lang === "typescript" || lang === "ts" || lang === "tsx" || lang === "javascript" || lang === "js" || lang === "jsx") {
    return "js";
  }
  if (lang === "golang" || lang === "go") return "go";
  if (lang === "py" || lang === "python") return "python";
  if (lang === "json" || lang === "jsonc") return "json";
  return lang;
}

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
  "interface",
  "type",
  "enum",
  "implements",
  "private",
  "public",
  "protected",
  "static",
  "readonly",
]);

const GO_KEYWORDS = new Set([
  "break",
  "case",
  "chan",
  "const",
  "continue",
  "default",
  "defer",
  "else",
  "fallthrough",
  "for",
  "func",
  "go",
  "goto",
  "if",
  "import",
  "interface",
  "map",
  "package",
  "range",
  "return",
  "select",
  "struct",
  "switch",
  "type",
  "var",
  "true",
  "false",
  "nil",
]);

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

function highlightGenericLineBody(line: string, keywords: Set<string>): string {
  const parts = line.split(
    /(\/\/.*$|#.*$|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b|\s+|[^\s\w'".`#]+)/g,
  );
  return parts
    .map((token, index) => {
      if (!token) return token;
      if (/^(\/\/|#)/.test(token)) return paint(darkPlus.comment, token);
      if (/^['"`]/.test(token)) return paint(darkPlus.string, token);
      if (/^\d/.test(token)) return paint(darkPlus.number, token);
      if (keywords.has(token)) return paint(darkPlus.keyword, token);
      // function / method call: Ident(
      const next = parts.slice(index + 1).find((p) => p && !/^\s+$/.test(p));
      if (/^[A-Za-z_]\w*$/.test(token) && next?.startsWith("(")) {
        return paint(darkPlus.function, token);
      }
      // Exported / type-like identifiers (PascalCase) — Dark+ type/class
      if (/^[A-Z][A-Za-z0-9_]*$/.test(token)) {
        return paint(darkPlus.type, token);
      }
      return paint(darkPlus.foreground, token);
    })
    .join("");
}

function highlightGenericLine(line: string, keywords: Set<string>): string {
  const ordinal = /^(\s*\d+\.\s+)/.exec(line);
  if (ordinal) {
    return paint(darkPlus.foreground, ordinal[1]!) + highlightGenericLineBody(line.slice(ordinal[1]!.length), keywords);
  }
  return highlightGenericLineBody(line, keywords);
}

function highlightJsonLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
    return paint(darkPlus.comment, line);
  }
  const parts = line.split(/("(?:\\.|[^"\\])*")|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\s+)|([^\s"]+)/g);
  let expectingKey = true;
  return parts
    .map((token) => {
      if (!token) return token;
      if (/^\s+$/.test(token)) return token;
      if (token === "{" || token === "}" || token === "[" || token === "]" || token === "," || token === ":") {
        if (token === "{" || token === ",") expectingKey = true;
        if (token === ":") expectingKey = false;
        return paint(darkPlus.punctuation, token);
      }
      if (/^"/.test(token)) {
        if (expectingKey) {
          expectingKey = false;
          return paint(darkPlus.variable, token);
        }
        return paint(darkPlus.string, token);
      }
      if (/^(true|false|null)$/.test(token)) return paint(darkPlus.keyword, token);
      if (/^-?\d/.test(token)) return paint(darkPlus.number, token);
      return paint(darkPlus.foreground, token);
    })
    .join("");
}

/** Syntax-highlight one fenced-code line (VS Code Dark+ roles). */
export function highlightCodeLine(line: string, language?: string): string {
  const lang = normalizeLang(language);
  if (lang === "json") return highlightJsonLine(line);
  if (lang === "go") return highlightGenericLine(line, GO_KEYWORDS);
  if (lang === "python") return highlightGenericLine(line, PY_KEYWORDS);
  if (lang === "js") return highlightGenericLine(line, JS_KEYWORDS);
  // Unknown fence: still color strings / numbers / call-like idents.
  return highlightGenericLine(line, new Set());
}
