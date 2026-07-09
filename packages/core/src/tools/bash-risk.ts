/** Redirects, subshells, and verbs with side effects — checked per segment. */
const DANGEROUS_SEGMENT_PATTERN =
  />>?|<|\$\(|`|\brm\b|\bmv\b|\bsudo\b|\bcurl\b|\bwget\b|\bchmod\b|\bchown\b|\bkill\b|\bdd\b|\btee\b|\bscp\b|\bssh\b/;

const COMPOUND_SPLIT = /\s*(?:&&|\|\||;|\|)\s*/;

/** Background job suffix (`cmd &`) — not read-only inspection. */
const BACKGROUND_PATTERN = /(?:^|\s)&\s*$/;

const READ_ONLY_COMMANDS = new Set([
  "ls",
  "pwd",
  "cd",
  "cat",
  "head",
  "tail",
  "wc",
  "file",
  "stat",
  "which",
  "type",
  "echo",
  "mkdir",
  "tree",
  "du",
  "df",
  "printenv",
  "date",
  "whoami",
  "uname",
  "grep",
  "rg",
  "find",
]);

function normalizedCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function isLowRiskSingleSegment(segment: string): boolean {
  const seg = normalizedCommand(segment);
  if (!seg) return true;
  if (BACKGROUND_PATTERN.test(seg)) return false;
  if (DANGEROUS_SEGMENT_PATTERN.test(seg)) return false;

  const first = firstToken(seg);
  if (first === "git") {
    return /^git\s+(status|log|diff|show|branch|remote|rev-parse|describe)\b/.test(seg);
  }
  if (first === "find") {
    return !/\s-(exec|delete)\b/.test(seg);
  }
  if (first === "npm" || first === "pnpm" || first === "yarn") {
    return /^(npm|pnpm|yarn)\s+(list|ls|view|outdated|why|explain)\b/.test(seg);
  }
  if (first === "python" || first === "python3" || first === "node") {
    return /\s+(-V|--version)\s*$/.test(seg) || /\s+--help\s*$/.test(seg);
  }

  return READ_ONLY_COMMANDS.has(first);
}

/** True when a Bash invocation is read-only / low impact and can skip user confirmation. */
export function isLowRiskBashCommand(command: string): boolean {
  const cmd = normalizedCommand(command);
  if (!cmd) return true;

  const segments = cmd.split(COMPOUND_SPLIT).filter((part) => part.trim());
  if (!segments.length) return true;
  return segments.every(isLowRiskSingleSegment);
}
