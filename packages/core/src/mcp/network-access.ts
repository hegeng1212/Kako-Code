import type { McpServerConfig } from "@kako/shared";
import type { NetworkPolicy } from "../config/network-store.js";
import {
  evaluateNetworkAccess,
  evaluateNetworkToolGate,
  extractHostname,
  type NetworkDecision,
} from "../security/network-guard.js";

export function isRemoteMcpServer(config: Pick<McpServerConfig, "transport" | "url">): boolean {
  return (
    (config.transport === "sse" || config.transport === "http") &&
    typeof config.url === "string" &&
    config.url.trim().length > 0
  );
}

/** Hostnames of installed remote MCP servers. */
export function collectRegisteredMcpHosts(
  servers: Array<Pick<McpServerConfig, "transport" | "url">>,
): Set<string> {
  const hosts = new Set<string>();
  for (const server of servers) {
    if (!isRemoteMcpServer(server)) continue;
    const host = extractHostname(server.url!);
    if (host) hosts.add(host);
  }
  return hosts;
}

export function isMcpNetworkDenied(
  serverId: string,
  policy: NetworkPolicy,
): boolean {
  return (policy.mcpNetworkDenials ?? []).includes(serverId);
}

export function resolveMcpExceptionHosts(
  servers: Array<Pick<McpServerConfig, "id" | "transport" | "url">>,
  policy: NetworkPolicy,
): Set<string> {
  if (policy.enabled) return new Set();
  const denials = new Set(policy.mcpNetworkDenials ?? []);
  const hosts = new Set<string>();
  for (const server of servers) {
    if (!isRemoteMcpServer(server) || denials.has(server.id)) continue;
    const host = extractHostname(server.url!);
    if (host) hosts.add(host);
  }
  return hosts;
}

/** Network-only check for MCP servers. Approval is handled by MCP settings. */
export function evaluateMcpServerNetworkAccess(
  config: Pick<McpServerConfig, "id" | "transport" | "url" | "name">,
  policy: NetworkPolicy,
): NetworkDecision | null {
  if (!isRemoteMcpServer(config)) return null;

  if (!policy.enabled) {
    if (!isMcpNetworkDenied(config.id, policy)) {
      return { action: "allow", reason: "MCP network exception" };
    }
    return { action: "deny", reason: `MCP server ${config.name} has network access disabled` };
  }

  const gate = evaluateNetworkToolGate(config.url!, policy, new Set());
  if (gate.action === "deny") {
    return { action: "deny", reason: gate.reason };
  }
  return { action: "allow", reason: gate.reason };
}

export function assertMcpServerNetworkAllowed(
  config: Pick<McpServerConfig, "transport" | "url" | "name">,
): void {
  void config;
}
