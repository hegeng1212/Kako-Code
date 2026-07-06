import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import type { InstalledSkillRecord, SkillSource } from "@kako/shared";
import { getSkillsDir } from "../config/paths.js";
import { parseSkillMd } from "./loader.js";
import { skillInstallDirForName } from "./install-path.js";
import { upsertInstalledSkill } from "./manifest.js";

export async function installSkillFromContent(
  skillMdRaw: string,
  source: SkillSource = "local",
): Promise<InstalledSkillRecord> {
  const previewPath = join(getSkillsDir(), "_preview", "SKILL.md");
  const parsed = parseSkillMd(skillMdRaw, previewPath);
  const installDir = skillInstallDirForName(parsed.name);
  await mkdir(installDir, { recursive: true });
  const skillMdPath = join(installDir, "SKILL.md");
  await writeFile(skillMdPath, skillMdRaw, "utf-8");

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

function decodeEntry(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
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
    const raw = decodeEntry(entries[entryPath]!);
    installed.push(await installSkillFromContent(raw, "archive"));
  }
  return installed;
}
