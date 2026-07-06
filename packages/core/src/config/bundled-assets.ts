import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access, readdir } from "node:fs/promises";

/** Walk up from the running module to find monorepo bundled assets (dev / linked installs). */
export async function findBundledAssetDir(subdir: string): Promise<string | undefined> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, subdir);
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export async function findBundledAgentsDir(): Promise<string | undefined> {
  const dir = await findBundledAssetDir("agents");
  if (!dir) return undefined;
  try {
    const entries = await readdir(dir);
    if (entries.some((name) => name.endsWith(".yaml"))) return dir;
  } catch {
    // ignore
  }
  return undefined;
}

export async function findBundledSkillsDir(): Promise<string | undefined> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "skills");
    try {
      await access(join(candidate, "brainstorming", "SKILL.md"));
      return candidate;
    } catch {
      // keep walking — skip source-tree `src/skills` module dirs
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
