import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import type { SessionCapability } from "@kako/shared";
import type { SecurityPolicy } from "../../security/policy-store.js";
import { isDeniedSecretPath } from "../../security/secret-guard.js";
import { resolveWorkspacePath } from "./path.js";

const DEFAULT_SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "vendor",
  "coverage",
  "__pycache__",
  ".turbo",
  ".cache",
]);

const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".svg",
  ".txt",
  ".go",
  ".py",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".graphql",
  ".vue",
  ".svelte",
  ".dockerfile",
  ".env.example",
  ".gitignore",
  ".gitattributes",
]);

export interface WalkWorkspaceOptions {
  cwd: string;
  root: string;
  policy: SecurityPolicy;
  capability?: SessionCapability;
  globFilter?: string;
  skipDirNames?: Set<string>;
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function isLikelyTextFile(filePath: string): boolean {
  const base = basename(filePath);
  if (base === "Dockerfile" || base === "Makefile") return true;
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

/** Convert a simple glob (e.g. recursive `*.ts`) to RegExp over relative paths. */
export function globPatternToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  let re = "^";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (ch === "*" && normalized[i + 1] === "*") {
      if (normalized[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
      continue;
    }
    if (ch === "*") {
      re += "[^/]*";
      continue;
    }
    if (ch === "?") {
      re += "[^/]";
      continue;
    }
    re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  re += "$";
  return new RegExp(re);
}

export function pathMatchesGlob(relPath: string, globFilter?: string): boolean {
  if (!globFilter?.trim()) return true;
  const normalized = relPath.replace(/\\/g, "/");
  const re = globPatternToRegExp(globFilter.trim());
  return re.test(normalized) || re.test(basename(normalized));
}

async function walkDir(
  absDir: string,
  relPrefix: string,
  out: string[],
  options: WalkWorkspaceOptions,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  const skipDirs = options.skipDirNames ?? DEFAULT_SKIP_DIR_NAMES;
  for (const entry of entries) {
    const absPath = join(absDir, entry.name);
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      await walkDir(absPath, relPath, out, options);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!pathMatchesGlob(relPath, options.globFilter)) continue;
    if (!isLikelyTextFile(absPath)) continue;
    if (isDeniedSecretPath(absPath, options.policy)) continue;

    try {
      await resolveWorkspacePath(
        absPath,
        options.cwd,
        options.policy,
        options.capability ?? "ReadOnly",
      );
    } catch {
      continue;
    }

    try {
      const info = await stat(absPath);
      if (info.size > MAX_GREP_FILE_BYTES) continue;
    } catch {
      continue;
    }

    out.push(absPath);
  }
}

export async function listWorkspaceFiles(options: WalkWorkspaceOptions): Promise<string[]> {
  const root = resolve(options.root);
  const files: string[] = [];

  let rootStat;
  try {
    rootStat = await stat(root);
  } catch {
    throw new Error(`Path not found: ${root}`);
  }

  if (rootStat.isFile()) {
    if (pathMatchesGlob(basename(root), options.globFilter) || !options.globFilter) {
      files.push(root);
    }
    return files;
  }

  if (!rootStat.isDirectory()) {
    throw new Error(`Not a file or directory: ${root}`);
  }

  await walkDir(root, "", files, options);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

export async function readWorkspaceTextFile(filePath: string): Promise<string | null> {
  try {
    const buf = await readFile(filePath);
    if (looksBinary(buf)) return null;
    return buf.toString("utf-8");
  } catch {
    return null;
  }
}

export function relativeDisplayPath(filePath: string, cwd: string): string {
  const rel = relative(cwd, filePath);
  return rel && !rel.startsWith("..") ? rel : filePath;
}
