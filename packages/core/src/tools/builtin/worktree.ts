import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { WorktreeSessionInfo } from "@kako/shared";

const execFileAsync = promisify(execFile);

export type { WorktreeSessionInfo as WorktreeSessionState };

export interface ParsedWorktreeEntry {
  path: string;
  branch?: string;
}

export async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function isGitRepository(dir: string): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--git-dir"], dir);
    return true;
  } catch {
    return false;
  }
}

export async function gitRepoRoot(dir: string): Promise<string> {
  return resolve(await runGit(["rev-parse", "--show-toplevel"], dir));
}

export function kakoWorktreesDir(repoRoot: string): string {
  return join(repoRoot, ".kako", "worktrees");
}

export function validateWorktreeName(name: string): void {
  if (!name || name.length > 64) {
    throw new Error("Worktree name must be 1-64 characters");
  }
  for (const segment of name.split("/")) {
    if (!segment || !/^[a-zA-Z0-9._-]+$/.test(segment)) {
      throw new Error(
        'Each "/" segment may contain only letters, digits, dots, underscores, and dashes',
      );
    }
  }
}

export function generateWorktreeName(): string {
  return `wt-${randomUUID().slice(0, 8)}`;
}

export function branchNameForWorktree(name: string): string {
  return `kako-worktree/${name}`;
}

/** Parse `git worktree list --porcelain` output. */
export function parseWorktreeListPorcelain(output: string): ParsedWorktreeEntry[] {
  const entries: ParsedWorktreeEntry[] = [];
  let currentPath = "";
  let currentBranch: string | undefined;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (currentPath) {
        entries.push({ path: currentPath, branch: currentBranch });
      }
      currentPath = line.slice("worktree ".length).trim();
      currentBranch = undefined;
      continue;
    }
    if (line.startsWith("branch ")) {
      currentBranch = line.slice("branch ".length).trim();
    }
  }
  if (currentPath) {
    entries.push({ path: currentPath, branch: currentBranch });
  }
  return entries;
}

export async function listRegisteredWorktrees(repoRoot: string): Promise<ParsedWorktreeEntry[]> {
  const out = await runGit(["worktree", "list", "--porcelain"], repoRoot);
  return parseWorktreeListPorcelain(out);
}

export function worktreePathIsRegistered(
  entries: ParsedWorktreeEntry[],
  absolutePath: string,
): boolean {
  const target = resolve(absolutePath);
  return entries.some((entry) => resolve(entry.path) === target);
}

export async function resolveWorktreeBaseRef(
  repoRoot: string,
  mode: "fresh" | "head" = "fresh",
): Promise<string> {
  if (mode === "head") return "HEAD";
  for (const ref of ["origin/HEAD", "origin/main", "origin/master"]) {
    try {
      await runGit(["rev-parse", "--verify", ref], repoRoot);
      return ref;
    } catch {
      // try next
    }
  }
  return "HEAD";
}

export async function createGitWorktree(opts: {
  repoRoot: string;
  name: string;
  baseRef?: "fresh" | "head";
}): Promise<{ worktreePath: string; branch: string }> {
  const { repoRoot, name } = opts;
  validateWorktreeName(name);
  const branch = branchNameForWorktree(name);
  const parent = kakoWorktreesDir(repoRoot);
  await mkdir(parent, { recursive: true });
  const worktreePath = join(parent, name);
  const baseRef = await resolveWorktreeBaseRef(repoRoot, opts.baseRef ?? "fresh");
  await runGit(["worktree", "add", "-b", branch, worktreePath, baseRef], repoRoot);
  return { worktreePath: resolve(worktreePath), branch };
}

export async function removeGitWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await runGit(["worktree", "remove", "--force", worktreePath], repoRoot);
}

async function resolveDefaultBaseRef(repoRoot: string): Promise<string> {
  for (const ref of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
    try {
      await runGit(["rev-parse", "--verify", ref], repoRoot);
      return ref;
    } catch {
      // try next
    }
  }
  return "HEAD";
}

/** Lists uncommitted files and branch-only commits that block worktree removal. */
export async function listWorktreeRemovalBlockers(worktreePath: string): Promise<string[]> {
  const blockers: string[] = [];
  const repoRoot = await gitRepoRoot(worktreePath);

  const status = await runGit(["status", "--porcelain"], worktreePath).catch(() => "");
  if (status.trim()) {
    blockers.push("Uncommitted changes:");
    blockers.push(status);
  }

  const baseRef = await resolveDefaultBaseRef(repoRoot);
  try {
    const ahead = await runGit(["rev-list", "--count", `${baseRef}..HEAD`], worktreePath);
    if (Number(ahead) > 0) {
      const log = await runGit(["log", "--oneline", `${baseRef}..HEAD`], worktreePath);
      blockers.push(`Commits not on ${baseRef}:`);
      blockers.push(log);
    }
  } catch {
    // ignore compare failures
  }

  return blockers;
}
