import { describe, expect, it } from "vitest";
import { runSecurityGate, type SecurityContext } from "./pipeline.js";
import type { NetworkPolicy } from "../config/network-store.js";
import type { SecurityPolicy } from "./policy-store.js";

const securityPolicy = {
  approval: { unknownRiskPolicy: "onRequest", byRisk: { medium: "onRequest" } },
  bash: { safeTier: "never", riskyTier: "onRequest", dangerousTier: "deny" },
  bypass: { secretsEnforced: true, networkEnforced: true },
  delete: { protectBulk: true },
  workspace: { outsidePolicy: "approve" },
  capabilities: { default: "WorkspaceWrite" },
} as SecurityPolicy;

function ctx(networkPolicy: NetworkPolicy): SecurityContext {
  return {
    cwd: "/tmp",
    capability: "FullAccess",
    policy: securityPolicy,
    networkPolicy,
    permissionMode: "default",
    sessionAllowedHosts: new Set(),
    sessionAllowedMcpTools: new Set(),
    sessionAllowedWorkspacePaths: new Set(),
  };
}

const webFetchDef = {
  name: "WebFetch",
  description: "fetch",
  inputSchema: { type: "object" },
  security: { requiresNetwork: true, capability: ["network"] as const },
};

describe("pipeline network gate", () => {
  it("denies WebFetch when disabled and not on allowlist", async () => {
    const gate = await runSecurityGate(
      { id: "1", name: "WebFetch", input: { url: "https://other.com", prompt: "x" } },
      webFetchDef,
      ctx({
        version: 1,
        enabled: false,
        allowlist: ["good.com"],
        blacklist: [],
        userAllowlist: [],
        mcpNetworkDenials: [],
      }),
    );
    expect(gate.allowed).toBe(false);
    expect(gate.error).toMatch(/allowlist/i);
  });

  it("allows WebFetch without confirm when disabled but on allowlist", async () => {
    const gate = await runSecurityGate(
      { id: "1", name: "WebFetch", input: { url: "https://api.good.com", prompt: "x" } },
      webFetchDef,
      ctx({
        version: 1,
        enabled: false,
        allowlist: ["good.com"],
        blacklist: [],
        userAllowlist: [],
        mcpNetworkDenials: [],
      }),
    );
    expect(gate.allowed).toBe(true);
    expect(gate.needsConfirm).toBe(false);
    expect(gate.allowlistedNetwork).toBe(true);
  });

  it("denies WebFetch when enabled and blacklisted", async () => {
    const gate = await runSecurityGate(
      { id: "1", name: "WebFetch", input: { url: "https://evil.com", prompt: "x" } },
      webFetchDef,
      ctx({
        version: 1,
        enabled: true,
        allowlist: [],
        blacklist: ["evil.com"],
        userAllowlist: [],
        mcpNetworkDenials: [],
      }),
    );
    expect(gate.allowed).toBe(false);
    expect(gate.error).toMatch(/blacklist/i);
  });

  it("requires confirm when enabled and not on whitelist or blacklist", async () => {
    const gate = await runSecurityGate(
      { id: "1", name: "WebFetch", input: { url: "https://other.com", prompt: "x" } },
      webFetchDef,
      ctx({
        version: 1,
        enabled: true,
        allowlist: ["trusted.com"],
        blacklist: ["evil.com"],
        userAllowlist: [],
        mcpNetworkDenials: [],
      }),
    );
    expect(gate.allowed).toBe(true);
    expect(gate.needsConfirm).toBe(true);
    expect(gate.allowlistedNetwork).toBe(false);
  });

  it("skips confirm when enabled and on whitelist", async () => {
    const gate = await runSecurityGate(
      { id: "1", name: "WebFetch", input: { url: "https://api.trusted.com", prompt: "x" } },
      webFetchDef,
      ctx({
        version: 1,
        enabled: true,
        allowlist: ["trusted.com"],
        blacklist: ["evil.com"],
        userAllowlist: [],
        mcpNetworkDenials: [],
      }),
    );
    expect(gate.allowed).toBe(true);
    expect(gate.needsConfirm).toBe(false);
    expect(gate.allowlistedNetwork).toBe(true);
  });
});
