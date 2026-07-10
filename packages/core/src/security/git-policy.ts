/** Safe git subcommands — no confirmation when bash tier is safe. */
export const GIT_SAFE_COMMANDS = [
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "rev-parse",
  "describe",
  "shortlog",
] as const;

/** Risky git subcommands — require approval. */
export const GIT_RISKY_COMMANDS = [
  "commit",
  "push",
  "pull",
  "merge",
  "rebase",
  "reset",
  "checkout",
  "cherry-pick",
  "tag",
  "stash",
  "clone",
  "fetch",
  "add",
  "restore",
  "switch",
] as const;

/** Dangerous git invocations — deny or always confirm per policy. */
export const GIT_DANGEROUS_PATTERNS = [
  /\bgit\s+push\s+.*--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-z]*f/,
  /\bgit\s+filter-branch\b/,
] as const;
