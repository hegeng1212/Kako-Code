import type { SkillHubAnalyzeRepoResult } from "@kako/shared";
import { parseSkillMd } from "./loader.js";
import { installSkillFromContent } from "./archive.js";
import type { InstalledSkillRecord } from "@kako/shared";

const GITHUB_API = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";

export interface ParsedGithubRepo {
  owner: string;
  repo: string;
  branch?: string;
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
  const branchMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/tree\/([^/]+)/i);
  return {
    owner: match[1]!,
    repo: match[2]!,
    branch: branchMatch?.[1],
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

interface GithubContentEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  download_url?: string | null;
}

async function listRepoPath(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<GithubContentEntry[]> {
  const data = await githubFetch<GithubContentEntry[] | GithubContentEntry>(
    `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
  );
  return Array.isArray(data) ? data : [data];
}

async function fetchRawText(owner: string, repo: string, path: string, ref: string): Promise<string> {
  const url = `${RAW_BASE}/${owner}/${repo}/${ref}/${path}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path} (${res.status})`);
  }
  return res.text();
}

async function discoverSkillPaths(
  owner: string,
  repo: string,
  ref: string,
): Promise<string[]> {
  const roots = ["skills", "."];
  const skillPaths: string[] = [];

  for (const root of roots) {
    let entries: GithubContentEntry[];
    try {
      entries = await listRepoPath(owner, repo, root === "." ? "" : root, ref);
    } catch {
      continue;
    }

    if (root === ".") {
      const hasRootSkill = entries.some((e) => e.name === "SKILL.md" && e.type === "file");
      if (hasRootSkill) skillPaths.push("SKILL.md");
      continue;
    }

    for (const entry of entries) {
      if (entry.type !== "dir") continue;
      const skillMdPath = `${entry.path}/SKILL.md`;
      try {
        await fetchRawText(owner, repo, skillMdPath, ref);
        skillPaths.push(skillMdPath);
      } catch {
        // not a skill directory
      }
    }
    if (skillPaths.length > 0) break;
  }

  return skillPaths;
}

export async function analyzeGithubRepoDirect(url: string): Promise<SkillHubAnalyzeRepoResult> {
  const parsed = parseGithubRepoUrl(url);
  const branch = parsed.branch ?? (await resolveDefaultBranch(parsed.owner, parsed.repo));
  const skillMdPaths = await discoverSkillPaths(parsed.owner, parsed.repo, branch);

  if (skillMdPaths.length === 0) {
    throw new Error("No SKILL.md files found in this repository (checked skills/ and repo root)");
  }

  const skills = await Promise.all(
    skillMdPaths.map(async (path) => {
      const raw = await fetchRawText(parsed.owner, parsed.repo, path, branch);
      const skill = parseSkillMd(raw, path);
      const dirPath = path.endsWith("/SKILL.md") ? path.slice(0, -"/SKILL.md".length) : path;
      return {
        path: dirPath,
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

  const installed: InstalledSkillRecord[] = [];
  for (const dirPath of paths) {
    const skillMdPath = dirPath.endsWith("SKILL.md") ? dirPath : `${dirPath}/SKILL.md`;
    const raw = await fetchRawText(parsed.owner, parsed.repo, skillMdPath, branch);
    const record = await installSkillFromContent(raw, "github");
    installed.push({
      ...record,
      slug: `${info.repoFullName}/${record.name}`,
    });
  }
  return installed;
}
