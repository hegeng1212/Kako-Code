import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { AgentDefinition, ProjectContext } from "@kako/shared";
import { findBundledAgentsDir } from "../config/bundled-assets.js";
import { getAgentsDir, getGlobalKakoMdPath } from "../config/paths.js";

const agentSchema = z.object({
  name: z.string(),
  description: z.string(),
  model: z.string().default(""),
  systemPrompt: z.string(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  permissionMode: z
    .enum(["default", "plan", "acceptEdits", "bypassPermissions"])
    .optional(),
  maxTurns: z.number().optional(),
  subagents: z.array(z.string()).optional(),
});

async function agentsDirReady(dir: string): Promise<boolean> {
  try {
    await access(join(dir, "main.yaml"));
    return true;
  } catch {
    return false;
  }
}

export async function findAgentsDir(cwd: string): Promise<string> {
  const candidates = [
    join(cwd, "agents"),
    join(cwd, ".kako", "agents"),
    getAgentsDir(),
  ];

  if (process.env.KAKO_AGENTS_DIR) {
    candidates.push(resolve(process.env.KAKO_AGENTS_DIR));
  }

  for (const dir of candidates) {
    if (await agentsDirReady(dir)) {
      return dir;
    }
  }

  const bundled = await findBundledAgentsDir();
  if (bundled) return bundled;

  throw new Error(
    "No agents directory found. Run kako once to initialize ~/.kako/agents, or add agents/ to your project.",
  );
}

export async function loadAgent(
  name: string,
  cwd: string,
): Promise<AgentDefinition> {
  const agentsDir = await findAgentsDir(cwd);
  const yamlPath = join(agentsDir, `${name}.yaml`);
  const text = await readFile(yamlPath, "utf-8");
  const raw = parseYaml(text);
  const parsed = agentSchema.parse(raw);

  let systemPrompt = parsed.systemPrompt;
  if (systemPrompt.startsWith("./")) {
    const promptPath = join(agentsDir, systemPrompt);
    systemPrompt = await readFile(promptPath, "utf-8");
  }

  return { ...parsed, systemPrompt };
}

/** Load sub-agent definitions referenced by a parent agent's `subagents` list. */
export async function loadSubagentDefinitions(
  names: string[] | undefined,
  cwd: string,
): Promise<AgentDefinition[]> {
  if (!names?.length) return [];
  const defs: AgentDefinition[] = [];
  for (const name of names) {
    defs.push(await loadAgent(name, cwd));
  }
  return defs;
}

const WORKSPACE_KAKO_CANDIDATES = [
  (cwd: string) => join(cwd, "KAKO.md"),
  (cwd: string) => join(cwd, ".kako", "KAKO.md"),
];

/** Workspace KAKO.md injected into each user message's <system-reminder> (not system prompt). */
export async function loadWorkspaceKakoMd(cwd: string): Promise<ProjectContext | undefined> {
  const root = resolve(cwd);
  for (const candidate of WORKSPACE_KAKO_CANDIDATES) {
    const path = candidate(root);
    try {
      const content = await readFile(path, "utf-8");
      if (!content.trim()) continue;
      return { path, content };
    } catch {
      // try next
    }
  }
  return undefined;
}

const PROJECT_CONTEXT_CANDIDATES = [
  (cwd: string) => join(cwd, ".kako", "project.md"),
  (cwd: string) => join(cwd, "KAKO.md"),
  (cwd: string) => join(cwd, ".kako", "KAKO.md"),
];

/** @deprecated Prefer loadWorkspaceKakoMd for LLM user reminders; kept for CLI status display. */
export async function loadProjectContext(cwd: string): Promise<ProjectContext | undefined> {
  for (const candidate of PROJECT_CONTEXT_CANDIDATES) {
    const path = candidate(cwd);
    try {
      const content = await readFile(path, "utf-8");
      if (!content.trim()) continue;
      return { path, content };
    } catch {
      // try next
    }
  }
  return undefined;
}

/** Global user instructions from ~/.kako/KAKO.md */
export async function loadGlobalUserContext(): Promise<ProjectContext | undefined> {
  const path = getGlobalKakoMdPath();
  try {
    const content = await readFile(path, "utf-8");
    if (!content.trim()) return undefined;
    return { path, content };
  } catch {
    return undefined;
  }
}

/** @deprecated Use loadProjectContext which returns ProjectContext */
export async function loadProjectContextText(cwd: string): Promise<string | undefined> {
  const ctx = await loadProjectContext(cwd);
  return ctx?.content;
}
