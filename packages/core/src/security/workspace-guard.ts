import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { OutsideWorkspacePolicy } from "@kako/shared";
import type { SecurityPolicy } from "./policy-store.js";

export interface WorkspaceCheckResult {
  allowed: boolean;
  resolvedPath?: string;
  inTrusted: boolean;
  inDenied: boolean;
  violation?: string;
}

export function isPathWithinRoots(targetPath: string, roots: string[]): boolean {
  const normalized = resolve(targetPath);
  return roots.some((root) => {
    const base = resolve(root);
    if (normalized === base) return true;
    const rel = relative(base, normalized);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
}

export function isPathInDeniedRoots(targetPath: string, deniedRoots: string[]): boolean {
  return isPathWithinRoots(targetPath, deniedRoots);
}

async function resolveTrustedRoots(roots: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const root of roots) {
    const base = resolve(root);
    try {
      resolved.push(await realpath(base));
    } catch {
      resolved.push(base);
    }
  }
  return resolved;
}

async function resolveExistingOrParent(rawPath: string): Promise<string> {
  let current = resolve(rawPath);
  const suffix: string[] = [];

  while (true) {
    try {
      const base = await realpath(current);
      return suffix.length
        ? resolve(base, ...suffix.reverse())
        : base;
    } catch {
      suffix.push(basename(current));
      const parent = dirname(current);
      if (parent === current) {
        return resolve(rawPath);
      }
      current = parent;
    }
  }
}

export async function resolveSafePath(
  cwd: string,
  rawPath: string,
  policy: SecurityPolicy,
): Promise<WorkspaceCheckResult> {
  const logical = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
  const resolved = await resolveExistingOrParent(logical);

  const trusted = await resolveTrustedRoots(policy.workspace.trustedRoots ?? []);
  const denied = await resolveTrustedRoots(policy.workspace.deniedRoots ?? []);
  const inDenied = isPathWithinRoots(resolved, denied);
  const inTrusted = isPathWithinRoots(resolved, trusted);

  if (inDenied) {
    return {
      allowed: false,
      resolvedPath: resolved,
      inTrusted,
      inDenied: true,
      violation: `Path is in denied roots: ${resolved}`,
    };
  }

  if (!inTrusted) {
    return {
      allowed: false,
      resolvedPath: resolved,
      inTrusted: false,
      inDenied: false,
      violation: `Path outside workspace: ${resolved}`,
    };
  }

  return { allowed: true, resolvedPath: resolved, inTrusted: true, inDenied: false };
}

export function outsidePolicyAction(
  policy: SecurityPolicy,
): OutsideWorkspacePolicy {
  return policy.workspace.outsidePolicy ?? "approve";
}
