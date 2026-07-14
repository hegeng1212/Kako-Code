import { describe, expect, it } from "vitest";
import { agentToolDefinition } from "../tools/builtin/agent-tool.js";
import { applySecurityMetadata } from "./tool-metadata.js";
import { runSecurityGate, type SecurityContext } from "./pipeline.js";
import type { SecurityPolicy } from "./policy-store.js";
import type { NetworkPolicy } from "../config/network-store.js";

const securityPolicy = {
  approval: {
    unknownRiskPolicy: "onRequest",
    byRisk: {
      none: "never",
      low: "onRequest",
      medium: "onRequest",
      high: "always",
      critical: "deny",
    },
  },
  bash: { safeTier: "never", riskyTier: "onRequest", dangerousTier: "deny" },
  bypass: { secretsEnforced: true, networkEnforced: true },
  delete: { protectBulk: true },
  workspace: { outsidePolicy: "approve" },
  capabilities: { default: "FullAccess" },
} as SecurityPolicy;

const networkPolicy: NetworkPolicy = {
  version: 1,
  enabled: true,
  allowlist: [],
  blacklist: [],
  userAllowlist: [],
  mcpNetworkDenials: [],
};

function ctx(permissionMode: SecurityContext["permissionMode"] = "default"): SecurityContext {
  return {
    cwd: "/tmp",
    capability: "FullAccess",
    policy: securityPolicy,
    networkPolicy,
    permissionMode,
    sessionAllowedHosts: new Set(),
    sessionAllowedMcpTools: new Set(),
    sessionAllowedWorkspacePaths: new Set(),
  };
}

describe("pipeline Agent approval", () => {
  it.each(["default", "plan", "acceptEdits", "bypassPermissions"] as const)(
    "does not require user confirmation to spawn a subagent in %s mode",
    async (permissionMode) => {
      const definition = applySecurityMetadata(agentToolDefinition);
      const gate = await runSecurityGate(
        {
          id: "1",
          name: "Agent",
          input: {
            description: "Explore upload code",
            subagent_type: "explore",
            prompt: "Find upload handlers",
          },
        },
        definition,
        ctx(permissionMode),
      );
      expect(gate.allowed).toBe(true);
      expect(gate.needsConfirm).toBe(false);
    },
  );

  it("skips Agent confirmation even when none-risk policy requires approval", async () => {
    const strictPolicy = {
      ...securityPolicy,
      approval: {
        unknownRiskPolicy: "onRequest",
        byRisk: {
          none: "always",
          low: "onRequest",
          medium: "onRequest",
          high: "always",
          critical: "deny",
        },
      },
    } as SecurityPolicy;
    const gate = await runSecurityGate(
      {
        id: "1",
        name: "Agent",
        input: { description: "Explore", prompt: "Scan repo" },
      },
      applySecurityMetadata(agentToolDefinition),
      {
        ...ctx("default"),
        policy: strictPolicy,
      },
    );
    expect(gate.allowed).toBe(true);
    expect(gate.needsConfirm).toBe(false);
  });
});
