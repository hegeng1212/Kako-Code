import { isAbsolute, resolve } from "node:path";
import type { SessionCapability } from "@kako/shared";
import type { SecurityPolicy } from "../../security/policy-store.js";
import { resolveSafePath } from "../../security/workspace-guard.js";

export function resolvePath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

export async function resolveWorkspacePath(
  raw: string,
  cwd: string,
  policy: SecurityPolicy,
  capability: SessionCapability = "WorkspaceWrite",
): Promise<string> {
  const check = await resolveSafePath(cwd, raw, policy);
  if (check.allowed) {
    return check.resolvedPath ?? resolvePath(raw, cwd);
  }
  if (check.inDenied) {
    throw new Error(check.violation ?? "Path outside workspace");
  }
  if (capability === "FullAccess") {
    return check.resolvedPath ?? resolvePath(raw, cwd);
  }
  throw new Error(check.violation ?? "Path outside workspace");
}

export function lineCount(text: string): number {
  return text.split("\n").length;
}
