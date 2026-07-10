import { describe, expect, it, vi } from "vitest";
import type { McpRegistry } from "@kako/shared";
import { mcpSecurityMetadata } from "./tool-metadata.js";
import { runSecurityGate, type SecurityContext } from "./pipeline.js";
import type { SecurityPolicy } from "./policy-store.js";
import type { NetworkPolicy } from "../config/network-store.js";

const babytreeRegistry: McpRegistry = {
  version: 1,
  servers: [
    {
      id: "babytree",
      name: "宝宝树",
      enabled: true,
      transport: "stdio",
      command: "node",
      approvalMode: "onRequest",
      toolApproval: { "bbt_pregnancy.find_baby": "never" },
    },
  ],
};

vi.mock("../mcp/config.js", () => ({
  loadMcpRegistry: vi.fn(async () => babytreeRegistry),
}));

const securityPolicy = {
  approval: { unknownRiskPolicy: "onRequest", byRisk: {} },
  bash: { safeTier: "never", riskyTier: "onRequest", dangerousTier: "deny" },
  bypass: { secretsEnforced: true, networkEnforced: true },
  delete: { protectBulk: true },
  workspace: { mode: "restricted", outsidePolicy: "approve" },
  capabilities: { default: "WorkspaceWrite" },
} as SecurityPolicy;

const networkPolicy: NetworkPolicy = {
  version: 1,
  enabled: true,
  allowlist: [],
  blacklist: [],
  userAllowlist: [],
  mcpNetworkDenials: [],
};

const baseCtx: SecurityContext = {
  cwd: "/tmp",
  capability: "WorkspaceWrite",
  policy: securityPolicy,
  networkPolicy,
  permissionMode: "default",
  sessionAllowedHosts: new Set(),
  sessionAllowedMcpTools: new Set(),
  sessionAllowedWorkspacePaths: new Set(),
};

describe("runSecurityGate MCP approval", () => {
  it("skips confirm when per-tool MCP policy is never", async () => {
    const gate = await runSecurityGate(
      {
        id: "1",
        name: "mcp/babytree/bbt_pregnancy.find_baby",
        input: {},
      },
      {
        name: "mcp/babytree/bbt_pregnancy.find_baby",
        description: "demo",
        inputSchema: { type: "object" },
        security: mcpSecurityMetadata("stdio"),
        requiresConfirmation: true,
      },
      baseCtx,
    );

    expect(gate.mcpApproval).toBe("never");
    expect(gate.needsConfirm).toBe(false);
    expect(gate.allowed).toBe(true);
  });

  it("requires confirm when per-tool override is unset and server default is onRequest", async () => {
    const gate = await runSecurityGate(
      {
        id: "1",
        name: "mcp/babytree/bbt_tool.calculator",
        input: {},
      },
      {
        name: "mcp/babytree/bbt_tool.calculator",
        description: "demo",
        inputSchema: { type: "object" },
        security: mcpSecurityMetadata("stdio"),
        requiresConfirmation: true,
      },
      baseCtx,
    );

    expect(gate.mcpApproval).toBe("onRequest");
    expect(gate.needsConfirm).toBe(true);
    expect(gate.audit.approvalMode).toBe("onRequest");
  });

  it("ignores generic side-effect confirm when MCP policy is never", async () => {
    const gate = await runSecurityGate(
      {
        id: "1",
        name: "mcp/babytree/bbt_pregnancy.find_baby",
        input: {},
      },
      {
        name: "mcp/babytree/bbt_pregnancy.find_baby",
        description: "demo",
        inputSchema: { type: "object" },
        security: { ...mcpSecurityMetadata("stdio"), defaultRiskLevel: "high" },
        requiresConfirmation: true,
      },
      baseCtx,
    );

    expect(gate.needsConfirm).toBe(false);
  });
});
