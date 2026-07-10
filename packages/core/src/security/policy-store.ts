import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import type {
  ApprovalMode,
  OutsideWorkspacePolicy,
  RiskLevel,
  SecurityConfigFile,
  SessionCapability,
} from "@kako/shared";
import {
  getAgentsDir,
  getConfigDir,
  getKakoHome,
  getMemoryDir,
  getPlansDir,
  getSkillsDir,
} from "../config/paths.js";

const approvalModeSchema = z.enum(["never", "onRequest", "always", "deny"]);
const riskLevelSchema = z.enum(["none", "low", "medium", "high", "critical"]);
const outsidePolicySchema = z.enum(["deny", "approve", "allow"]);
const capabilitySchema = z.enum(["ReadOnly", "WorkspaceWrite", "FullAccess"]);

const securityPolicySchema = z.object({
  version: z.number().default(1),
  workspace: z
    .object({
      trustedRoots: z.array(z.string()).optional(),
      extraTrustedRoots: z.array(z.string()).optional(),
      deniedRoots: z.array(z.string()).optional(),
      outsidePolicy: outsidePolicySchema.default("approve"),
    })
    .default({}),
  capabilities: z
    .object({
      default: capabilitySchema.default("FullAccess"),
    })
    .default({}),
  approval: z
    .object({
      byRisk: z
        .record(approvalModeSchema)
        .default({
          none: "never",
          low: "onRequest",
          medium: "onRequest",
          high: "always",
          critical: "deny",
        }),
      unknownRiskPolicy: approvalModeSchema.default("onRequest"),
    })
    .default({}),
  bash: z
    .object({
      safeTier: approvalModeSchema.default("never"),
      riskyTier: approvalModeSchema.default("onRequest"),
      dangerousTier: approvalModeSchema.default("deny"),
    })
    .default({}),
  delete: z
    .object({
      protectBulk: z.boolean().default(true),
    })
    .default({}),
  secrets: z
    .object({
      deniedPaths: z.array(z.string()).optional(),
      redactPatterns: z.array(z.string()).default([
        "api[_-]?key",
        "secret",
        "token",
        "password",
        "authorization",
      ]),
      redactEnvKeys: z.array(z.string()).default([
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "ARK_API_KEY",
        "VOLCENGINE_API_KEY",
        "DOUBAO_API_KEY",
        "BRAVE_SEARCH_API_KEY",
        "SERPAPI_KEY",
      ]),
    })
    .default({}),
  resources: z
    .object({
      bashTimeoutMs: z.number().default(120_000),
      bashMaxTimeoutMs: z.number().default(600_000),
      bashMaxOutputBytes: z.number().default(10 * 1024 * 1024),
    })
    .default({}),
  bypass: z
    .object({
      secretsEnforced: z.boolean().default(true),
      networkEnforced: z.boolean().default(true),
      workspaceDenyEnforced: z.boolean().default(true),
    })
    .default({}),
});

export type SecurityPolicy = z.infer<typeof securityPolicySchema>;

function securityConfigPath(): string {
  return join(getConfigDir(), "security.json");
}

function expandHome(path: string): string {
  const home = homedir();
  if (path.startsWith("~/")) return join(home, path.slice(2));
  if (path === "~") return home;
  return path;
}

export function defaultTrustedRoots(cwd: string): string[] {
  const kako = getKakoHome();
  return [
    resolve(cwd),
    getSkillsDir(),
    getAgentsDir(),
    getMemoryDir(),
    getPlansDir(),
    join(kako, "workflows"),
  ];
}

export function defaultDeniedRoots(): string[] {
  return [getConfigDir(), join(getKakoHome(), "index", "observability.db")];
}

function pathKey(path: string): string {
  return resolve(expandHome(path)).toLowerCase();
}

export function expandTrustedRootPath(path: string, cwd: string): string {
  return resolve(expandHome(path.replace("$CWD", cwd)));
}

export function inheritedTrustedRoots(cwd: string): string[] {
  return defaultTrustedRoots(cwd).map((p) => expandTrustedRootPath(p, cwd));
}

function dedupeTrustedRoots(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolve(expandHome(path)));
  }
  return out;
}

export function extraTrustedRootsFromWorkspace(
  workspace: SecurityPolicy["workspace"],
  cwd: string,
): string[] {
  if (workspace.extraTrustedRoots !== undefined) {
    return workspace.extraTrustedRoots.map((p) => expandTrustedRootPath(p, cwd));
  }
  const inherited = new Set(inheritedTrustedRoots(cwd).map(pathKey));
  const all = workspace.trustedRoots ?? [];
  return all.filter((p) => !inherited.has(pathKey(p)));
}

export function toSecuritySettingsFile(policy: SecurityPolicy, cwd: string) {
  const inherited = inheritedTrustedRoots(cwd);
  const extra = extraTrustedRootsFromWorkspace(policy.workspace, cwd);
  return {
    version: policy.version,
    capabilities: policy.capabilities,
    workspace: {
      outsidePolicy: policy.workspace.outsidePolicy ?? "approve",
      inheritedTrustedRoots: inherited,
      extraTrustedRoots: extra,
    },
  };
}

export function applySecuritySettingsPatch(
  existing: SecurityPolicy,
  patch: SecurityConfigFile,
  cwd: string,
): SecurityPolicy {
  return normalizeSecurityPolicy(
    {
      ...existing,
      version: patch.version ?? existing.version,
      capabilities: { default: patch.capabilities.default },
      workspace: {
        ...existing.workspace,
        outsidePolicy: patch.workspace.outsidePolicy,
        extraTrustedRoots: patch.workspace.extraTrustedRoots ?? [],
      },
    },
    cwd,
  );
}

export function normalizeSecurityPolicy(
  raw: SecurityPolicy,
  cwd: string,
): SecurityPolicy {
  const inherited = inheritedTrustedRoots(cwd);
  const extra = extraTrustedRootsFromWorkspace(raw.workspace ?? {}, cwd).map((p) =>
    expandTrustedRootPath(p, cwd),
  );
  const trusted = dedupeTrustedRoots([...inherited, ...extra]);
  const denied = (raw.workspace?.deniedRoots ?? defaultDeniedRoots()).map((p) =>
    resolve(expandHome(p)),
  );
  return {
    ...raw,
    workspace: {
      ...raw.workspace,
      trustedRoots: trusted,
      extraTrustedRoots: extra,
      deniedRoots: denied,
      outsidePolicy: raw.workspace?.outsidePolicy ?? "approve",
    },
  };
}

export async function loadSecurityPolicy(cwd: string): Promise<SecurityPolicy> {
  await mkdir(getConfigDir(), { recursive: true });
  try {
    const text = await readFile(securityConfigPath(), "utf-8");
    return normalizeSecurityPolicy(securityPolicySchema.parse(JSON.parse(text)), cwd);
  } catch {
    return normalizeSecurityPolicy(securityPolicySchema.parse({ version: 1 }), cwd);
  }
}

export async function saveSecurityPolicy(policy: SecurityPolicy): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
  const persisted = {
    ...policy,
    workspace: {
      outsidePolicy: policy.workspace.outsidePolicy,
      extraTrustedRoots: policy.workspace.extraTrustedRoots ?? [],
      deniedRoots: policy.workspace.deniedRoots,
    },
  };
  await writeFile(securityConfigPath(), `${JSON.stringify(persisted, null, 2)}\n`, "utf-8");
}

export function approvalModeForRisk(
  policy: SecurityPolicy,
  level: RiskLevel,
): ApprovalMode {
  return (policy.approval?.byRisk?.[level] ??
    policy.approval?.unknownRiskPolicy ??
    "onRequest") as ApprovalMode;
}

export function defaultSessionCapability(policy: SecurityPolicy): SessionCapability {
  return policy.capabilities?.default ?? "FullAccess";
}
