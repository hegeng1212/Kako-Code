import type { BashTier } from "@kako/shared";
import { isLowRiskBashCommand } from "../tools/bash-risk.js";
import { GIT_DANGEROUS_PATTERNS, GIT_RISKY_COMMANDS } from "./git-policy.js";

const DANGEROUS_PATTERN =
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|\bsudo\b|\bchmod\b|\bchown\b|\bdd\b|\bmkfs\b|\bshutdown\b|\breboot\b|\bhalt\b|\bkill\s+-9\b|\bfind\b[^|]*-delete\b|\bgit\s+clean\b|\bgit\s+push\s+.*--force|\bgit\s+reset\s+--hard|\bgit\s+filter-branch\b/;

const RISKY_GIT_PATTERN = new RegExp(
  `\\bgit\\s+(${GIT_RISKY_COMMANDS.join("|")})\\b`,
);

const NETWORK_PATTERN = /\b(curl|wget|git\s+clone|git\s+pull|git\s+push|npm\s+install|pnpm\s+install|yarn\s+add)\b/;

const HTTP_URL_IN_BASH = /https?:\/\/[^\s"'<>]+/gi;

export function extractHttpUrlsFromBash(command: string): string[] {
  const matches = command.match(HTTP_URL_IN_BASH) ?? [];
  return [...new Set(matches)];
}

export function classifyBashCommand(command: string): BashTier {
  const cmd = command.trim().replace(/\s+/g, " ");
  if (!cmd) return "safe";
  if (DANGEROUS_PATTERN.test(cmd) || GIT_DANGEROUS_PATTERNS.some((p) => p.test(cmd))) {
    return "dangerous";
  }
  if (isLowRiskBashCommand(cmd)) return "safe";
  if (RISKY_GIT_PATTERN.test(cmd) || NETWORK_PATTERN.test(cmd)) return "risky";
  return "risky";
}

export function bashRequiresNetwork(command: string): boolean {
  return NETWORK_PATTERN.test(command.trim());
}
