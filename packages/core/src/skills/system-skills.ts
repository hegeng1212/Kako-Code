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

/** CLI slash autocomplete only — not agent Skill() catalog entries. */
export const BUILTIN_SLASH_MENU_ENTRIES: SystemSkillEntry[] = [
  {
    name: "clear",
    slashOnly: true,
    handler: "skill",
    description: "Clear the chat screen and conversation context",
  },
];

export const SYSTEM_SKILL_REGISTRY: SystemSkillEntry[] = [
  {
    name: "plan",
    slashOnly: true,
    handler: "skill",
    description: "View the session plan, enter plan mode, or open the plan in VS Code",
  },
  {
    name: "auto",
    slashOnly: true,
    handler: "skill",
    description: "Enter auto mode (mid/low-risk tools proceed without prompts)",
  },
  {
    name: "manual",
    slashOnly: true,
    handler: "skill",
    description: "Enter manual mode (default permission approvals)",
  },
  {
    name: "workflows",
    handler: "skill",
    description:
      "List running and completed workflows for this session (status only). Users can open the fullscreen panel with /workflows.",
  },
  {
    name: "deep-research",
    tag: "dynamic workflow",
    handler: "dynamic-workflow",
    description:
      "Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report. - When the user wants a deep, multi-source, fact-checked research report on any topic. BEFORE invoking, check if the question is specific enough to research directly — if underspecified (e.g., \"what car to buy\" without budget/use-case/region), ask 2-3 clarifying questions to narrow scope. Then pass the refined question as args, weaving the answers in.",
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

export function isSlashOnlySystemSkill(name: string): boolean {
  return getSystemSkillEntry(name)?.slashOnly === true;
}

/** True when Skill() should run a built-in handler (not load SKILL.md from disk). */
export function isDefaultSkillWithHandler(name: string): boolean {
  const entry = getSystemSkillEntry(name);
  if (!entry || entry.slashOnly) return false;
  return entry.handler === "dynamic-workflow" || entry.name === "workflows" || entry.name === "init";
}

export function skillNamesForToolAllowlist(skills: SkillDefinition[]): string[] {
  return skills.map((skill) => skill.name);
}

export async function loadSystemSkills(): Promise<SkillDefinition[]> {
  const bundled = await findBundledSkillsDir();
  if (!bundled) return [];

  const skills: SkillDefinition[] = [];
  for (const entry of SYSTEM_SKILL_REGISTRY) {
    if (entry.slashOnly) continue;
    if (entry.name === "workflows") {
      skills.push({
        name: "workflows",
        description: entry.description,
        path: "",
        skillMdPath: "",
        instructions: "",
      });
      continue;
    }
    const skillFile = join(bundled, entry.name, "SKILL.md");
    try {
      const content = await readFile(skillFile, "utf-8");
      const parsed = parseSkillMd(content, skillFile);
      skills.push({
        ...parsed,
        description: parsed.description || entry.description,
      });
    } catch {
      process.stderr.write(
        `[kako] warning: bundled system skill file missing: ${entry.name} (${skillFile})\n`,
      );
    }
  }
  return skills;
}

export function mergeSkillsForAgent(
  discovered: SkillDefinition[],
  bundledSkills: SkillDefinition[],
  systemSkills: SkillDefinition[],
): SkillDefinition[] {
  const byName = new Map<string, SkillDefinition>();

  for (const skill of bundledSkills) {
    byName.set(skill.name, skill);
  }
  for (const skill of discovered) {
    const existing = byName.get(skill.name);
    byName.set(skill.name, existing ? { ...existing, ...skill } : skill);
  }
  for (const skill of systemSkills) {
    const existing = byName.get(skill.name);
    if (existing) {
      byName.set(skill.name, {
        ...existing,
        description: existing.description || skill.description,
        skillMdPath: existing.skillMdPath || skill.skillMdPath,
        path: existing.path || skill.path,
      });
    } else {
      byName.set(skill.name, skill);
    }
  }
  // Never surface slash-only commands in agent skill lists / Skill tool catalogs.
  return [...byName.values()]
    .filter((skill) => !isSlashOnlySystemSkill(skill.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Slash-only system skills — built-in slash commands, not loaded from skills/. */
export async function loadSlashOnlyCatalogSkills(): Promise<SkillDefinition[]> {
  return SYSTEM_SKILL_REGISTRY.filter(
    (entry) => entry.slashOnly || entry.name === "workflows",
  ).map((entry) => ({
    name: entry.name,
    description: entry.description,
    path: "",
    skillMdPath: "",
    instructions: "",
  }));
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
  return [...BUILTIN_SLASH_MENU_ENTRIES, ...system, ...user];
}
