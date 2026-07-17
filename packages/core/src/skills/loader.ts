import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { InstalledSkillRecord, SkillDefinition, SkillMetadata } from "@kako/shared";
import { findBundledSkillsDir } from "../config/bundled-assets.js";
import { getSkillsDir } from "../config/paths.js";
import { loadSkillsManifest } from "./manifest.js";
import { isSlashOnlySystemSkill, isSystemSkill, loadSystemSkills, mergeSkillsForAgent } from "./system-skills.js";

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

export async function loadBundledSkills(): Promise<SkillDefinition[]> {
  const bundled = await findBundledSkillsDir();
  if (!bundled) return [];

  const skills: SkillDefinition[] = [];
  for (const filePath of await listSkillFilesInRoot(bundled)) {
    const content = await readFile(filePath, "utf-8");
    const parsed = parseSkillMd(content, filePath);
    if (isSlashOnlySystemSkill(parsed.name)) continue;
    skills.push(parsed);
  }
  return skills;
}

async function discoverFilesystemSkills(cwd: string, options?: { excludeBundled?: boolean }): Promise<SkillDefinition[]> {
  const byName = new Map<string, SkillDefinition>();
  const bundled = options?.excludeBundled ? undefined : await findBundledSkillsDir();
  const roots: string[] = [];
  const projectRoot = join(resolve(cwd), ".kako", "skills");
  const globalRoot = getSkillsDir();

  for (const root of [projectRoot, globalRoot, bundled]) {
    if (!root) continue;
    try {
      await access(root);
      roots.push(root);
    } catch {
      // skip missing
    }
  }

  for (const root of roots) {
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

/**
 * User-installed skills from settings (`installed-skills.json`, enabled !== false) and
 * on-disk copies under `~/.kako/skills/` or `{cwd}/.kako/skills/`. Excludes bundled product skills.
 */
export async function discoverUserInstalledSkills(cwd: string): Promise<SkillDefinition[]> {
  const manifest = await loadSkillsManifest();
  const disabled = new Set(
    manifest.skills.filter((s) => s.enabled === false).map((s) => s.name),
  );
  const byName = new Map<string, SkillDefinition>();

  for (const record of manifest.skills) {
    if (disabled.has(record.name)) continue;
    byName.set(record.name, await recordToSkillDefinition(record));
  }

  for (const skill of await discoverFilesystemSkills(cwd, { excludeBundled: true })) {
    if (disabled.has(skill.name)) continue;
    if (!byName.has(skill.name)) {
      byName.set(skill.name, skill);
    } else {
      const existing = byName.get(skill.name)!;
      byName.set(skill.name, {
        ...existing,
        description: skill.description || existing.description,
        skillMdPath: existing.skillMdPath || skill.skillMdPath,
        path: existing.path || skill.path,
        instructions: skill.instructions || existing.instructions,
      });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function recordToSkillDefinition(record: InstalledSkillRecord): Promise<SkillDefinition> {
  try {
    const content = await readFile(record.skillMdPath, "utf-8");
    const parsed = parseSkillMd(content, record.skillMdPath);
    return {
      ...parsed,
      description: parsed.description || record.description,
      path: record.installDir,
    };
  } catch {
    return {
      name: record.name,
      description: record.description,
      path: record.installDir,
      skillMdPath: record.skillMdPath,
      instructions: "",
    };
  }
}

/**
 * Catalog line for the system skill index — frontmatter description only.
 * Full SKILL.md body is loaded later when the model invokes the Skill tool.
 */
export function skillIndexDescription(skill: SkillDefinition): string {
  const desc = skill.description.trim().replace(/\s+/g, " ");
  return desc || "Use when this skill matches the user's request.";
}

export async function discoverSkills(cwd: string): Promise<SkillDefinition[]> {
  const manifest = await loadSkillsManifest();
  const disabled = new Set(
    manifest.skills.filter((s) => s.enabled === false).map((s) => s.name),
  );
  const byName = new Map<string, SkillDefinition>();

  for (const record of manifest.skills) {
    if (disabled.has(record.name)) continue;
    byName.set(record.name, await recordToSkillDefinition(record));
  }

  for (const skill of await discoverFilesystemSkills(cwd)) {
    if (disabled.has(skill.name)) continue;
    if (!byName.has(skill.name)) {
      byName.set(skill.name, skill);
    } else {
      const existing = byName.get(skill.name)!;
      byName.set(skill.name, {
        ...existing,
        description: skill.description || existing.description,
        skillMdPath: existing.skillMdPath || skill.skillMdPath,
        path: existing.path || skill.path,
        instructions: skill.instructions || existing.instructions,
      });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Restricts a skill list to an agent YAML whitelist. Not used for system prompt catalog injection.
 * When agentSkills is empty/undefined, returns [] — do not wire this into buildMessages.
 */
export function filterSkillsForAgent(
  discovered: SkillDefinition[],
  agentSkills: string[] | undefined,
): SkillDefinition[] {
  if (!agentSkills?.length) return [];
  const allowed = new Set(agentSkills);
  return discovered.filter((skill) => allowed.has(skill.name));
}

export async function discoverSkillsForAgent(cwd: string): Promise<SkillDefinition[]> {
  const discovered = await discoverSkills(cwd);
  const bundled = await loadBundledSkills();
  const systemSkills = await loadSystemSkills();
  return mergeSkillsForAgent(discovered, bundled, systemSkills);
}

/** Default (bundled + system) and user-installed skills for the system prompt catalog. */
export interface SkillCatalogPartition {
  defaults: SkillMetadata[];
  user: SkillMetadata[];
}

/**
 * Split skills for the system prompt: product defaults first, then user-installed skills.
 * User segment = every skill installed and enabled via settings (Web/CLI), not a single bundled example.
 * Names in the default segment are omitted from the user segment (no duplicate catalog lines).
 */
export async function partitionSkillsForCatalog(cwd: string): Promise<SkillCatalogPartition> {
  const bundled = await loadBundledSkills();
  const systemSkills = await loadSystemSkills();
  // Defaults = bundled + invocable system skills only (never slash-only /plan /auto /manual).
  const defaults = mergeSkillsForAgent([], bundled, systemSkills);
  const defaultNames = new Set(defaults.map((skill) => skill.name));
  const user = (await discoverUserInstalledSkills(cwd)).filter(
    (skill) => !defaultNames.has(skill.name),
  );
  return {
    defaults: await toSkillIndex(defaults),
    user: await toSkillIndex(user),
  };
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

function formatSkillCatalogLine(skill: SkillMetadata): string {
  const when =
    skill.description.trim().replace(/\s+/g, " ") ||
    "Use when this skill matches the user's request.";
  return `- ${skill.name}: ${when}`;
}

export function formatSkillsIndex(catalog: SkillCatalogPartition | SkillMetadata[]): string {
  const partition: SkillCatalogPartition = Array.isArray(catalog)
    ? { defaults: catalog, user: [] }
    : catalog;
  if (!partition.defaults.length && !partition.user.length) return "";
  const lines = [
    ...partition.defaults.map(formatSkillCatalogLine),
    ...partition.user.map(formatSkillCatalogLine),
  ];
  const body = `The following skills are available for use with the Skill tool:

${lines.join("\n")}`;
  return `\n\n<system-reminder>\n${body}\n</system-reminder>`;
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
    description: skillIndexDescription(skill),
    path: skill.path,
    skillMdPath: skill.skillMdPath,
  }));
}
