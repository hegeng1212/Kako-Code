import { describe, expect, it } from "vitest";
import { normalizeToolConfirmResult } from "@kako/shared";

describe("normalizeToolConfirmResult", () => {
  it("wraps boolean results", () => {
    expect(normalizeToolConfirmResult(true)).toEqual({ allowed: true, inputPatch: undefined });
    expect(normalizeToolConfirmResult(false)).toEqual({ allowed: false, inputPatch: undefined });
  });

  it("passes through structured results", () => {
    expect(
      normalizeToolConfirmResult({
        allowed: true,
        permissionMode: "bypassPermissions",
      }),
    ).toEqual({
      allowed: true,
      permissionMode: "bypassPermissions",
      denialReason: undefined,
      inputPatch: undefined,
    });
  });

  it("includes denial reason when provided", () => {
    expect(
      normalizeToolConfirmResult({
        allowed: false,
        denialReason: "User requested plan changes",
      }),
    ).toEqual({
      allowed: false,
      permissionMode: undefined,
      denialReason: "User requested plan changes",
      inputPatch: undefined,
    });
  });

  it("passes sessionAllow through", () => {
    expect(
      normalizeToolConfirmResult({
        allowed: true,
        sessionAllow: "writes",
      }),
    ).toEqual({
      allowed: true,
      permissionMode: undefined,
      denialReason: undefined,
      inputPatch: undefined,
      sessionAllow: "writes",
      networkHost: undefined,
      mcpTool: undefined,
      workspacePath: undefined,
      networkAllowlistHosts: undefined,
    });
  });

  it("passes networkAllowlistHosts through", () => {
    expect(
      normalizeToolConfirmResult({
        allowed: true,
        networkAllowlistHosts: ["api.example.com"],
      }),
    ).toEqual({
      allowed: true,
      permissionMode: undefined,
      denialReason: undefined,
      inputPatch: undefined,
      sessionAllow: undefined,
      networkHost: undefined,
      mcpTool: undefined,
      workspacePath: undefined,
      networkAllowlistHosts: ["api.example.com"],
    });
  });
});
