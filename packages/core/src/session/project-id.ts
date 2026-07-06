import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

export function projectIdFromCwd(cwd: string): string {
  const normalized = resolve(cwd);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `proj-${hash}`;
}

export function projectNameFromCwd(cwd: string): string {
  return basename(resolve(cwd)) || "project";
}
