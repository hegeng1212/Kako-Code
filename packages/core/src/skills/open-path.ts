import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { getKakoHome } from "../config/paths.js";

const execFileAsync = promisify(execFile);

function assertUnderKakoHome(resolved: string): void {
  const home = resolve(getKakoHome());
  if (resolved !== home && !resolved.startsWith(`${home}/`)) {
    throw new Error("Path must be under Kako home directory");
  }
}

async function resolveDirectory(path: string): Promise<string> {
  const resolved = resolve(path);
  assertUnderKakoHome(resolved);
  await access(resolved);
  const info = await stat(resolved);
  return info.isDirectory() ? resolved : dirname(resolved);
}

export async function openPathInFileManager(path: string): Promise<void> {
  const dir = await resolveDirectory(path);
  if (process.platform === "darwin") {
    await execFileAsync("open", [dir]);
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync("explorer", [dir]);
    return;
  }
  await execFileAsync("xdg-open", [dir]);
}
