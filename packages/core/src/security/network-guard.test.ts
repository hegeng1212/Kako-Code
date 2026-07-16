import { describe, expect, it } from "vitest";
import {
  evaluateNetworkAccess,
  evaluateNetworkToolGate,
  evaluateNetworkToolGateWithoutTarget,
  matchesNetworkAllowlist,
} from "./network-guard.js";

const enabledPolicy = {
  version: 1,
  enabled: true,
  allowlist: ["trusted.com"],
  blacklist: ["evil.com"],
  userAllowlist: [],
  mcpNetworkDenials: [],
};

const disabledPolicy = {
  version: 1,
  enabled: false,
  allowlist: ["good.com"],
  blacklist: ["evil.com"],
  userAllowlist: [],
  mcpNetworkDenials: [],
};

describe("evaluateNetworkToolGate", () => {
  it("when enabled: blacklist denies", () => {
    const gate = evaluateNetworkToolGate("https://api.evil.com/x", enabledPolicy, new Set());
    expect(gate).toMatchObject({ action: "deny", reason: expect.stringContaining("blacklisted") });
  });

  it("when enabled: whitelist allows without approval", () => {
    const gate = evaluateNetworkToolGate("https://api.trusted.com/x", enabledPolicy, new Set());
    expect(gate).toMatchObject({ action: "allow", skipApproval: true });
  });

  it("when enabled: unlisted host allows but needs approval", () => {
    const gate = evaluateNetworkToolGate("https://other.com/x", enabledPolicy, new Set());
    expect(gate).toMatchObject({ action: "allow", skipApproval: false });
  });

  it("when disabled: allowlist allows", () => {
    const gate = evaluateNetworkToolGate("https://api.good.com/x", disabledPolicy, new Set());
    expect(gate).toMatchObject({ action: "allow", skipApproval: true });
  });

  it("when disabled: non-allowlist denies", () => {
    const gate = evaluateNetworkToolGate("https://other.com/x", disabledPolicy, new Set());
    expect(gate).toMatchObject({ action: "deny" });
  });

  it("when disabled: MCP exception allows", () => {
    const gate = evaluateNetworkToolGate("https://mcp.good.com/v1", disabledPolicy, new Set(), {
      mcpContext: true,
      mcpExceptionHosts: new Set(["mcp.good.com"]),
    });
    expect(gate).toMatchObject({ action: "allow", skipApproval: true });
  });

  it("when disabled: MCP without exception denies", () => {
    const gate = evaluateNetworkToolGate("https://mcp.good.com/v1", disabledPolicy, new Set(), {
      mcpContext: true,
      mcpExceptionHosts: new Set(),
    });
    expect(gate).toMatchObject({ action: "deny" });
  });

  it("when enabled: ignores MCP exception hosts", () => {
    const gate = evaluateNetworkToolGate("https://other.com", enabledPolicy, new Set(), {
      mcpContext: true,
      mcpExceptionHosts: new Set(["other.com"]),
    });
    expect(gate).toMatchObject({ action: "allow", skipApproval: false });
  });
});

describe("evaluateNetworkToolGateWithoutTarget", () => {
  it("denies when network disabled", () => {
    expect(evaluateNetworkToolGateWithoutTarget(disabledPolicy).action).toBe("deny");
  });

  it("skips approval when enabled without concrete URL", () => {
    const gate = evaluateNetworkToolGateWithoutTarget(enabledPolicy);
    expect(gate).toMatchObject({ action: "allow", skipApproval: true });
  });
});

describe("evaluateNetworkAccess", () => {
  it("maps gate allow to fetch allow", () => {
    expect(evaluateNetworkAccess("https://api.trusted.com", enabledPolicy, new Set()).action).toBe(
      "allow",
    );
  });

  it("maps gate deny to fetch deny", () => {
    expect(evaluateNetworkAccess("https://api.evil.com", enabledPolicy, new Set()).action).toBe(
      "deny",
    );
  });
});

describe("matchesNetworkAllowlist", () => {
  it("matches configured hosts", () => {
    expect(matchesNetworkAllowlist("https://api.trusted.com/x", enabledPolicy)).toBe(true);
    expect(matchesNetworkAllowlist("https://other.com/x", enabledPolicy)).toBe(false);
  });
});
