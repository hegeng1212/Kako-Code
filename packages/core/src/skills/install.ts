import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { InstalledSkillRecord, SkillHubImportResult } from "@kako/shared";
import { getSkillsDir } from "../config/paths.js";
import { parseSkillMd } from "./loader.js";
import { skillInstallDirForName } from "./install-path.js";
import {
  analyzeSkillHubRepo,
  fetchSkillHubSkill,
  importSkillHubRepo,
  recordSkillHubInstall,
  resolveSkillHubInstallSlug,
  type SkillHubSkillResponse,
} from "./skillhub-client.js";
import { analyzeGithubRepoDirect, installSkillsFromGithubDirect } from "./github-repo.js";
import { getInstalledSkill, loadSkillsManifest, removeInstalledSkill, upsertInstalledSkill } from "./manifest.js";

async function writeSkillFromHubResponse(
  data: SkillHubSkillResponse,
  slug: string,
  totalInstalls?: number,
): Promise<InstalledSkillRecord> {
  const previewPath = join(getSkillsDir(), "_preview", "SKILL.md");
  const parsed = parseSkillMd(data.latestVersion.skillMdRaw, previewPath);
  const installDir = skillInstallDirForName(parsed.name);
  await mkdir(installDir, { recursive: true });
  const skillMdPath = join(installDir, "SKILL.md");
  await writeFile(skillMdPath, data.latestVersion.skillMdRaw, "utf-8");
  const record: InstalledSkillRecord = {
    name: parsed.name,
    slug: data.skill.displaySlug ?? slug,
    description: parsed.description || data.skill.description,
    source: "skillhub",
    version: data.latestVersion.version,
    versionId: data.latestVersion.id,
    commitSha: data.latestVersion.commitSha,
    installDir: resolve(installDir),
    skillMdPath: resolve(skillMdPath),
    installedAt: new Date().toISOString(),
    enabled: true,
    totalInstalls,
  };
  await upsertInstalledSkill(record);
  await recordSkillHubInstall(data.latestVersion.id);
  return record;
}

export async function installSkillFromHub(
  slug: string,
  hints?: { ownerUsername?: string; sourceIdentifier?: string; totalInstalls?: number },
): Promise<InstalledSkillRecord> {
  const normalized = resolveSkillHubInstallSlug(slug, hints);
  const data = await fetchSkillHubSkill(normalized);
  return writeSkillFromHubResponse(data, normalized, hints?.totalInstalls);
}

function slugFromImportItem(item: {
  slug?: string;
  displaySlug?: string;
  ownerUsername?: string;
}): string | null {
  if (item.displaySlug) return item.displaySlug.replace(/^@/, "");
  if (item.slug && item.slug.includes("/")) return item.slug;
  if (item.ownerUsername && item.slug) return `${item.ownerUsername}/${item.slug}`;
  return item.slug ?? null;
}

export async function installSkillsFromHubImport(result: SkillHubImportResult): Promise<InstalledSkillRecord[]> {
  const installed: InstalledSkillRecord[] = [];
  const items = [...result.imported, ...result.updated, ...result.reused];
  for (const item of items) {
    const slug = slugFromImportItem(item);
    if (!slug) continue;
    try {
      installed.push(await installSkillFromHub(slug));
    } catch {
      // skip items that cannot be fetched locally
    }
  }
  return installed;
}

export async function installSkillsFromGithub(
  repoUrl: string,
  selectedPaths: string[],
): Promise<InstalledSkillRecord[]> {
  try {
    const analyzed = await analyzeSkillHubRepo(repoUrl);
    const paths =
      selectedPaths.length > 0 ? selectedPaths : analyzed.skills.map((s) => s.path);
    const imported = await importSkillHubRepo(analyzed.repoFullName, paths);
    return installSkillsFromHubImport(imported);
  } catch {
    return installSkillsFromGithubDirect(repoUrl, selectedPaths);
  }
}

export async function analyzeGithubRepo(url: string) {
  try {
    return await analyzeSkillHubRepo(url);
  } catch {
    return analyzeGithubRepoDirect(url);
  }
}

export async function uninstallSkill(name: string): Promise<boolean> {
  const record = await getInstalledSkill(name);
  if (!record) return false;
  if (record.source !== "builtin" && record.source !== "project") {
    await rm(record.installDir, { recursive: true, force: true }).catch(() => {});
  }
  return removeInstalledSkill(name);
}

export async function listInstalledSkills(): Promise<InstalledSkillRecord[]> {
  const manifest = await loadSkillsManifest();
  return manifest.skills
    .map((skill) => ({
      ...skill,
      enabled: skill.enabled !== false,
    }))
    .sort((a, b) => {
      const aEnabled = a.enabled !== false ? 0 : 1;
      const bEnabled = b.enabled !== false ? 0 : 1;
      if (aEnabled !== bEnabled) return aEnabled - bEnabled;
      return a.name.localeCompare(b.name);
    });
}
