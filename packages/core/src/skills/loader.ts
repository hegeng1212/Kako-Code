import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { InstalledSkillRecord, SkillDefinition, SkillMetadata } from "@kako/shared";
import { findBundledSkillsDir } from "../config/bundled-assets.js";
import { getSkillsDir } from "../config/paths.js";
import { loadSkillsManifest } from "./manifest.js";
import { isSystemSkill, loadSystemSkills, mergeSkillsForAgent } from "./system-skills.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export function skillNameCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const candidates = [trimmed];
  const colonIdx = trimmed.lastIndexOf(":");
  if (colonIdx > 0) {
    const slashForm = `${trimmed.slice(0, colonIdx)}/${trimmed.slice(colonIdx + 1)}`;
    if (slashForm !== trimmed) {
      candidates.push(slashForm);
    }
  }
  return candidates;
}

export function parseSkillMd(content: string, skillFilePath: string): SkillDefinition {
  const skillDir = dirname(skillFilePath);
  const skillMdPath = resolve(skillFilePath);
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    const folderName = skillDir.split(/[/\\]/).pop() ?? "unknown";
    return {
      name: folderName,
      description: "",
      path: skillDir,
      skillMdPath,
      instructions: content.trim(),
    };
  }
  const frontmatter = parseYaml(match[1]!) as { name?: string; description?: string };
  return {
    name: String(frontmatter.name ?? skillDir.split(/[/\\]/).pop() ?? "unknown"),
    description: String(frontmatter.description ?? ""),
    path: skillDir,
    skillMdPath,
    instructions: match[2]!.trim(),
  };
}

async function skillRoots(cwd: string): Promise<string[]> {
  const roots: string[] = [];
  const projectRoot = join(resolve(cwd), ".kako", "skills");
  const globalRoot = getSkillsDir();
  const bundled = await findBundledSkillsDir();

  for (const root of [projectRoot, globalRoot, bundled]) {
    if (!root) continue;
    try {
      await access(root);
      roots.push(root);
    } catch {
      // skip missing
    }
  }
  return roots;
}

async function listSkillFilesInRoot(root: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const skillFile = join(root, entry, "SKILL.md");
    try {
      await access(skillFile);
      files.push(skillFile);
    } catch {
      // not a skill directory
    }
  }
  return files;
}

async function discoverFilesystemSkills(cwd: string): Promise<SkillDefinition[]> {
  const byName = new Map<string, SkillDefinition>();
  for (const root of await skillRoots(cwd)) {
    for (const filePath of await listSkillFilesInRoot(root)) {
      const content = await readFile(filePath, "utf-8");
      const skill = parseSkillMd(content, filePath);
      if (!byName.has(skill.name)) {
        byName.set(skill.name, skill);
      }
    }
  }
  return [...byName.values()];
}

function recordToSkillDefinition(record: InstalledSkillRecord): SkillDefinition {
  return {
    name: record.name,
    description: record.description,
    path: record.installDir,
    skillMdPath: record.skillMdPath,
    instructions: "",
  };
}

export async function discoverSkills(cwd: string): Promise<SkillDefinition[]> {
  const manifest = await loadSkillsManifest();
  const disabled = new Set(
    manifest.skills.filter((s) => s.enabled === false).map((s) => s.name),
  );
  const byName = new Map<string, SkillDefinition>();

  for (const record of manifest.skills) {
    if (disabled.has(record.name)) continue;
    byName.set(record.name, recordToSkillDefinition(record));
  }

  for (const skill of await discoverFilesystemSkills(cwd)) {
    if (disabled.has(skill.name)) continue;
    if (!byName.has(skill.name)) {
      byName.set(skill.name, skill);
    } else {
      const existing = byName.get(skill.name)!;
      byName.set(skill.name, {
        ...existing,
        description: existing.description || skill.description,
        skillMdPath: existing.skillMdPath || skill.skillMdPath,
        path: existing.path || skill.path,
        instructions: skill.instructions || existing.instructions,
      });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterSkillsForAgent(
  discovered: SkillDefinition[],
  agentSkills: string[] | undefined,
): SkillDefinition[] {
  if (!agentSkills?.length) return [];
  const allowed = new Set(agentSkills);
  return discovered.filter((skill) => allowed.has(skill.name));
}

export async function discoverSkillsForAgent(
  cwd: string,
  agentSkills: string[] | undefined,
): Promise<SkillDefinition[]> {
  const discovered = await discoverSkills(cwd);
  const systemSkills = await loadSystemSkills();
  return mergeSkillsForAgent(discovered, agentSkills, systemSkills);
}

export async function findSkillFile(skillName: string, cwd: string): Promise<string | null> {
  if (isSystemSkill(skillName)) {
    for (const skill of await loadSystemSkills()) {
      if (skill.name === skillName) return skill.skillMdPath;
    }
  }
  for (const candidate of skillNameCandidates(skillName)) {
    const paths = [
      join(resolve(cwd), ".kako", "skills", candidate, "SKILL.md"),
      join(getSkillsDir(), candidate, "SKILL.md"),
    ];
    const bundled = await findBundledSkillsDir();
    if (bundled) {
      paths.push(join(bundled, candidate, "SKILL.md"));
    }
    for (const path of paths) {
      try {
        await readFile(path, "utf-8");
        return path;
      } catch {
        // try next
      }
    }
  }
  const manifest = await loadSkillsManifest();
  const hit = manifest.skills.find((s) => s.name === skillName || s.slug === skillName);
  if (hit) return hit.skillMdPath;
  return null;
}

export async function loadSkill(skillName: string, cwd: string): Promise<SkillDefinition> {
  const filePath = await findSkillFile(skillName, cwd);
  if (!filePath) {
    throw new Error(`Unknown skill: ${skillName}`);
  }
  const content = await readFile(filePath, "utf-8");
  return parseSkillMd(content, filePath);
}

export function formatSkillsIndex(skills: SkillMetadata[]): string {
  if (!skills.length) return "";
  const lines = skills.map((skill) => {
    const desc = skill.description.trim().replace(/\s+/g, " ");
    const when = desc || "Use when this skill matches the user's request.";
    return `- ${skill.name}: ${when}`;
  });
  return `\n\nThe following skills are available for use with the Skill tool:

${lines.join("\n")}`;
}

/** @deprecated Use formatSkillsIndex */
export function formatSkillsReminder(skills: SkillMetadata[]): string {
  return formatSkillsIndex(skills);
}

export async function findSkillByMdPath(
  filePath: string,
  cwd: string,
): Promise<SkillDefinition | null> {
  const normalized = resolve(filePath);
  const skills = await discoverSkills(cwd);
  return skills.find((skill) => resolve(skill.skillMdPath) === normalized) ?? null;
}

export async function toSkillIndex(skills: SkillDefinition[]): Promise<SkillMetadata[]> {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    path: skill.path,
    skillMdPath: skill.skillMdPath,
  }));
}
