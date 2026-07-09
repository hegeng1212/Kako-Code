import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { unzipSync } from "fflate";
import type { InstalledSkillRecord, SkillSource } from "@kako/shared";
import { getSkillsDir } from "../config/paths.js";
import { parseSkillMd } from "./loader.js";
import { skillInstallDirForName } from "./install-path.js";
import { upsertInstalledSkill } from "./manifest.js";

function decodeEntry(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}

/** Directory prefix for a SKILL.md path inside an archive or repo tree. */
export function skillDirPrefixFromMdPath(skillMdPath: string): string {
  if (skillMdPath === "SKILL.md") return "";
  return skillMdPath.slice(0, -"/SKILL.md".length);
}

/** Collect all files under the skill directory from a flat path → bytes map. */
export function collectSkillDirEntries(
  allEntries: Record<string, Uint8Array>,
  skillDirPrefix: string,
): Record<string, Uint8Array> {
  const normalized = skillDirPrefix.replace(/^\.\/?/, "").replace(/\/$/, "");
  const prefix = normalized ? `${normalized}/` : "";
  const result: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(allEntries)) {
    if (path.startsWith("__MACOSX/") || path.includes("/__MACOSX/")) continue;
    if (normalized) {
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length);
      if (!rel) continue;
      result[rel] = data;
      continue;
    }
    result[path] = data;
  }
  return result;
}

export async function installSkillFromDirectory(
  files: Record<string, Uint8Array>,
  source: SkillSource = "local",
): Promise<InstalledSkillRecord> {
  const skillMdRaw = files["SKILL.md"];
  if (!skillMdRaw) {
    throw new Error("SKILL.md not found in skill directory");
  }
  const previewPath = join(getSkillsDir(), "_preview", "SKILL.md");
  const parsed = parseSkillMd(decodeEntry(skillMdRaw), previewPath);
  const installDir = skillInstallDirForName(parsed.name);
  await rm(installDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(installDir, { recursive: true });

  for (const [relPath, data] of Object.entries(files)) {
    const dest = join(installDir, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, data);
  }

  const skillMdPath = join(installDir, "SKILL.md");
  const record: InstalledSkillRecord = {
    name: parsed.name,
    description: parsed.description,
    source,
    installDir: resolve(installDir),
    skillMdPath: resolve(skillMdPath),
    installedAt: new Date().toISOString(),
    enabled: true,
  };
  await upsertInstalledSkill(record);
  return record;
}

export async function installSkillFromContent(
  skillMdRaw: string,
  source: SkillSource = "local",
): Promise<InstalledSkillRecord> {
  return installSkillFromDirectory(
    { "SKILL.md": new TextEncoder().encode(skillMdRaw) },
    source,
  );
}

function findSkillMdPaths(entries: Record<string, Uint8Array>): string[] {
  return Object.keys(entries).filter(
    (path) =>
      path.endsWith("SKILL.md") &&
      !path.startsWith("__MACOSX/") &&
      !path.includes("/__MACOSX/"),
  );
}

export async function installSkillsFromArchive(data: Buffer): Promise<InstalledSkillRecord[]> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(data)) as Record<string, Uint8Array>;
  } catch {
    throw new Error("Invalid zip archive");
  }

  const skillPaths = findSkillMdPaths(entries);
  if (skillPaths.length === 0) {
    throw new Error("No SKILL.md found in archive");
  }

  const installed: InstalledSkillRecord[] = [];
  for (const entryPath of skillPaths) {
    const dirPrefix = skillDirPrefixFromMdPath(entryPath);
    const files = collectSkillDirEntries(entries, dirPrefix);
    installed.push(await installSkillFromDirectory(files, "archive"));
  }
  return installed;
}
