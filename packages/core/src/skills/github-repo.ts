import type { SkillHubAnalyzeRepoResult } from "@kako/shared";
import { parseSkillMd } from "./loader.js";
import { installSkillFromDirectory, skillDirPrefixFromMdPath } from "./archive.js";
import type { InstalledSkillRecord } from "@kako/shared";

const GITHUB_API = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";

export interface ParsedGithubRepo {
  owner: string;
  repo: string;
  branch?: string;
  /** Path inside the repo from /tree/{branch}/… URLs, e.g. skills/brainstorming */
  subpath?: string;
}

interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "kako-skills",
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function parseGithubRepoUrl(url: string): ParsedGithubRepo {
  const trimmed = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const match = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+)/i);
  if (!match) {
    throw new Error("Invalid GitHub URL. Example: https://github.com/owner/repo");
  }
  const treeMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/tree\/([^/]+)(?:\/(.*))?/i);
  const subpathRaw = treeMatch?.[2];
  return {
    owner: match[1]!,
    repo: match[2]!,
    branch: treeMatch?.[1],
    subpath: subpathRaw ? decodeURIComponent(subpathRaw).replace(/\/+$/, "") : undefined,
  };
}

async function githubFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function resolveDefaultBranch(owner: string, repo: string): Promise<string> {
  const info = await githubFetch<{ default_branch: string }>(`/repos/${owner}/${repo}`);
  return info.default_branch;
}

async function listRepoBlobsRecursive(
  owner: string,
  repo: string,
  ref: string,
): Promise<GitTreeEntry[]> {
  const commit = await githubFetch<{ commit: { tree: { sha: string } } }>(
    `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
  );
  const tree = await githubFetch<{ tree: GitTreeEntry[]; truncated?: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${commit.commit.tree.sha}?recursive=1`,
  );
  if (tree.truncated) {
    throw new Error(
      "Repository tree too large; try a URL that points at a specific skill directory",
    );
  }
  return tree.tree.filter((entry) => entry.type === "blob");
}

async function fetchRawText(owner: string, repo: string, path: string, ref: string): Promise<string> {
  const bytes = await fetchRawBytes(owner, repo, path, ref);
  return new TextDecoder("utf-8").decode(bytes);
}

async function fetchRawBytes(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<Uint8Array> {
  const url = `${RAW_BASE}/${owner}/${repo}/${ref}/${path}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path} (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function isSkillMdPath(path: string): boolean {
  return path === "SKILL.md" || path.endsWith("/SKILL.md");
}

function normalizeRepoPath(path: string): string {
  return path.replace(/^\.\/?/, "").replace(/\/$/, "");
}

function discoverSkillMdPaths(blobs: GitTreeEntry[], scopeSubpath?: string): string[] {
  let skillPaths = blobs.map((entry) => entry.path).filter(isSkillMdPath);

  if (scopeSubpath) {
    const normalized = normalizeRepoPath(scopeSubpath);
    const direct = normalized ? `${normalized}/SKILL.md` : "SKILL.md";
    if (skillPaths.includes(direct)) return [direct];

    const scopePrefix = normalized ? `${normalized}/` : "";
    skillPaths = skillPaths.filter((path) => path.startsWith(scopePrefix));
    if (skillPaths.length === 0) {
      throw new Error(`No SKILL.md found under ${normalized || "repository root"}`);
    }
    return skillPaths;
  }

  const underSkills = skillPaths.filter((path) => path.startsWith("skills/"));
  if (underSkills.length > 0) return underSkills;

  if (skillPaths.includes("SKILL.md")) return ["SKILL.md"];

  return skillPaths;
}

async function fetchDirectoryContents(
  owner: string,
  repo: string,
  dirPath: string,
  ref: string,
  blobs?: GitTreeEntry[],
): Promise<Record<string, Uint8Array>> {
  const normalized = normalizeRepoPath(dirPath);
  const prefix = normalized ? `${normalized}/` : "";
  const allBlobs = blobs ?? (await listRepoBlobsRecursive(owner, repo, ref));

  const targets = allBlobs.filter((entry) => {
    if (normalized) return entry.path.startsWith(prefix);
    return true;
  });

  const files: Record<string, Uint8Array> = {};
  await Promise.all(
    targets.map(async (blob) => {
      const rel = normalized ? blob.path.slice(prefix.length) : blob.path;
      if (!rel) return;
      files[rel] = await fetchRawBytes(owner, repo, blob.path, ref);
    }),
  );
  return files;
}

export async function analyzeGithubRepoDirect(url: string): Promise<SkillHubAnalyzeRepoResult> {
  const parsed = parseGithubRepoUrl(url);
  const branch = parsed.branch ?? (await resolveDefaultBranch(parsed.owner, parsed.repo));
  const blobs = await listRepoBlobsRecursive(parsed.owner, parsed.repo, branch);
  const skillMdPaths = discoverSkillMdPaths(blobs, parsed.subpath);

  if (skillMdPaths.length === 0) {
    throw new Error("No SKILL.md files found in this repository");
  }

  const skills = await Promise.all(
    skillMdPaths.map(async (path) => {
      const raw = await fetchRawText(parsed.owner, parsed.repo, path, branch);
      const skill = parseSkillMd(raw, path);
      const dirPath = skillDirPrefixFromMdPath(path);
      return {
        path: dirPath || ".",
        slug: skill.name,
        name: skill.name,
        description: skill.description || dirPath.split("/").pop() || skill.name,
      };
    }),
  );

  return {
    repoFullName: `${parsed.owner}/${parsed.repo}`,
    defaultBranch: branch,
    skills,
  };
}

export async function installSkillsFromGithubDirect(
  repoUrl: string,
  selectedPaths: string[],
  analyzed?: SkillHubAnalyzeRepoResult,
): Promise<InstalledSkillRecord[]> {
  const info = analyzed ?? (await analyzeGithubRepoDirect(repoUrl));
  const parsed = parseGithubRepoUrl(repoUrl);
  const branch = info.defaultBranch || parsed.branch || (await resolveDefaultBranch(parsed.owner, parsed.repo));
  const paths =
    selectedPaths.length > 0 ? selectedPaths : info.skills.map((skill) => skill.path);

  const blobs = await listRepoBlobsRecursive(parsed.owner, parsed.repo, branch);
  const installed: InstalledSkillRecord[] = [];
  for (const dirPath of paths) {
    const normalized = dirPath === "." ? "" : normalizeRepoPath(dirPath);
    const files = await fetchDirectoryContents(parsed.owner, parsed.repo, normalized, branch, blobs);
    const record = await installSkillFromDirectory(files, "github");
    installed.push({
      ...record,
      slug: `${info.repoFullName}/${record.name}`,
    });
  }
  return installed;
}
