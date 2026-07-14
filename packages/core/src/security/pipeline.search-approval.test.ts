import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { globToolDefinition } from "../tools/builtin/glob.js";
import { grepToolDefinition } from "../tools/builtin/grep.js";
import { applySecurityMetadata } from "./tool-metadata.js";
import { runSecurityGate, type SecurityContext } from "./pipeline.js";
import { normalizeSecurityPolicy, type SecurityPolicy } from "./policy-store.js";
import type { NetworkPolicy } from "../config/network-store.js";

const projectDir = mkdtempSync(join(tmpdir(), "kako-search-approval-"));
mkdirSync(join(projectDir, "src"));

const securityPolicy = normalizeSecurityPolicy(
  {
    version: 1,
    approval: {
      byRisk: {
        none: "never",
        low: "onRequest",
        medium: "onRequest",
        high: "always",
        critical: "deny",
      },
      unknownRiskPolicy: "onRequest",
    },
    workspace: { outsidePolicy: "approve" },
    capabilities: { default: "WorkspaceWrite" },
    bash: { safeTier: "never", riskyTier: "onRequest", dangerousTier: "deny" },
    bypass: { secretsEnforced: true, networkEnforced: true },
    delete: { protectBulk: true },
  },
  projectDir,
) as SecurityPolicy;

const networkPolicy: NetworkPolicy = {
  version: 1,
  enabled: true,
  allowlist: [],
  blacklist: [],
  userAllowlist: [],
  mcpNetworkDenials: [],
};

function ctx(): SecurityContext {
  return {
    cwd: projectDir,
    capability: "WorkspaceWrite",
    policy: securityPolicy,
    networkPolicy,
    permissionMode: "default",
    sessionAllowedHosts: new Set(),
    sessionAllowedMcpTools: new Set(),
    sessionAllowedWorkspacePaths: new Set(),
  };
}

describe("pipeline Grep/Glob approval", () => {
  it("skips confirmation for Glob within workspace cwd", async () => {
    const gate = await runSecurityGate(
      { id: "1", name: "Glob", input: { pattern: "*" } },
      applySecurityMetadata(globToolDefinition),
      ctx(),
    );
    expect(gate.allowed).toBe(true);
    expect(gate.needsConfirm).toBe(false);
  });

  it("skips confirmation for Grep within workspace path", async () => {
    const gate = await runSecurityGate(
      { id: "1", name: "Grep", input: { pattern: "foo", path: "src" } },
      applySecurityMetadata(grepToolDefinition),
      ctx(),
    );
    expect(gate.allowed).toBe(true);
    expect(gate.needsConfirm).toBe(false);
  });

  it("requires confirmation for Grep outside trusted workspace", async () => {
    const gate = await runSecurityGate(
      { id: "1", name: "Grep", input: { pattern: "foo", path: "/etc" } },
      applySecurityMetadata(grepToolDefinition),
      ctx(),
    );
    expect(gate.allowed).toBe(true);
    expect(gate.needsConfirm).toBe(true);
  });
});
