import { isAbsolute, resolve } from "node:path";
import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { loadSecurityPolicy } from "../../security/policy-store.js";
import { isDeniedSecretPath } from "../../security/secret-guard.js";
import { resolveWorkspacePath } from "./path.js";
import { listWorkspaceFiles, relativeDisplayPath } from "./workspace-walk.js";

export const GLOB_DESCRIPTION = `Find files in the workspace by glob pattern.

- \`pattern\` is required (e.g. recursive TypeScript or Go path patterns).
- \`path\` is the directory to search (defaults to session cwd). Relative or absolute.
- Returns paths relative to cwd when possible.
- Use Grep to search inside matched files, then Read for full contents.`;

export interface ParsedGlobInput {
  pattern: string;
  path: string;
}

export function parseGlobInput(raw: Record<string, unknown>, cwd: string): ParsedGlobInput {
  const pattern = String(raw.pattern ?? raw.glob_pattern ?? "").trim();
  if (!pattern) {
    throw new Error("Glob requires pattern");
  }
  const pathRaw = String(raw.path ?? cwd).trim() || cwd;
  const path = isAbsolute(pathRaw) ? pathRaw : resolve(cwd, pathRaw);
  return { pattern, path };
}

export const globToolDefinition: ToolDefinition = {
  name: "Glob",
  description: GLOB_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pattern: {
        type: "string",
        description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.go")',
      },
      path: {
        type: "string",
        description: "Directory to search (relative to cwd or absolute)",
      },
    },
    required: ["pattern"],
  },
};

export const globHandler: ToolHandler = async (input, context) => {
  const parsed = parseGlobInput(input, context.cwd);
  const policy = await loadSecurityPolicy(context.cwd);

  if (isDeniedSecretPath(parsed.path, policy)) {
    throw new Error(`Access denied: ${parsed.path} contains sensitive configuration`);
  }

  await resolveWorkspacePath(
    parsed.path,
    context.cwd,
    policy,
    context.getCapability?.() ?? "ReadOnly",
  );

  const files = await listWorkspaceFiles({
    cwd: context.cwd,
    root: parsed.path,
    policy,
    capability: context.getCapability?.() ?? "ReadOnly",
    globFilter: parsed.pattern,
  });

  if (!files.length) {
    return "No files found.";
  }

  return files.map((f) => relativeDisplayPath(f, context.cwd)).join("\n");
};
