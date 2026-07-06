import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { InstalledSkillRecord, SkillsManifest } from "@kako/shared";
import { getInstalledSkillsManifestPath } from "../config/paths.js";

const EMPTY: SkillsManifest = { skills: [] };

export async function loadSkillsManifest(): Promise<SkillsManifest> {
  try {
    const raw = await readFile(getInstalledSkillsManifestPath(), "utf-8");
    const parsed = JSON.parse(raw) as SkillsManifest;
    return { skills: Array.isArray(parsed.skills) ? parsed.skills : [] };
  } catch {
    return { ...EMPTY, skills: [] };
  }
}

export async function saveSkillsManifest(manifest: SkillsManifest): Promise<void> {
  const path = getInstalledSkillsManifestPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf-8");
}

export async function upsertInstalledSkill(record: InstalledSkillRecord): Promise<InstalledSkillRecord> {
  const manifest = await loadSkillsManifest();
  const next = manifest.skills.filter((s) => s.name !== record.name);
  next.push(record);
  next.sort((a, b) => a.name.localeCompare(b.name));
  await saveSkillsManifest({ skills: next });
  return record;
}

export async function removeInstalledSkill(name: string): Promise<boolean> {
  const manifest = await loadSkillsManifest();
  const next = manifest.skills.filter((s) => s.name !== name);
  if (next.length === manifest.skills.length) return false;
  await saveSkillsManifest({ skills: next });
  return true;
}

export async function getInstalledSkill(name: string): Promise<InstalledSkillRecord | undefined> {
  const manifest = await loadSkillsManifest();
  return manifest.skills.find((s) => s.name === name);
}

export async function setSkillEnabled(
  name: string,
  enabled: boolean,
): Promise<InstalledSkillRecord | null> {
  const manifest = await loadSkillsManifest();
  const skill = manifest.skills.find((s) => s.name === name);
  if (!skill) return null;
  skill.enabled = enabled;
  await saveSkillsManifest({ skills: manifest.skills });
  return skill;
}
