import {
  anyNetworkRuleMatches,
  parseNetworkTargetFromUrl,
  type NetworkTarget,
} from "@kako/shared";
import type { NetworkPolicy } from "../config/network-store.js";

/** Runtime fetch guard — allow or deny only. */
export type NetworkDecision =
  | { action: "allow"; reason: string }
  | { action: "confirm"; host: string; reason: string }
  | { action: "deny"; reason: string };

/** Security gate for network tools (WebFetch, curl, etc.) before execution. */
export type NetworkGateDecision =
  | { action: "allow"; skipApproval: boolean; reason: string }
  | { action: "deny"; reason: string };

export interface NetworkAccessOptions {
  /** MCP server connect / MCP tool fetch when network access is disabled. */
  mcpContext?: boolean;
  /** Hostnames resolved from remote MCP servers not in {@link NetworkPolicy.mcpNetworkDenials}. */
  mcpExceptionHosts?: Set<string>;
}

export function extractHostname(url: string): string | null {
  return parseNetworkTargetFromUrl(url)?.host ?? null;
}

function targetFromUrl(url: string): NetworkTarget | null {
  return parseNetworkTargetFromUrl(url);
}

export function networkAllowlistRules(policy: NetworkPolicy): string[] {
  return [...(policy.allowlist ?? []), ...(policy.userAllowlist ?? [])];
}

export function matchesNetworkAllowlist(url: string, policy: NetworkPolicy): boolean {
  const target = targetFromUrl(url);
  if (!target) return false;
  return anyNetworkRuleMatches(networkAllowlistRules(policy), target.host, target.port);
}

function hostOnAllowlist(host: string, port: number | undefined, policy: NetworkPolicy): boolean {
  return anyNetworkRuleMatches(networkAllowlistRules(policy), host, port);
}

function hostOnBlacklist(host: string, port: number | undefined, policy: NetworkPolicy): boolean {
  return anyNetworkRuleMatches(policy.blacklist ?? [], host, port);
}

/**
 * Unified network gate for tools that may access the network.
 *
 * - Disabled: deny unless whitelist (general) or MCP exception (mcpContext).
 * - Enabled: blacklist → deny; whitelist → allow without approval; else → allow with approval.
 */
export function evaluateNetworkToolGate(
  url: string,
  policy: NetworkPolicy,
  sessionAllowedHosts: Set<string>,
  options: NetworkAccessOptions = {},
): NetworkGateDecision {
  const target = targetFromUrl(url);
  if (!target) {
    return { action: "deny", reason: "Invalid URL" };
  }

  const { host, port } = target;

  if (sessionAllowedHosts.has(host)) {
    return { action: "allow", skipApproval: true, reason: "Session-allowed host" };
  }

  if (!policy.enabled) {
    if (options.mcpContext) {
      if (options.mcpExceptionHosts?.has(host)) {
        return { action: "allow", skipApproval: true, reason: "MCP network exception" };
      }
      return { action: "deny", reason: `MCP host ${host} not in network exceptions` };
    }
    if (hostOnAllowlist(host, port, policy)) {
      return { action: "allow", skipApproval: true, reason: "Host on allowlist" };
    }
    return { action: "deny", reason: `Host ${host} not on allowlist` };
  }

  if (hostOnBlacklist(host, port, policy)) {
    return { action: "deny", reason: `Host ${host} is blacklisted` };
  }
  if (hostOnAllowlist(host, port, policy)) {
    return { action: "allow", skipApproval: true, reason: "Host on allowlist" };
  }
  return { action: "allow", skipApproval: false, reason: "Network access requires approval" };
}

/** Network tools without a concrete URL (e.g. WebSearch, npm install). */
export function evaluateNetworkToolGateWithoutTarget(policy: NetworkPolicy): NetworkGateDecision {
  if (!policy.enabled) {
    return { action: "deny", reason: "Network access disabled" };
  }
  return { action: "allow", skipApproval: false, reason: "Network access requires approval" };
}

/** Fetch-time guard: allow or deny only (approval already resolved). */
export function evaluateNetworkAccess(
  url: string,
  policy: NetworkPolicy,
  sessionAllowedHosts: Set<string>,
  options: NetworkAccessOptions = {},
): NetworkDecision {
  const gate = evaluateNetworkToolGate(url, policy, sessionAllowedHosts, options);
  if (gate.action === "deny") {
    return { action: "deny", reason: gate.reason };
  }
  return { action: "allow", reason: gate.reason };
}
