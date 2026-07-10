import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "@kako/shared";
import {
  assertMcpServerNetworkAllowed,
  collectRegisteredMcpHosts,
  evaluateMcpServerNetworkAccess,
  isRemoteMcpServer,
  resolveMcpExceptionHosts,
} from "./network-access.js";
import { evaluateNetworkAccess } from "../security/network-guard.js";

const remoteServer = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: "demo",
  name: "Demo",
  enabled: true,
  transport: "http",
  url: "https://mcp.example.com/v1",
  ...overrides,
});

const enabledPolicy = () => ({
  version: 1 as const,
  enabled: true,
  allowlist: [],
  blacklist: ["blocked.com"],
  userAllowlist: [],
  mcpNetworkDenials: [],
});

const disabledPolicy = () => ({
  version: 1 as const,
  enabled: false,
  allowlist: ["allowed.com"],
  blacklist: [],
  userAllowlist: [],
  mcpNetworkDenials: [],
});

describe("mcp network access", () => {
  it("detects remote MCP servers", () => {
    expect(isRemoteMcpServer(remoteServer())).toBe(true);
    expect(isRemoteMcpServer(remoteServer({ transport: "stdio", command: "node" }))).toBe(false);
  });

  it("allows remote MCP when network is enabled and host is not blacklisted", () => {
    const decision = evaluateMcpServerNetworkAccess(remoteServer(), enabledPolicy());
    expect(decision?.action).toBe("allow");
  });

  it("blocks remote MCP when network is enabled and host is blacklisted", () => {
    const decision = evaluateMcpServerNetworkAccess(
      remoteServer({ url: "https://blocked.com/v1" }),
      enabledPolicy(),
    );
    expect(decision?.action).toBe("deny");
  });

  it("does not block connect for installed remote MCP servers", () => {
    expect(() => assertMcpServerNetworkAllowed(remoteServer())).not.toThrow();
  });

  it("collects registered MCP hostnames", () => {
    const hosts = collectRegisteredMcpHosts([
      remoteServer(),
      remoteServer({ id: "local", transport: "stdio", command: "node", url: undefined }),
    ]);
    expect(hosts.has("mcp.example.com")).toBe(true);
    expect(hosts.size).toBe(1);
  });

  it("allows all remote MCP by default when network is disabled", () => {
    const decision = evaluateMcpServerNetworkAccess(remoteServer(), disabledPolicy());
    expect(decision?.action).toBe("allow");
    const hosts = resolveMcpExceptionHosts([remoteServer()], disabledPolicy());
    expect(hosts.has("mcp.example.com")).toBe(true);
  });

  it("denies MCP servers listed in mcpNetworkDenials", () => {
    const policy = { ...disabledPolicy(), mcpNetworkDenials: ["demo"] };
    const decision = evaluateMcpServerNetworkAccess(remoteServer(), policy);
    expect(decision?.action).toBe("deny");
    const hosts = resolveMcpExceptionHosts([remoteServer()], policy);
    expect(hosts.size).toBe(0);
  });

  it("returns empty exception hosts when network is enabled", () => {
    const hosts = resolveMcpExceptionHosts([remoteServer()], enabledPolicy());
    expect(hosts.size).toBe(0);
  });

  it("uses resolved MCP exception hosts when disabled", () => {
    const hosts = resolveMcpExceptionHosts([remoteServer()], disabledPolicy());
    const allowed = evaluateNetworkAccess(
      "https://mcp.example.com/v1/tools",
      disabledPolicy(),
      new Set(),
      { mcpContext: true, mcpExceptionHosts: hosts },
    );
    expect(allowed.action).toBe("allow");
  });

  it("denies non-allowlisted hosts for general tools when network is disabled", () => {
    const decision = evaluateNetworkAccess(
      "https://blocked.com/page",
      disabledPolicy(),
      new Set(),
    );
    expect(decision.action).toBe("deny");
  });

  it("skips network check for stdio MCP", () => {
    expect(
      evaluateMcpServerNetworkAccess(
        remoteServer({ transport: "stdio", command: "node", url: undefined }),
        enabledPolicy(),
      ),
    ).toBeNull();
  });
});
