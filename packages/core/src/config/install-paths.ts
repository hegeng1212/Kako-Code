import { accessSync, constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function existsSync(path: string): boolean {
  try {
    accessSync(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Install root set by install.sh / macOS pkg wrapper (`KAKO_INSTALL`). */
export function resolveKakoInstallRoot(): string | undefined {
  const fromEnv = process.env.KAKO_INSTALL?.trim();
  if (fromEnv) return fromEnv;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const hasCli = join(dir, "dist", "index.js");
    const hasAgents = join(dir, "agents", "main.yaml");
    if (existsSync(hasCli) && existsSync(hasAgents)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export async function resolveWebDist(installRoot?: string): Promise<string | undefined> {
  const fromEnv = process.env.KAKO_WEB_DIST?.trim();
  if (fromEnv && (await exists(fromEnv))) return fromEnv;

  const root = installRoot ?? resolveKakoInstallRoot();
  if (root) {
    const bundled = join(root, "web");
    if (await exists(join(bundled, "index.html"))) return bundled;
  }

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "apps", "web", "dist");
    if (await exists(join(candidate, "index.html"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export async function resolveServerEntry(installRoot?: string): Promise<string | undefined> {
  const root = installRoot ?? resolveKakoInstallRoot();
  if (root) {
    for (const candidate of [
      join(root, "server-app", "dist", "index.js"),
      join(root, "server", "index.js"),
      join(root, "node_modules", "@kako", "server", "dist", "index.js"),
    ]) {
      if (await exists(candidate)) return candidate;
    }
  }

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "packages", "server", "dist", "index.js");
    if (await exists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function defaultSettingsUrl(port = 3721): string {
  return process.env.KAKO_WEB_UI_URL ?? `http://localhost:${port}`;
}
