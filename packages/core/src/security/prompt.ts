import type { SessionCapability } from "@kako/shared";
import type { NetworkPolicy } from "../config/network-store.js";
import { networkPolicyLabel } from "../config/network-store.js";
import type { SecurityPolicy } from "./policy-store.js";

export function formatSecurityPolicySection(
  policy: SecurityPolicy,
  networkPolicy: NetworkPolicy,
  capability: SessionCapability,
): string {
  const trusted = policy.workspace.trustedRoots?.length ?? 0;
  const denied = policy.workspace.deniedRoots?.length ?? 0;
  const outside = policy.workspace.outsidePolicy ?? "approve";
  const netLabel = networkPolicyLabel(networkPolicy);
  const allowCount =
    (networkPolicy.allowlist?.length ?? 0) + (networkPolicy.userAllowlist?.length ?? 0);
  const mcpCount = networkPolicy.mcpNetworkDenials?.length ?? 0;

  const networkDetail = networkPolicy.enabled
    ? `; ${networkPolicy.blacklist?.length ?? 0} blacklisted host(s); ${allowCount} allowlisted host(s) (auto-approve)`
    : `; ${allowCount} allowlisted host(s)${mcpCount > 0 ? `; ${mcpCount} MCP denial(s)` : "; all MCP allowed"}`;

  return `\n\n# Security Policy (runtime)
- Capability: ${capability}
- Workspace: ${trusted} trusted root(s); ${denied} denied path(s); outside policy: ${outside}
- Network: ${netLabel}${networkDetail}
- Approval: medium+ risk tools require confirmation unless session-allowed`;
}
