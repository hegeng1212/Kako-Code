import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  getAgentsDir,
  getCheckpointsDir,
  getConfigDir,
  getGlobalKakoMdPath,
  getIndexDir,
  getKakoHome,
  getLogsDir,
  getMemoryDir,
  getRuntimeDir,
  getSkillsDir,
  getWorkflowTemplatesDir,
} from "./paths.js";
import { findBundledAgentsDir, findBundledSkillsDir, findBundledWorkflowsDir } from "./bundled-assets.js";

const DEFAULT_SKILLS_YAML = `# Global slash command mappings for Kako CLI
# Map command name -> skill id or multiline prompt text
slashCommands:
  # commit: |
  #   Review git diff and suggest a commit message.
  # review: code-review
`;

const DEFAULT_KAKO_MD = `# Kako User Instructions

Add your global preferences here. These instructions apply across all projects
(unless a project KAKO.md overrides or adds project-specific context).

Examples:
- Preferred language for replies
- Coding style preferences
- Tools you use most often
`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function seedDirFromBundled(
  bundledDir: string | undefined,
  targetDir: string,
  markerRelativePath: string,
): Promise<boolean> {
  if (!bundledDir) return false;
  const marker = join(targetDir, markerRelativePath);
  if (await exists(marker)) return false;

  await ensureDir(targetDir);
  await cp(bundledDir, targetDir, { recursive: true, force: false });
  return true;
}

async function writeFileIfMissing(path: string, content: string): Promise<boolean> {
  if (await exists(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
  return true;
}

export interface KakoHomeInitResult {
  home: string;
  created: string[];
}

/** Initialize ~/.kako layout and seed bundled defaults (Claude-style user data dir). */
export async function initializeKakoHome(): Promise<KakoHomeInitResult> {
  const home = getKakoHome();
  const created: string[] = [];

  const dirs = [
    home,
    getConfigDir(),
    getAgentsDir(),
    getSkillsDir(),
    getMemoryDir(),
    join(getMemoryDir(), "sessions"),
    join(getMemoryDir(), "summaries", "rolling"),
    join(getMemoryDir(), "facts"),
    join(getMemoryDir(), "profile"),
    join(getMemoryDir(), "episodes"),
    getLogsDir(),
    join(getLogsDir(), "tools"),
    join(getLogsDir(), "skills"),
    join(getLogsDir(), "llm"),
    join(getLogsDir(), "runs"),
    getIndexDir(),
    getCheckpointsDir(),
    getRuntimeDir(),
  ];

  for (const dir of dirs) {
    if (!(await exists(dir))) {
      await ensureDir(dir);
      created.push(dir);
    }
  }

  if (await seedDirFromBundled(await findBundledAgentsDir(), getAgentsDir(), "main.yaml")) {
    created.push(getAgentsDir());
  }

  if (await seedDirFromBundled(await findBundledSkillsDir(), getSkillsDir(), "brainstorming/SKILL.md")) {
    created.push(getSkillsDir());
  }

  const workflowTemplates = await findBundledWorkflowsDir();
  if (
    workflowTemplates &&
    (await seedDirFromBundled(workflowTemplates, getWorkflowTemplatesDir(), "deep-research.js"))
  ) {
    created.push(getWorkflowTemplatesDir());
  }

  if (await writeFileIfMissing(join(getConfigDir(), "skills.yaml"), DEFAULT_SKILLS_YAML)) {
    created.push(join(getConfigDir(), "skills.yaml"));
  }

  if (await writeFileIfMissing(getGlobalKakoMdPath(), DEFAULT_KAKO_MD)) {
    created.push(getGlobalKakoMdPath());
  }

  return { home, created };
}
