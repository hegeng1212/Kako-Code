import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { anyNetworkRuleMatches } from "@kako/shared";
import { z } from "zod";
import { getConfigDir } from "../config/paths.js";

const legacyModeSchema = z.enum(["off", "allowlist", "blacklist", "open"]).optional();

export const networkPolicySchema = z
  .object({
    version: z.number().default(1),
    enabled: z.boolean().default(true),
    allowlist: z.array(z.string()).default([]),
    blacklist: z.array(z.string()).default([]),
    userAllowlist: z.array(z.string()).default([]),
    mcpNetworkDenials: z.array(z.string()).default([]),
    mcpNetworkExceptions: z.array(z.string()).optional(),
    mcpAllowlist: z.array(z.string()).optional(),
    mode: legacyModeSchema,
  })
  .transform(({ mode, mcpAllowlist, mcpNetworkExceptions, ...rest }) => {
    if (mode !== undefined) {
      rest.enabled = mode === "open" || mode === "blacklist";
    }
    void mcpAllowlist;
    void mcpNetworkExceptions;
    return rest;
  });

export type NetworkPolicy = z.infer<typeof networkPolicySchema>;

function networkConfigPath(): string {
  return join(getConfigDir(), "network.json");
}

export function parseNetworkPolicy(input: unknown): NetworkPolicy {
  return networkPolicySchema.parse(input);
}

export async function loadNetworkPolicy(): Promise<NetworkPolicy> {
  await mkdir(getConfigDir(), { recursive: true });
  try {
    const text = await readFile(networkConfigPath(), "utf-8");
    return parseNetworkPolicy(JSON.parse(text));
  } catch {
    return parseNetworkPolicy({ version: 1 });
  }
}

export async function saveNetworkPolicy(policy: NetworkPolicy): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
  const normalized = parseNetworkPolicy(policy);
  await writeFile(networkConfigPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}

export function networkPolicyLabel(policy: NetworkPolicy): string {
  return policy.enabled ? "enabled (blacklist)" : "restricted (allowlist)";
}

function mergedAllowlistRules(policy: NetworkPolicy): string[] {
  return [...(policy.allowlist ?? []), ...(policy.userAllowlist ?? [])];
}

/** Persist CLI-approved hosts into userAllowlist (skipped when already covered). */
export async function addHostsToUserAllowlist(
  hosts: string[],
  existing?: NetworkPolicy,
): Promise<NetworkPolicy> {
  const policy = existing ?? (await loadNetworkPolicy());
  const userAllowlist = [...(policy.userAllowlist ?? [])];
  const userKeys = new Set(userAllowlist.map((rule) => rule.toLowerCase()));
  let changed = false;

  for (const host of hosts) {
    const normalized = host.toLowerCase().trim();
    if (!normalized) continue;
    if (anyNetworkRuleMatches(mergedAllowlistRules(policy), normalized, undefined)) continue;
    if (userKeys.has(normalized)) continue;
    userAllowlist.push(normalized);
    userKeys.add(normalized);
    changed = true;
  }

  if (!changed) return policy;

  const next = parseNetworkPolicy({ ...policy, userAllowlist });
  await saveNetworkPolicy(next);
  return next;
}
