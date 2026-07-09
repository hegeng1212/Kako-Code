import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillDefinition } from "@kako/shared";
import { findBundledSkillsDir } from "../config/bundled-assets.js";
import { parseSkillMd } from "./loader.js";

export type SystemSkillHandler = "skill" | "dynamic-workflow";

/** Built-in skills shipped with Kako — not shown in Web UI, always available to the agent. */
export interface SystemSkillEntry {
  name: string;
  description: string;
  /** Optional label for CLI slash autocomplete, e.g. "dynamic workflow". */
  tag?: string;
  handler: SystemSkillHandler;
  /** Slash menu only — not loaded into the agent skill list. */
  slashOnly?: boolean;
}

export const SYSTEM_SKILL_REGISTRY: SystemSkillEntry[] = [
  {
    name: "workflows",
    slashOnly: true,
    handler: "skill",
    description: "Browse running and completed workflows",
  },
  {
    name: "deep-research",
    tag: "dynamic workflow",
    handler: "dynamic-workflow",
    description:
      "Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.",
  },
  {
    name: "init",
    handler: "skill",
    description: "Initialize a new KAKO.md file with codebase documentation",
  },
];

const SYSTEM_SKILL_NAMES = new Set(SYSTEM_SKILL_REGISTRY.map((entry) => entry.name));

export function isSystemSkill(name: string): boolean {
  return SYSTEM_SKILL_NAMES.has(name);
}

export function getSystemSkillEntry(name: string): SystemSkillEntry | undefined {
  return SYSTEM_SKILL_REGISTRY.find((entry) => entry.name === name);
}

export function getSystemSkillHandler(name: string): SystemSkillHandler | undefined {
  return getSystemSkillEntry(name)?.handler;
}

export function expandAllowedSkillNames(agentSkills: string[] | undefined): string[] | undefined {
  if (!agentSkills?.length) return agentSkills;
  const names = new Set(agentSkills);
  for (const entry of SYSTEM_SKILL_REGISTRY) {
    if (!entry.slashOnly) {
      names.add(entry.name);
    }
  }
  return [...names];
}

export async function loadSystemSkills(): Promise<SkillDefinition[]> {
  const bundled = await findBundledSkillsDir();
  if (!bundled) return [];

  const skills: SkillDefinition[] = [];
  for (const entry of SYSTEM_SKILL_REGISTRY) {
    if (entry.slashOnly) continue;
    const skillFile = join(bundled, entry.name, "SKILL.md");
    try {
      const content = await readFile(skillFile, "utf-8");
      const parsed = parseSkillMd(content, skillFile);
      skills.push({
        ...parsed,
        description: entry.description || parsed.description,
      });
    } catch {
      // Bundled file missing in this install — skip.
    }
  }
  return skills;
}

export function mergeSkillsForAgent(
  discovered: SkillDefinition[],
  agentSkills: string[] | undefined,
  systemSkills: SkillDefinition[],
): SkillDefinition[] {
  const allowed = agentSkills?.length ? new Set(agentSkills) : null;
  const byName = new Map<string, SkillDefinition>();

  for (const skill of discovered) {
    if (allowed && !allowed.has(skill.name)) continue;
    byName.set(skill.name, skill);
  }
  for (const skill of systemSkills) {
    if (!byName.has(skill.name)) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function isSlashInvokableSkill(name: string, cwd: string): Promise<boolean> {
  if (isSystemSkill(name)) return true;
  const { discoverSkills } = await import("./loader.js");
  const skills = await discoverSkills(cwd);
  return skills.some((skill) => skill.name === name);
}

export async function listSlashInvokableSkills(
  cwd: string,
): Promise<SystemSkillEntry[]> {
  const { discoverSkills } = await import("./loader.js");
  const discovered = await discoverSkills(cwd);
  const byName = new Map<string, SystemSkillEntry>();

  for (const entry of SYSTEM_SKILL_REGISTRY) {
    byName.set(entry.name, entry);
  }
  for (const skill of discovered) {
    if (isSystemSkill(skill.name) || byName.has(skill.name)) continue;
    byName.set(skill.name, {
      name: skill.name,
      description: skill.description.trim() || "User-installed skill",
      handler: "skill",
    });
  }

  const system = SYSTEM_SKILL_REGISTRY.map((entry) => byName.get(entry.name)).filter(
    (entry): entry is SystemSkillEntry => entry !== undefined,
  );
  const user = [...byName.values()]
    .filter((entry) => !isSystemSkill(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...system, ...user];
}
