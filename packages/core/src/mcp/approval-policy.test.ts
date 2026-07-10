import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "@kako/shared";
import { resolveMcpApprovalForToolCall } from "./approval-policy.js";

const server = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: "demo",
  name: "Demo",
  enabled: true,
  transport: "stdio",
  command: "node",
  ...overrides,
});

describe("resolveMcpApprovalForToolCall", () => {
  it("defaults to onRequest when unset", () => {
    expect(resolveMcpApprovalForToolCall("mcp/demo/foo", [server()])).toBe("onRequest");
  });

  it("uses server-level approvalMode", () => {
    expect(
      resolveMcpApprovalForToolCall("mcp/demo/foo", [server({ approvalMode: "never" })]),
    ).toBe("never");
  });

  it("prefers per-tool override over server default", () => {
    expect(
      resolveMcpApprovalForToolCall(
        "mcp/demo/bar",
        [server({ approvalMode: "never", toolApproval: { bar: "deny" } })],
      ),
    ).toBe("deny");
    expect(
      resolveMcpApprovalForToolCall(
        "mcp/demo/foo",
        [server({ approvalMode: "deny", toolApproval: { foo: "never" } })],
      ),
    ).toBe("never");
  });

  it("returns undefined for non-mcp tools", () => {
    expect(resolveMcpApprovalForToolCall("Read", [server()])).toBeUndefined();
  });
});
