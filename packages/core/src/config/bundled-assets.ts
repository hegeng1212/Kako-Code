import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access, readdir } from "node:fs/promises";
import { resolveKakoInstallRoot } from "./install-paths.js";
import { getKakoHome } from "./paths.js";

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

async function hasDeepResearchTemplate(dir: string): Promise<boolean> {
  try {
    await access(join(dir, "deep-research.js"));
    return true;
  } catch {
    return false;
  }
}

/** Templates shipped inside @kako/core (always available for linked/global installs). */
export async function findCorePackageWorkflowsDir(): Promise<string | undefined> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "bundled", "workflows", "templates");
    if (await hasDeepResearchTemplate(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export async function findBundledWorkflowsDir(): Promise<string | undefined> {
  const fromCorePackage = await findCorePackageWorkflowsDir();
  if (fromCorePackage) return fromCorePackage;

  const installRoot = resolveKakoInstallRoot();
  if (installRoot) {
    const installed = join(installRoot, "workflows", "templates");
    if (await hasDeepResearchTemplate(installed)) return installed;
  }

  const kakoHome = process.env.KAKO_HOME?.trim() || join(homedir(), ".kako");
  const fromAppInstall = join(kakoHome, "app", "workflows", "templates");
  if (await hasDeepResearchTemplate(fromAppInstall)) return fromAppInstall;

  const fromHomeTemplates = join(kakoHome, "workflows", "templates");
  if (await hasDeepResearchTemplate(fromHomeTemplates)) return fromHomeTemplates;

  const kakoSrc = process.env.KAKO_SRC?.trim();
  if (kakoSrc) {
    const fromSrc = join(kakoSrc, "workflows", "templates");
    if (await hasDeepResearchTemplate(fromSrc)) return fromSrc;
  }

  const fromHomeSrc = join(kakoHome, "src", "Kako-Code", "workflows", "templates");
  if (await hasDeepResearchTemplate(fromHomeSrc)) return fromHomeSrc;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "workflows", "templates");
    if (await hasDeepResearchTemplate(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
